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

/// Bump when the schema (tables/indexes/backfills below) changes so the one-shot
/// migration re-runs. Stored in `PRAGMA user_version`.
const SCHEMA_VERSION: i64 = 2;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    // Four threads (connector, drift tick, events tail, commands) write to this
    // DB. WAL serializes writers; the default 0ms busy timeout would make a
    // colliding write fail with SQLITE_BUSY and get silently dropped (every
    // write site discards its Result). Wait instead so writes aren't lost. Kept
    // modest because the drift tick holds the runtime mutex while it writes.
    let _ = conn.busy_timeout(std::time::Duration::from_millis(1000));
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    // `open` is called on a hot path (every drift tick, every command, every
    // ingest), so gate the whole CREATE/ALTER/UPDATE batch on user_version —
    // run it once per DB instead of re-parsing/re-attempting it on every open.
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if version >= SCHEMA_VERSION {
        return Ok(());
    }
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
        -- resolve_project_by_cwd (per hook event) does WHERE cwd=? ORDER BY
        -- ts_utc DESC; the composite seeks the cwd then reads the newest row
        -- directly. Also accelerates the cwd GROUP BYs in the modal-cwd queries.
        CREATE INDEX IF NOT EXISTS idx_msg_cwd ON messages_seen(cwd, ts_utc);

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

        -- driven by the watcher / drift state machine (M2).
        -- `claude_active_secs` = Claude working; `waiting_secs` = Claude idle,
        -- waiting on you (attending, not distracted); `drift_secs` = on a
        -- distraction while Claude waits; `idle_secs` = away.
        CREATE TABLE IF NOT EXISTS drift_daily (
            project_id          TEXT NOT NULL,
            local_day           TEXT NOT NULL,
            claude_active_secs  INTEGER NOT NULL DEFAULT 0,
            drift_secs          INTEGER NOT NULL DEFAULT 0,
            idle_secs           INTEGER NOT NULL DEFAULT 0,
            waiting_secs        INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (project_id, local_day)
        );
        CREATE TABLE IF NOT EXISTS biome_state (
            project_id     TEXT PRIMARY KEY,
            cloud_health   REAL NOT NULL DEFAULT 100.0,
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
        -- per-(reset)day activity totals, keyed by reset-day:
        --   active_secs    = states 1+2+3+4 (engaged or on a distraction)
        --   distract_secs  = states 3+4 (on a distraction)
        --   work_secs      = session-weighted Claude-working seconds (Σ running·dt)
        --   monitored_secs = present-&-tracking wall-clock (everything but paused/away)
        CREATE TABLE IF NOT EXISTS day_stats (
            local_day      TEXT PRIMARY KEY,
            active_secs    INTEGER NOT NULL DEFAULT 0,
            distract_secs  INTEGER NOT NULL DEFAULT 0,
            work_secs      INTEGER NOT NULL DEFAULT 0,
            monitored_secs INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )?;
    // best-effort column adds for DBs created before a column existed
    // (no-ops that error harmlessly if the column is already present).
    let _ = conn.execute(
        "ALTER TABLE drift_daily ADD COLUMN waiting_secs INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE day_stats ADD COLUMN work_secs INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE day_stats ADD COLUMN monitored_secs INTEGER NOT NULL DEFAULT 0",
        [],
    );
    // backfill rows that pre-date the monitored_secs column (they got DEFAULT 0
    // but already had real distract_secs / active_secs, making distracted > monitored)
    let _ = conn.execute(
        "UPDATE day_stats SET monitored_secs = active_secs WHERE monitored_secs = 0 AND active_secs > 0",
        [],
    );
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
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

/// Add to today's activity totals (all deltas in seconds; an all-zero call is a
/// no-op). See the `day_stats` schema for what each column means.
pub fn add_day_stats(
    conn: &Connection,
    day: &str,
    active_delta: i64,
    distract_delta: i64,
    work_delta: i64,
    monitored_delta: i64,
) {
    if active_delta <= 0 && distract_delta <= 0 && work_delta <= 0 && monitored_delta <= 0 {
        return;
    }
    let _ = conn.execute(
        "INSERT INTO day_stats(local_day,active_secs,distract_secs,work_secs,monitored_secs)
            VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(local_day) DO UPDATE SET
            active_secs    = active_secs + ?2,
            distract_secs  = distract_secs + ?3,
            work_secs      = work_secs + ?4,
            monitored_secs = monitored_secs + ?5",
        params![
            day,
            active_delta.max(0),
            distract_delta.max(0),
            work_delta.max(0),
            monitored_delta.max(0)
        ],
    );
}

/// (active, distract, work, monitored) seconds for a reset-day; zeros if unseen.
pub fn load_day_stats(conn: &Connection, day: &str) -> (i64, i64, i64, i64) {
    conn.query_row(
        "SELECT active_secs, distract_secs, work_secs, monitored_secs FROM day_stats WHERE local_day=?1",
        [day],
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
            ))
        },
    )
    .optional()
    .ok()
    .flatten()
    .unwrap_or((0, 0, 0, 0))
}

