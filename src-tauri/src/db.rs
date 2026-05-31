//! SQLite storage + the usage connector's parse/dedup/aggregate logic.
//!
//! Design notes (verified empirically against the real ~/.claude data):
//!   * Only type=="assistant" records carry usage.
//!   * Dedup key = (message.id, requestId); one message spans many lines, so
//!     naive sums overcount 1.7–3.9x. We INSERT OR IGNORE on that key.
//!   * Sum all four token fields; cache_read dominates (~97%).
//!   * Attribute by the project dir segment (stable); show the modal cwd.
//!   * Local-day / local-month / local-hour are precomputed at insert time so
//!     aggregation queries are trivial and timezone-correct.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

use chrono::{Duration, Local, Timelike};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

use crate::dto::*;
use crate::model::Line;
use crate::water;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS messages_seen (
            msg_id        TEXT NOT NULL,
            req_id        TEXT NOT NULL,
            project_id    TEXT NOT NULL,
            cwd           TEXT NOT NULL DEFAULT '',
            ts_utc        TEXT NOT NULL DEFAULT '',
            local_day     TEXT NOT NULL DEFAULT '',
            local_month   TEXT NOT NULL DEFAULT '',
            local_hour    INTEGER NOT NULL DEFAULT 0,
            model         TEXT NOT NULL DEFAULT '',
            input         INTEGER NOT NULL DEFAULT 0,
            output        INTEGER NOT NULL DEFAULT 0,
            cache_create  INTEGER NOT NULL DEFAULT 0,
            cache_read    INTEGER NOT NULL DEFAULT 0,
            is_sidechain  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (msg_id, req_id)
        );
        CREATE INDEX IF NOT EXISTS idx_msg_project ON messages_seen(project_id);
        CREATE INDEX IF NOT EXISTS idx_msg_day ON messages_seen(local_day);

        CREATE TABLE IF NOT EXISTS file_cursors (
            path        TEXT PRIMARY KEY,
            size        INTEGER NOT NULL DEFAULT 0,
            mtime       INTEGER NOT NULL DEFAULT 0,
            byte_offset INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- driven by the watcher / drift state machine (M2)
        CREATE TABLE IF NOT EXISTS drift_daily (
            project_id          TEXT NOT NULL,
            local_day           TEXT NOT NULL,
            claude_active_secs  INTEGER NOT NULL DEFAULT 0,
            drift_secs          INTEGER NOT NULL DEFAULT 0,
            idle_secs           INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (project_id, local_day)
        );
        CREATE TABLE IF NOT EXISTS biome_state (
            project_id     TEXT PRIMARY KEY,
            cloud_health   REAL NOT NULL DEFAULT 0.7,
            last_reset_day TEXT NOT NULL DEFAULT '',
            mood           TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS known_apps (
            app_name   TEXT PRIMARY KEY,
            first_seen TEXT NOT NULL DEFAULT '',
            last_seen  TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS drift_by_app (
            local_day TEXT NOT NULL,
            app_name  TEXT NOT NULL,
            secs      INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (local_day, app_name)
        );
        "#,
    )
}

// ----------------------------------------------------------------------------
//  Meta helpers
// ----------------------------------------------------------------------------

pub fn get_meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",
        params![key, value],
    );
}

fn bump_meta(conn: &Connection, key: &str, delta: u64) {
    let cur: u64 = get_meta(conn, key).and_then(|v| v.parse().ok()).unwrap_or(0);
    set_meta(conn, key, &(cur + delta).to_string());
}

/// Sum of "meaningful" tokens (input+output+cache_create; excludes cache_read
/// context replay) for a project. Drives token-based health recovery.
pub fn project_token_total(conn: &Connection, pid: &str) -> i64 {
    conn.query_row(
        "SELECT COALESCE(SUM(input+output+cache_create),0) FROM messages_seen WHERE project_id=?1",
        [pid],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

/// Record a foreground app the watcher observed (auto-discovery backbone).
pub fn record_known_app(conn: &Connection, app_name: &str) {
    if app_name.is_empty() {
        return;
    }
    let now = chrono::Utc::now().to_rfc3339();
    let _ = conn.execute(
        "INSERT INTO known_apps(app_name,first_seen,last_seen) VALUES(?1,?2,?2)
         ON CONFLICT(app_name) DO UPDATE SET last_seen=?2",
        params![app_name, now],
    );
}

/// All discovered apps, most-recently-seen first.
pub fn get_known_apps(conn: &Connection) -> Vec<KnownApp> {
    let mut out = Vec::new();
    if let Ok(mut stmt) =
        conn.prepare("SELECT app_name, last_seen FROM known_apps ORDER BY last_seen DESC")
    {
        let rows = stmt
            .query_map([], |r| Ok(KnownApp { name: r.get(0)?, last_seen: r.get(1)? }))
            .into_iter()
            .flatten()
            .flatten();
        out.extend(rows);
    }
    out
}

pub fn add_drift_by_app(conn: &Connection, day: &str, app_name: &str, secs: i64) {
    if app_name.is_empty() || secs <= 0 {
        return;
    }
    let _ = conn.execute(
        "INSERT INTO drift_by_app(local_day,app_name,secs) VALUES(?1,?2,?3)
         ON CONFLICT(local_day,app_name) DO UPDATE SET secs = secs + ?3",
        params![day, app_name, secs],
    );
}

// ----------------------------------------------------------------------------
//  Ingest (incremental tail)
// ----------------------------------------------------------------------------

fn local_parts(ts: &str) -> (String, String, i64) {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
        let l = dt.with_timezone(&Local);
        return (
            l.format("%Y-%m-%d").to_string(),
            l.format("%Y-%m").to_string(),
            l.hour() as i64,
        );
    }
    (
        ts.get(0..10).unwrap_or("").to_string(),
        ts.get(0..7).unwrap_or("").to_string(),
        0,
    )
}

/// Incrementally ingest a single session file. Returns the count of NEW deduped
/// messages inserted. Only complete (newline-terminated) lines are parsed; a
/// trailing partial line is left for the next pass.
pub fn ingest_file(conn: &mut Connection, path: &Path, project_id: &str) -> rusqlite::Result<u64> {
    let path_str = path.to_string_lossy().to_string();
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Ok(0),
    };
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let (mut offset, prev_size): (u64, u64) = conn
        .query_row(
            "SELECT byte_offset, size FROM file_cursors WHERE path=?1",
            [&path_str],
            |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as u64)),
        )
        .optional()?
        .unwrap_or((0, 0));

    if size < prev_size {
        offset = 0; // truncated / rotated -> re-read from start
    }
    if size == prev_size && offset >= size && size != 0 {
        return Ok(0); // nothing new
    }

    let mut f = match File::open(path) {
        Ok(f) => f,
        Err(_) => return Ok(0),
    };
    if f.seek(SeekFrom::Start(offset)).is_err() {
        return Ok(0);
    }
    let mut reader = BufReader::new(f);

    let tx = conn.transaction()?;
    let mut consumed = offset;
    let mut new_msgs: u64 = 0;
    let mut naive: u64 = 0;

    loop {
        let mut line = String::new();
        let n = match reader.read_line(&mut line) {
            Ok(n) => n,
            Err(_) => break,
        };
        if n == 0 {
            break;
        }
        if !line.ends_with('\n') {
            break; // partial line — leave for next time
        }
        consumed += n as u64;
        if process_line(&tx, &line, project_id, &mut naive) {
            new_msgs += 1;
        }
    }

    tx.execute(
        "INSERT INTO file_cursors(path,size,mtime,byte_offset) VALUES(?1,?2,?3,?4)
         ON CONFLICT(path) DO UPDATE SET size=?2, mtime=?3, byte_offset=?4",
        params![path_str, size as i64, mtime, consumed as i64],
    )?;
    tx.commit()?;

    if naive > 0 {
        bump_meta(conn, "naive_assistant_lines", naive);
    }
    Ok(new_msgs)
}