/// First local_day to include for an insights range ("" = no lower bound).
fn range_start_day(range: &str) -> String {
    match range {
        "today" => today_str(),
        "week" => (Local::now() - Duration::days(6)).format("%Y-%m-%d").to_string(),
        "month" => Local::now().format("%Y-%m-01").to_string(),
        _ => String::new(),
    }
}

/// Per-app distracted seconds within a range, biggest first.
pub fn drift_app_breakdown(conn: &Connection, range: &str) -> Vec<(String, i64)> {
    let start = range_start_day(range);
    let mut out = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT app_name, SUM(secs) FROM drift_by_app WHERE local_day >= ?1 GROUP BY app_name ORDER BY 2 DESC",
    ) {
        let rows = stmt
            .query_map([&start], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .into_iter()
            .flatten()
            .flatten();
        out.extend(rows);
    }
    out
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

    // prepare_cached: this runs once per assistant line (thousands on an initial
    // scan), so reuse one compiled statement across the whole ingest instead of
    // re-parsing the SQL on every insert.
    let changed = conn
        .prepare_cached(
            "INSERT OR IGNORE INTO messages_seen
             (msg_id,req_id,project_id,cwd,ts_utc,local_day,local_month,local_hour,model,input,output,cache_create,cache_read,is_sidechain)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        )
        .and_then(|mut stmt| {
            stmt.execute(params![
                msg_id, req_id, project_id, cwd, ts, day, month, hour, model, input, output, cc, cr,
                is_side
            ])
        })
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

/// The single most common (modal) cwd for ONE project. Uses the project_id
/// index instead of scanning every project's rows like `modal_cwds`, so callers
/// that only need one project (project_name, project detail) don't pay for the
/// whole table.
fn modal_cwd_for(conn: &Connection, pid: &str) -> String {
    conn.query_row(
        "SELECT cwd FROM messages_seen WHERE project_id=?1 AND cwd<>''
         GROUP BY cwd ORDER BY COUNT(*) DESC LIMIT 1",
        [pid],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
    .unwrap_or_default()
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

pub fn get_projects(conn: &Connection) -> Vec<Project> {
    let cwds = modal_cwds(conn);
    let mut projects = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT project_id, SUM(input),SUM(output),SUM(cache_create),SUM(cache_read)
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
                ))
            })
            .into_iter()
            .flatten()
            .flatten();
        for (pid, i, o, cc, cr) in rows {
            let cwd = cwds.get(&pid).cloned().unwrap_or_default();
            projects.push(Project {
                name: name_from(&cwd, &pid),
                root_path: cwd,
                color_hue: water::hue_for(&pid),
                tokens: TokenBreakdown { input: i, output: o, cache_create: cc, cache_read: cr },
                water_ml: water::water_ml(i, o, cc, cr),
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
    Totals {
        water_ml: water::water_ml(row.0, row.1, row.2, row.3),
        tokens: TokenBreakdown { input: row.0, output: row.1, cache_create: row.2, cache_read: row.3 },
        project_count: row.4,
    }
}

/// (predicate, optional bound param) over `messages_seen` for a range.
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

fn tokens_where(conn: &Connection, pred: &str, params: &[&str]) -> TokenBreakdown {
    let sql = format!(
        "SELECT COALESCE(SUM(input),0),COALESCE(SUM(output),0),COALESCE(SUM(cache_create),0),COALESCE(SUM(cache_read),0)
         FROM messages_seen WHERE {pred}"
    );
    conn.query_row(&sql, params_from_iter(params.iter()), |r| {
        Ok(TokenBreakdown {
            input: r.get(0)?,
            output: r.get(1)?,
            cache_create: r.get(2)?,
            cache_read: r.get(3)?,
        })
    })
    .unwrap_or_default()
}

pub fn get_insights(conn: &Connection, range: &str) -> Insights {
    // token composition for the range
    let (pred, param) = range_predicate(range);
    let params: Vec<&str> = param.iter().map(|s| s.as_str()).collect();
    let tokens = tokens_where(conn, &pred, &params);

    // honest range-scoped focus aggregates from drift_daily
    let start = range_start_day(range);
    let (active, idle, drift) = conn
        .query_row(
            "SELECT COALESCE(SUM(claude_active_secs),0), COALESCE(SUM(waiting_secs),0), COALESCE(SUM(drift_secs),0)
             FROM drift_daily WHERE local_day >= ?1",
            [&start],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)),
        )
        .unwrap_or((0, 0, 0));

    let distraction_breakdown = drift_app_breakdown(conn, range)
        .into_iter()
        .map(|(name, secs)| DistractionSlice { name, secs })
        .collect();

    Insights {
        range: range.to_string(),
        tokens,
        claude_active_secs: active,
        claude_idle_secs: idle,
        drift_secs: drift,
        distraction_breakdown,
    }
}