/// Parse one line; insert if it's a deduped assistant usage record.
/// Returns true if a NEW row was inserted.
fn process_line(conn: &Connection, line: &str, project_id: &str, naive: &mut u64) -> bool {
    if !line.contains("\"usage\":{") {
        return false; // cheap pre-filter (matches ccusage)
    }
    let parsed: Line = match serde_json::from_str(line) {
        Ok(p) => p,
        Err(_) => return false,
    };
    if parsed.rtype.as_deref() != Some("assistant") {
        return false;
    }
    let msg = match parsed.message {
        Some(m) => m,
        None => return false,
    };
    let usage = match msg.usage {
        Some(u) => u,
        None => return false,
    };
    let model = msg.model.unwrap_or_default();
    if model == "<synthetic>" {
        return false; // local zero-token entries
    }

    let input = usage.input_tokens.unwrap_or(0);
    let output = usage.output_tokens.unwrap_or(0);
    let cc = usage.cache_creation_input_tokens.unwrap_or(0);
    let cr = usage.cache_read_input_tokens.unwrap_or(0);

    *naive += 1;

    // dedup key = (message.id, requestId). If no message.id, fall back to the
    // per-line uuid so it is treated as unique (never deduped), matching ccusage.
    let msg_id = msg
        .id
        .filter(|s| !s.is_empty())
        .or(parsed.uuid)
        .unwrap_or_default();
    if msg_id.is_empty() {
        return false;
    }
    let req_id = parsed.request_id.unwrap_or_default();
    let ts = parsed.timestamp.unwrap_or_default();
    let (day, month, hour) = local_parts(&ts);
    let cwd = parsed.cwd.unwrap_or_default();
    let is_side = if parsed.is_sidechain.unwrap_or(false) { 1 } else { 0 };

    let changed = conn
        .execute(
            "INSERT OR IGNORE INTO messages_seen
             (msg_id,req_id,project_id,cwd,ts_utc,local_day,local_month,local_hour,model,input,output,cache_create,cache_read,is_sidechain)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![msg_id, req_id, project_id, cwd, ts, day, month, hour, model, input, output, cc, cr, is_side],
        )
        .unwrap_or(0);
    changed > 0
}

// ----------------------------------------------------------------------------
//  Queries
// ----------------------------------------------------------------------------

fn modal_cwds(conn: &Connection) -> HashMap<String, String> {
    let mut best: HashMap<String, (String, i64)> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT project_id, cwd, COUNT(*) c FROM messages_seen WHERE cwd<>'' GROUP BY project_id, cwd",
    ) {
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
            })
            .into_iter()
            .flatten()
            .flatten();
        for (pid, cwd, c) in rows {
            let e = best.entry(pid).or_insert((String::new(), -1));
            if c > e.1 {
                *e = (cwd, c);
            }
        }
    }
    best.into_iter().map(|(k, v)| (k, v.0)).collect()
}

fn name_from(cwd: &str, project_id: &str) -> String {
    if !cwd.is_empty() {
        if let Some(name) = Path::new(cwd).file_name() {
            return name.to_string_lossy().into_owned();
        }
    }
    project_id.trim_start_matches('-').replace('-', " ")
}

fn today_str() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}
fn month_str() -> String {
    Local::now().format("%Y-%m").to_string()
}

/// project_id -> water mL, for a given equality predicate (local_day / local_month).
fn water_map(conn: &Connection, col: &str, val: &str) -> HashMap<String, f64> {
    let sql = format!(
        "SELECT project_id, SUM(input),SUM(output),SUM(cache_create),SUM(cache_read)
         FROM messages_seen WHERE {col}=?1 GROUP BY project_id"
    );
    let mut out = HashMap::new();
    if let Ok(mut stmt) = conn.prepare(&sql) {
        let rows = stmt
            .query_map([val], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })
            .into_iter()
            .flatten()
            .flatten();
        for (pid, i, o, cc, cr) in rows {
            out.insert(pid, water::water_ml(i, o, cc, cr));
        }
    }
    out
}

/// project_id -> trailing 7-day water (mL), oldest→newest, zero-filled.
fn last7_water(conn: &Connection) -> HashMap<String, Vec<f64>> {
    let days: Vec<String> = (0..7)
        .rev()
        .map(|i| (Local::now().date_naive() - chrono::Duration::days(i)).format("%Y-%m-%d").to_string())
        .collect();
    let mut per: HashMap<String, HashMap<String, f64>> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT project_id, local_day, SUM(input),SUM(output),SUM(cache_create),SUM(cache_read)
         FROM messages_seen WHERE local_day >= ?1 AND local_day <> '' GROUP BY project_id, local_day",
    ) {
        let rows = stmt
            .query_map([&days[0]], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            })
            .into_iter()
            .flatten()
            .flatten();
        for (pid, day, i, o, cc, cr) in rows {
            per.entry(pid).or_default().insert(day, water::water_ml(i, o, cc, cr));
        }
    }
    per.into_iter()
        .map(|(pid, m)| (pid, days.iter().map(|d| *m.get(d).unwrap_or(&0.0)).collect()))
        .collect()
}

fn biome_health(conn: &Connection) -> HashMap<String, f64> {
    let mut out = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT project_id, cloud_health FROM biome_state") {
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))
            .into_iter()
            .flatten()
            .flatten();
        for (pid, h) in rows {
            out.insert(pid, h);
        }
    }
    out
}

/// project_id -> (claude_active_secs, drift_secs) for today.
fn drift_today(conn: &Connection) -> HashMap<String, (i64, i64)> {
    let mut out = HashMap::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT project_id, claude_active_secs, drift_secs FROM drift_daily WHERE local_day=?1",
    ) {
        let rows = stmt
            .query_map([today_str()], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
            })
            .into_iter()
            .flatten()
            .flatten();
        for (pid, a, d) in rows {
            out.insert(pid, (a, d));
        }
    }
    out
}

pub fn get_projects(conn: &Connection) -> Vec<Project> {
    let cwds = modal_cwds(conn);
    let today_w = water_map(conn, "local_day", &today_str());
    let month_w = water_map(conn, "local_month", &month_str());
    let health = biome_health(conn);
    let drift = drift_today(conn);
    let last7 = last7_water(conn);

    let mut projects = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT project_id, SUM(input),SUM(output),SUM(cache_create),SUM(cache_read), COUNT(*), MIN(ts_utc), MAX(ts_utc)
         FROM messages_seen GROUP BY project_id",
    ) {
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(7)?.unwrap_or_default(),
                ))
            })
            .into_iter()
            .flatten()
            .flatten();
        for (pid, i, o, cc, cr, count, first, last) in rows {
            let cwd = cwds.get(&pid).cloned().unwrap_or_default();
            let (da, dd) = drift.get(&pid).copied().unwrap_or((0, 0));
            projects.push(Project {
                name: name_from(&cwd, &pid),
                root_path: cwd,
                color_hue: water::hue_for(&pid),
                first_seen_utc: first,
                last_seen_utc: last,
                tokens: TokenBreakdown { input: i, output: o, cache_create: cc, cache_read: cr },
                water_ml: water::water_ml(i, o, cc, cr),
                monthly_water_ml: *month_w.get(&pid).unwrap_or(&0.0),
                today_water_ml: *today_w.get(&pid).unwrap_or(&0.0),
                cloud_health: *health.get(&pid).unwrap_or(&0.7),
                drift_secs_today: dd,
                claude_active_secs_today: da,
                msg_count: count,
                last7: last7.get(&pid).cloned().unwrap_or_else(|| vec![0.0; 7]),
                id: pid,
            });
        }
    }
    projects.sort_by(|a, b| b.water_ml.partial_cmp(&a.water_ml).unwrap_or(std::cmp::Ordering::Equal));
    projects
}

pub fn get_totals(conn: &Connection) -> Totals {
    let row = conn
        .query_row(
            "SELECT COALESCE(SUM(input),0),COALESCE(SUM(output),0),COALESCE(SUM(cache_create),0),COALESCE(SUM(cache_read),0),COUNT(DISTINCT project_id)
             FROM messages_seen",
            [],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?)),
        )
        .unwrap_or((0, 0, 0, 0, 0));
    let today_w: f64 = water_map(conn, "local_day", &today_str()).values().sum();
    let month_w: f64 = water_map(conn, "local_month", &month_str()).values().sum();
    let drift: (i64, i64) = drift_today(conn).values().fold((0, 0), |a, b| (a.0 + b.0, a.1 + b.1));
    Totals {
        water_ml: water::water_ml(row.0, row.1, row.2, row.3),
        tokens: TokenBreakdown { input: row.0, output: row.1, cache_create: row.2, cache_read: row.3 },
        project_count: row.4,
        today_water_ml: today_w,
        month_water_ml: month_w,
        claude_active_secs_today: drift.0,
        drift_secs_today: drift.1,
    }
}

fn range_predicate(range: &str) -> (String, Option<String>) {
    match range {
        "today" => ("local_day = ?1".into(), Some(today_str())),
        "week" => {
            let ws = (Local::now() - Duration::days(6)).format("%Y-%m-%d").to_string();
            ("local_day >= ?1".into(), Some(ws))
        }
        "month" => ("local_month = ?1".into(), Some(month_str())),
        _ => ("1=1".into(), None),
    }
}