pub fn get_project_detail(conn: &Connection, id: &str, range: &str) -> Option<ProjectDetail> {
    let exists: i64 = conn
        .query_row("SELECT COUNT(*) FROM messages_seen WHERE project_id=?1", [id], |r| r.get(0))
        .unwrap_or(0);
    if exists == 0 {
        return None;
    }

    // tokens for this project within the range (project_id=?1, range bound=?2)
    let mut bind: Vec<String> = vec![id.to_string()];
    let pred = match range {
        "today" => { bind.push(today_str()); "project_id=?1 AND local_day = ?2".to_string() }
        "week" => {
            bind.push((Local::now() - Duration::days(6)).format("%Y-%m-%d").to_string());
            "project_id=?1 AND local_day >= ?2".to_string()
        }
        "month" => { bind.push(month_str()); "project_id=?1 AND local_month = ?2".to_string() }
        _ => "project_id=?1".to_string(),
    };
    let refs: Vec<&str> = bind.iter().map(|s| s.as_str()).collect();
    let tokens = tokens_where(conn, &pred, &refs);

    let cwd = modal_cwd_for(conn, id);
    Some(ProjectDetail {
        water_ml: water::water_ml(tokens.input, tokens.output, tokens.cache_create, tokens.cache_read),
        name: name_from(&cwd, id),
        root_path: cwd,
        color_hue: water::hue_for(id),
        range: range.to_string(),
        tokens,
        id: id.to_string(),
    })
}

pub fn connection_stats(conn: &Connection, roots: Vec<String>, hooks_installed: bool) -> ConnectionStatus {
    let projects_detected: i64 = conn
        .query_row("SELECT COUNT(DISTINCT project_id) FROM messages_seen", [], |r| r.get(0))
        .unwrap_or(0);
    let sessions_scanned: i64 = conn
        .query_row("SELECT COUNT(*) FROM file_cursors", [], |r| r.get(0))
        .unwrap_or(0);

    ConnectionStatus {
        connected: !roots.is_empty(),
        projects_detected,
        sessions_scanned,
        hooks_installed,
    }
}

// ----------------------------------------------------------------------------
//  Drift / biome helpers (M2)
// ----------------------------------------------------------------------------

/// Display name for a project id (from its modal cwd).
pub fn project_name(conn: &Connection, pid: &str) -> String {
    name_from(&modal_cwd_for(conn, pid), pid)
}

/// (life, last_reset_day) on the new 0..130 scale — defaults to (BASELINE, "")
/// if unseen. MIGRATION: pre-redesign rows stored `cloud_health` on the old
/// 0..1 scale; any stored value `<= CAP/100` (1.3) is treated as old-scale and
/// reset once to BASELINE so the meter starts fresh on the new scale.
pub fn load_health(conn: &Connection, pid: &str) -> (f64, String) {
    let baseline = crate::drift::BASELINE;
    let old_scale_max = crate::drift::CAP / 100.0; // 1.3
    conn.query_row(
        "SELECT cloud_health, last_reset_day FROM biome_state WHERE project_id=?1",
        [pid],
        |r| Ok((r.get::<_, f64>(0)?, r.get::<_, String>(1)?)),
    )
    .optional()
    .ok()
    .flatten()
    .map(|(h, d)| if h <= old_scale_max { (baseline, d) } else { (h, d) })
    .unwrap_or((baseline, String::new()))
}

pub fn save_health(conn: &Connection, pid: &str, health: f64, day: &str) {
    let _ = conn.execute(
        "INSERT INTO biome_state(project_id,cloud_health,last_reset_day,mood) VALUES(?1,?2,?3,'')
         ON CONFLICT(project_id) DO UPDATE SET cloud_health=?2, last_reset_day=?3",
        params![pid, health, day],
    );
}

/// Add to a project's daily drift totals. All four deltas in seconds; zeros are
/// no-ops on their column.
pub fn add_drift(conn: &Connection, pid: &str, day: &str, active: i64, drift: i64, idle: i64, waiting: i64) {
    let _ = conn.execute(
        "INSERT INTO drift_daily(project_id,local_day,claude_active_secs,drift_secs,idle_secs,waiting_secs) VALUES(?1,?2,?3,?4,?5,?6)
         ON CONFLICT(project_id,local_day) DO UPDATE SET
            claude_active_secs = claude_active_secs + ?3,
            drift_secs = drift_secs + ?4,
            idle_secs = idle_secs + ?5,
            waiting_secs = waiting_secs + ?6",
        params![pid, day, active, drift, idle, waiting],
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