pub fn get_insights(conn: &Connection, range: &str) -> Insights {
    let (pred, param) = range_predicate(range);
    let p_iter = || params_from_iter(param.iter());

    // by day
    let mut by_day = Vec::new();
    let sql_day = format!(
        "SELECT local_day, SUM(input),SUM(output),SUM(cache_create),SUM(cache_read)
         FROM messages_seen WHERE {pred} AND local_day<>'' GROUP BY local_day ORDER BY local_day"
    );
    if let Ok(mut stmt) = conn.prepare(&sql_day) {
        let rows = stmt
            .query_map(p_iter(), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?))
            })
            .into_iter()
            .flatten()
            .flatten();
        for (day, i, o, cc, cr) in rows {
            by_day.push(DayPoint {
                day,
                water_ml: water::water_ml(i, o, cc, cr),
                tokens: TokenBreakdown { input: i, output: o, cache_create: cc, cache_read: cr },
                drift_secs: 0,
                claude_active_secs: 0,
            });
        }
    }

    // by hour (0..23, fill gaps)
    let mut hour_water = [0f64; 24];
    let mut hour_count = [0i64; 24];
    let sql_hour = format!(
        "SELECT local_hour, SUM(input),SUM(output),SUM(cache_create),SUM(cache_read), COUNT(*)
         FROM messages_seen WHERE {pred} GROUP BY local_hour"
    );
    if let Ok(mut stmt) = conn.prepare(&sql_hour) {
        let rows = stmt
            .query_map(p_iter(), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?))
            })
            .into_iter()
            .flatten()
            .flatten();
        for (h, i, o, cc, cr, c) in rows {
            if (0..24).contains(&h) {
                hour_water[h as usize] = water::water_ml(i, o, cc, cr);
                hour_count[h as usize] = c;
            }
        }
    }
    let by_hour: Vec<HourPoint> = (0..24)
        .map(|h| HourPoint { hour: h, water_ml: hour_water[h as usize], drift_secs: 0, count: hour_count[h as usize] })
        .collect();

    // top projects within range
    let cwds = modal_cwds(conn);
    let mut tops: Vec<TopProject> = Vec::new();
    let sql_top = format!(
        "SELECT project_id, SUM(input),SUM(output),SUM(cache_create),SUM(cache_read)
         FROM messages_seen WHERE {pred} GROUP BY project_id"
    );
    if let Ok(mut stmt) = conn.prepare(&sql_top) {
        let rows = stmt
            .query_map(p_iter(), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?))
            })
            .into_iter()
            .flatten()
            .flatten();
        for (pid, i, o, cc, cr) in rows {
            let cwd = cwds.get(&pid).cloned().unwrap_or_default();
            tops.push(TopProject {
                name: name_from(&cwd, &pid),
                water_ml: water::water_ml(i, o, cc, cr),
                color_hue: water::hue_for(&pid),
                id: pid,
            });
        }
    }
    tops.sort_by(|a, b| b.water_ml.partial_cmp(&a.water_ml).unwrap_or(std::cmp::Ordering::Equal));
    tops.truncate(6);

    let total_water: f64 = by_day.iter().map(|d| d.water_ml).sum();
    let tokens = by_day.iter().fold(TokenBreakdown::default(), |a, d| TokenBreakdown {
        input: a.input + d.tokens.input,
        output: a.output + d.tokens.output,
        cache_create: a.cache_create + d.tokens.cache_create,
        cache_read: a.cache_read + d.tokens.cache_read,
    });

    Insights {
        range: range.to_string(),
        water_ml: total_water,
        tokens,
        by_day,
        by_hour,
        top_projects: tops,
        claude_active_secs: 0,
        drift_secs: 0,
        longest_focus_streak_secs: 0,
    }
}

pub fn get_project_detail(conn: &Connection, id: &str) -> Option<ProjectDetail> {
    let project = get_projects(conn).into_iter().find(|p| p.id == id)?;

    // per-day focus/drift for this project (so detail focus stats are real, not 0)
    let mut dmap: HashMap<String, (i64, i64)> = HashMap::new();
    if let Ok(mut stmt) =
        conn.prepare("SELECT local_day, claude_active_secs, drift_secs FROM drift_daily WHERE project_id=?1")
    {
        let rows = stmt
            .query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))
            .into_iter()
            .flatten()
            .flatten();
        for (day, a, d) in rows {
            dmap.insert(day, (a, d));
        }
    }

    let mut by_day = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT local_day, SUM(input),SUM(output),SUM(cache_create),SUM(cache_read)
         FROM messages_seen WHERE project_id=?1 AND local_day<>'' GROUP BY local_day ORDER BY local_day",
    ) {
        let rows = stmt
            .query_map([id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?))
            })
            .into_iter()
            .flatten()
            .flatten();
        for (day, i, o, cc, cr) in rows {
            let (a, d) = dmap.get(&day).copied().unwrap_or((0, 0));
            by_day.push(DayPoint {
                day,
                water_ml: water::water_ml(i, o, cc, cr),
                tokens: TokenBreakdown { input: i, output: o, cache_create: cc, cache_read: cr },
                drift_secs: d,
                claude_active_secs: a,
            });
        }
    }
    Some(ProjectDetail { project, by_day })
}

pub fn connection_stats(conn: &Connection, roots: Vec<String>, hooks_installed: bool) -> ConnectionStatus {
    let projects_detected: i64 = conn
        .query_row("SELECT COUNT(DISTINCT project_id) FROM messages_seen", [], |r| r.get(0))
        .unwrap_or(0);
    let sessions_scanned: i64 = conn
        .query_row("SELECT COUNT(*) FROM file_cursors", [], |r| r.get(0))
        .unwrap_or(0);
    let deduped: i64 = conn
        .query_row("SELECT COUNT(*) FROM messages_seen", [], |r| r.get(0))
        .unwrap_or(0);
    let naive: f64 = get_meta(conn, "naive_assistant_lines")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.0);
    let ratio = if deduped > 0 { Some(naive / deduped as f64) } else { None };

    ConnectionStatus {
        connected: !roots.is_empty(),
        log_roots: roots,
        projects_detected,
        sessions_scanned,
        hooks_installed,
        last_scan_utc: get_meta(conn, "last_scan_utc"),
        naive_dedup_ratio: ratio,
        permissions: Permissions { screen_recording: false, automation: false },
    }
}

// ----------------------------------------------------------------------------
//  Drift / biome helpers (M2)
// ----------------------------------------------------------------------------

/// Display name for a project id (from its modal cwd).
pub fn project_name(conn: &Connection, pid: &str) -> String {
    let cwds = modal_cwds(conn);
    name_from(cwds.get(pid).map(|s| s.as_str()).unwrap_or(""), pid)
}

/// (cloud_health, last_reset_day) — defaults to (0.7, "") if unseen.
pub fn load_health(conn: &Connection, pid: &str) -> (f64, String) {
    conn.query_row(
        "SELECT cloud_health, last_reset_day FROM biome_state WHERE project_id=?1",
        [pid],
        |r| Ok((r.get::<_, f64>(0)?, r.get::<_, String>(1)?)),
    )
    .optional()
    .ok()
    .flatten()
    .unwrap_or((0.7, String::new()))
}

pub fn save_health(conn: &Connection, pid: &str, health: f64, day: &str) {
    let _ = conn.execute(
        "INSERT INTO biome_state(project_id,cloud_health,last_reset_day,mood) VALUES(?1,?2,?3,'')
         ON CONFLICT(project_id) DO UPDATE SET cloud_health=?2, last_reset_day=?3",
        params![pid, health, day],
    );
}

pub fn reset_all_health(conn: &Connection, baseline: f64, day: &str) {
    let _ = conn.execute(
        "UPDATE biome_state SET cloud_health=?1, last_reset_day=?2",
        params![baseline, day],
    );
}

pub fn add_drift(conn: &Connection, pid: &str, day: &str, active: i64, drift: i64, idle: i64) {
    let _ = conn.execute(
        "INSERT INTO drift_daily(project_id,local_day,claude_active_secs,drift_secs,idle_secs) VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(project_id,local_day) DO UPDATE SET
            claude_active_secs = claude_active_secs + ?3,
            drift_secs = drift_secs + ?4,
            idle_secs = idle_secs + ?5",
        params![pid, day, active, drift, idle],
    );
}

/// Map a runtime cwd back to a stable project id (exact match, most recent).
pub fn resolve_project_by_cwd(conn: &Connection, cwd: &str) -> Option<String> {
    if cwd.is_empty() {
        return None;
    }
    conn.query_row(
        "SELECT project_id FROM messages_seen WHERE cwd=?1 ORDER BY ts_utc DESC LIMIT 1",
        [cwd],
        |r| r.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

pub fn most_recent_project(conn: &Connection) -> Option<String> {
    conn.query_row(
        "SELECT project_id FROM messages_seen ORDER BY ts_utc DESC LIMIT 1",
        [],
        |r| r.get(0),
    )
    .optional()
    .ok()
    .flatten()
}
