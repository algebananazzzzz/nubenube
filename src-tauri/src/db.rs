//! SQLite storage + the connector's parse/dedup/aggregate logic. Notes (verified
//! against real ~/.claude data): only type=="assistant" lines carry usage; dedup
//! on (message.id, requestId) since one message spans many lines (naive sums
//! overcount 1.7–3.9×); cache_read dominates the mass; local_day/month/hour are
//! precomputed at insert so aggregation stays trivial and timezone-correct.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

use chrono::{Datelike, Duration, Local, Timelike};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

use crate::dto::*;
use crate::model::Line;
use crate::water;

/// Bump when the schema (tables/indexes/backfills below) changes so the one-shot
/// migration re-runs. Stored in `PRAGMA user_version`.
const SCHEMA_VERSION: i64 = 9;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    // WAL serializes the 4 writer threads; the default 0ms busy timeout would
    // drop a colliding write (SQLITE_BUSY, and every write site ignores its
    // Result). Wait instead. Modest: the drift tick holds the runtime mutex.
    let _ = conn.busy_timeout(std::time::Duration::from_millis(1000));
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    // `open` is hot (every tick/command/ingest); gate the batch on user_version
    // so it runs once per DB, not on every open.
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
        -- for resolve_project_by_cwd (WHERE cwd=? ORDER BY ts_utc DESC) and the
        -- cwd GROUP BYs.
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

        -- single global row (project_id = GLOBAL_ID) holds the Nube's life; any
        -- legacy per-project rows are left untouched and unread.
        CREATE TABLE IF NOT EXISTS biome_state (
            project_id     TEXT PRIMARY KEY,
            cloud_health   REAL NOT NULL DEFAULT 100.0,
            last_reset_day TEXT NOT NULL DEFAULT ''
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
        -- per reset-day totals: active (states 1-4), distract (3-4), drift (3
        -- only), work (Σ running·dt), monitored (tracked wall-clock).
        CREATE TABLE IF NOT EXISTS day_stats (
            local_day      TEXT PRIMARY KEY,
            active_secs    INTEGER NOT NULL DEFAULT 0,
            distract_secs  INTEGER NOT NULL DEFAULT 0,
            drift_secs     INTEGER NOT NULL DEFAULT 0,
            work_secs      INTEGER NOT NULL DEFAULT 0,
            monitored_secs INTEGER NOT NULL DEFAULT 0,
            work_app_secs  INTEGER NOT NULL DEFAULT 0
        );
        -- concurrency history. session_recent holds the LIVE day(s) at 5-min
        -- resolution (slot = minute_of_day/5, 0..287) for the intra-day bar graph;
        -- finished days are folded down to session_hourly (1 row/hour) by
        -- compact_stale so the fine table stays bounded. Both share the mergeable
        -- shape: peak = MAX(running+waiting); session_secs = Σ(running+waiting)·dt;
        -- engaged_secs = Σ dt while >0 (avg = session_secs / engaged_secs). Keyed
        -- by calendar day to match the day_stats range filter.
        DROP TABLE IF EXISTS session_stats;
        CREATE TABLE IF NOT EXISTS session_hourly (
            local_day    TEXT NOT NULL,
            local_hour   INTEGER NOT NULL,
            peak         INTEGER NOT NULL DEFAULT 0,
            session_secs INTEGER NOT NULL DEFAULT 0,
            engaged_secs INTEGER NOT NULL DEFAULT 0,
            distract_secs INTEGER NOT NULL DEFAULT 0,
            work_secs INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (local_day, local_hour)
        );
        CREATE TABLE IF NOT EXISTS session_recent (
            local_day    TEXT NOT NULL,
            slot         INTEGER NOT NULL,
            peak         INTEGER NOT NULL DEFAULT 0,
            session_secs INTEGER NOT NULL DEFAULT 0,
            engaged_secs INTEGER NOT NULL DEFAULT 0,
            distract_secs INTEGER NOT NULL DEFAULT 0,
            work_secs INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (local_day, slot)
        );
        "#,
    )?;
    // best-effort column adds for pre-existing DBs (harmless if already present).
    let _ = conn.execute(
        "ALTER TABLE day_stats ADD COLUMN work_secs INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE day_stats ADD COLUMN monitored_secs INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE day_stats ADD COLUMN drift_secs INTEGER NOT NULL DEFAULT 0",
        [],
    );
    // v10: per-day wall-clock seconds on a work app (work-apps feature).
    let _ = conn.execute(
        "ALTER TABLE day_stats ADD COLUMN work_app_secs INTEGER NOT NULL DEFAULT 0",
        [],
    );
    // backfill pre-monitored_secs rows (DEFAULT 0 but with real active_secs).
    let _ = conn.execute(
        "UPDATE day_stats SET monitored_secs = active_secs WHERE monitored_secs = 0 AND active_secs > 0",
        [],
    );
    // v5: drop now-unused columns (SQLite ≥3.35; best-effort — absent on fresh DBs).
    let _ = conn.execute("ALTER TABLE messages_seen DROP COLUMN local_month", []);
    let _ = conn.execute("ALTER TABLE biome_state DROP COLUMN mood", []);
    // v8: per-project per-day focus is no longer read (Insights moved to day_stats).
    let _ = conn.execute("DROP TABLE IF EXISTS drift_daily", []);
    // v9: per-bucket distraction seconds, overlaid on the concurrency graph.
    let _ = conn.execute("ALTER TABLE session_recent ADD COLUMN distract_secs INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE session_hourly ADD COLUMN distract_secs INTEGER NOT NULL DEFAULT 0", []);
    // v10: per-bucket work-app seconds, the graph's base layer under Claude.
    let _ = conn.execute("ALTER TABLE session_recent ADD COLUMN work_secs INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE session_hourly ADD COLUMN work_secs INTEGER NOT NULL DEFAULT 0", []);
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
    drift_delta: i64,
    work_delta: i64,
    monitored_delta: i64,
    work_app_delta: i64,
) {
    if active_delta <= 0 && distract_delta <= 0 && drift_delta <= 0 && work_delta <= 0 && monitored_delta <= 0 && work_app_delta <= 0 {
        return;
    }
    let _ = conn.execute(
        "INSERT INTO day_stats(local_day,active_secs,distract_secs,drift_secs,work_secs,monitored_secs,work_app_secs)
            VALUES(?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(local_day) DO UPDATE SET
            active_secs    = active_secs + ?2,
            distract_secs  = distract_secs + ?3,
            drift_secs     = drift_secs + ?4,
            work_secs      = work_secs + ?5,
            monitored_secs = monitored_secs + ?6,
            work_app_secs  = work_app_secs + ?7",
        params![
            day,
            active_delta.max(0),
            distract_delta.max(0),
            drift_delta.max(0),
            work_delta.max(0),
            monitored_delta.max(0),
            work_app_delta.max(0)
        ],
    );
}

/// (active, distract, drift, work, monitored, work_app) seconds for a reset-day; zeros if unseen.
pub fn load_day_stats(conn: &Connection, day: &str) -> (i64, i64, i64, i64, i64, i64) {
    conn.query_row(
        "SELECT active_secs, distract_secs, drift_secs, work_secs, monitored_secs, work_app_secs FROM day_stats WHERE local_day=?1",
        [day],
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
            ))
        },
    )
    .optional()
    .ok()
    .flatten()
    .unwrap_or((0, 0, 0, 0, 0, 0))
}

/// Sample concurrency into the current 5-min slot of the live day: bump the slot's
/// peak and accumulate session-seconds + engaged-seconds for the time-weighted
/// average. `total` = running + waiting; call only while not frozen and total > 0.
pub fn add_session_sample(conn: &Connection, day: &str, slot: i64, total: i64, dt_secs: i64) {
    if total <= 0 || dt_secs <= 0 {
        return;
    }
    let _ = conn.execute(
        "INSERT INTO session_recent(local_day,slot,peak,session_secs,engaged_secs)
            VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(local_day,slot) DO UPDATE SET
            peak         = MAX(peak, ?3),
            session_secs = session_secs + ?4,
            engaged_secs = engaged_secs + ?5",
        params![day, slot, total, total * dt_secs, dt_secs],
    );
}

/// Mark that the app was running during this (day, slot) so the graph shows a "no
/// data" gap for slots it wasn't — vs a genuine zero. Never clobbers metrics.
pub fn mark_session_slot(conn: &Connection, day: &str, slot: i64) {
    let _ = conn.execute(
        "INSERT OR IGNORE INTO session_recent(local_day, slot) VALUES(?1, ?2)",
        params![day, slot],
    );
}

/// Accumulate distraction wall-clock seconds into the live day's 5-min slot. The
/// slot row already exists (mark_session_slot runs each tick the app is on), but
/// upsert anyway. Touches only distract_secs — never the concurrency metrics.
pub fn add_distract_sample(conn: &Connection, day: &str, slot: i64, secs: i64) {
    if secs <= 0 {
        return;
    }
    let _ = conn.execute(
        "INSERT INTO session_recent(local_day,slot,distract_secs) VALUES(?1,?2,?3)
         ON CONFLICT(local_day,slot) DO UPDATE SET distract_secs = distract_secs + ?3",
        params![day, slot, secs],
    );
}

/// Accumulate work-app wall-clock seconds into the live day's 5-min slot. Mirrors
/// add_distract_sample; touches only work_secs (never the concurrency metrics).
pub fn add_work_sample(conn: &Connection, day: &str, slot: i64, secs: i64) {
    if secs <= 0 {
        return;
    }
    let _ = conn.execute(
        "INSERT INTO session_recent(local_day,slot,work_secs) VALUES(?1,?2,?3)
         ON CONFLICT(local_day,slot) DO UPDATE SET work_secs = work_secs + ?3",
        params![day, slot, secs],
    );
}

/// Fold every day older than `today` out of session_recent into session_hourly
/// (12 five-min slots → 1 hour), then drop its fine rows. The bucket is a
/// mergeable aggregate so the fold is exact; insert+delete share one transaction
/// so a crash can't double-count. Lazy (runs each tick, no-op when nothing stale).
pub fn compact_stale(conn: &mut Connection, today: &str) {
    let stale: Vec<String> = {
        let mut out = Vec::new();
        if let Ok(mut st) =
            conn.prepare("SELECT DISTINCT local_day FROM session_recent WHERE local_day < ?1")
        {
            if let Ok(it) = st.query_map([today], |r| r.get::<_, String>(0)) {
                out.extend(it.flatten());
            }
        }
        out
    };
    if stale.is_empty() {
        return;
    }
    if let Ok(tx) = conn.transaction() {
        for day in &stale {
            let _ = tx.execute(
                "INSERT INTO session_hourly(local_day,local_hour,peak,session_secs,engaged_secs,distract_secs,work_secs)
                    SELECT local_day, slot/12, MAX(peak), SUM(session_secs), SUM(engaged_secs), SUM(distract_secs), SUM(work_secs)
                    FROM session_recent WHERE local_day=?1 GROUP BY slot/12
                 ON CONFLICT(local_day,local_hour) DO UPDATE SET
                    peak          = MAX(peak, excluded.peak),
                    session_secs  = session_secs + excluded.session_secs,
                    engaged_secs  = engaged_secs + excluded.engaged_secs,
                    distract_secs = distract_secs + excluded.distract_secs,
                    work_secs     = work_secs + excluded.work_secs",
                params![day],
            );
            let _ = tx.execute("DELETE FROM session_recent WHERE local_day=?1", params![day]);
        }
        let _ = tx.commit();
    }
}

fn point(label: String, peak: i64, secs: i64, eng: i64, distract: i64, work: i64, present: bool, future: bool) -> SessionPoint {
    SessionPoint {
        label,
        peak,
        avg: if eng > 0 { secs as f64 / eng as f64 } else { 0.0 },
        distract_secs: distract,
        work_secs: work,
        present,
        future,
    }
}

/// Build the 96×15-min "today" grid from a cell→(peak,secs,eng,distract,work) map and the
/// current 15-min cell index. Cells after `now_cell` are future; cells at/before
/// with no data are gaps. Returns (peak, engaged-weighted avg, series). Pure.
fn today_cells(by_cell: &HashMap<i64, (i64, i64, i64, i64, i64)>, now_cell: i64) -> (i64, f64, Vec<SessionPoint>) {
    let (mut peak, mut sum_secs, mut sum_eng) = (0i64, 0i64, 0i64);
    let mut series = Vec::with_capacity(96);
    for c in 0..96i64 {
        let (h, m) = ((c * 15) / 60, (c * 15) % 60);
        let label = format!("{h:02}:{m:02}");
        if c > now_cell {
            series.push(point(label, 0, 0, 0, 0, 0, false, true));
            continue;
        }
        match by_cell.get(&c).copied() {
            Some((p, s, e, d, w)) => {
                peak = peak.max(p);
                sum_secs += s;
                sum_eng += e;
                series.push(point(label, p, s, e, d, w, true, false));
            }
            None => series.push(point(label, 0, 0, 0, 0, 0, false, false)),
        }
    }
    let avg = if sum_eng > 0 { sum_secs as f64 / sum_eng as f64 } else { 0.0 };
    (peak, avg, series)
}

/// Range-scoped concurrency: (peak, time-weighted avg, time series). The series
/// spans the whole chosen period, zero-filled so it reads as a continuous time
/// graph: hourly for "today", daily otherwise (capped to the most recent 60).
pub fn session_insights(conn: &Connection, range: &str) -> (i64, f64, Vec<SessionPoint>) {
    if matches!(Range::parse(range), Range::Today) {
        let day = today_str();
        // 15-min cell -> (peak, session_secs, engaged_secs, distract_secs, work_secs), folded from 5-min slots.
        let mut by_cell: HashMap<i64, (i64, i64, i64, i64, i64)> = HashMap::new();
        if let Ok(mut st) = conn.prepare(
            "SELECT slot, peak, session_secs, engaged_secs, distract_secs, work_secs
             FROM session_recent WHERE local_day=?1",
        ) {
            if let Ok(it) = st.query_map([&day], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?))
            }) {
                for (slot, p, s, e, d, w) in it.flatten() {
                    let cell = by_cell.entry(slot / 3).or_insert((0, 0, 0, 0, 0));
                    cell.0 = cell.0.max(p);
                    cell.1 += s;
                    cell.2 += e;
                    cell.3 += d;
                    cell.4 += w;
                }
            }
        }
        let now = Local::now();
        let now_cell = (now.hour() as i64 * 60 + now.minute() as i64) / 15;
        return today_cells(&by_cell, now_cell);
    }

    if matches!(Range::parse(range), Range::Week) {
        // hourly across Mon 00:00 → now: past days from session_hourly, today
        // rolled up (slot/12) from session_recent. Both retain per-hour present/gap.
        let start = monday_of(Local::now().date_naive());
        let start_s = start.format("%Y-%m-%d").to_string();
        let mut by: HashMap<(String, i64), (i64, i64, i64, i64, i64)> = HashMap::new();
        if let Ok(mut st) = conn.prepare(
            "SELECT day, hour, MAX(peak), COALESCE(SUM(secs),0), COALESCE(SUM(eng),0), COALESCE(SUM(dist),0), COALESCE(SUM(wk),0) FROM (
                SELECT local_day day, local_hour hour, peak, session_secs secs, engaged_secs eng, distract_secs dist, work_secs wk
                  FROM session_hourly WHERE local_day >= ?1
                UNION ALL
                SELECT local_day, slot/12, peak, session_secs, engaged_secs, distract_secs, work_secs
                  FROM session_recent WHERE local_day >= ?1
             ) GROUP BY day, hour",
        ) {
            if let Ok(it) = st.query_map([&start_s], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?, r.get::<_, i64>(6)?))
            }) {
                for (d, h, p, s, e, dist, wk) in it.flatten() {
                    by.insert((d, h), (p, s, e, dist, wk));
                }
            }
        }
        let now = Local::now();
        let today = now.date_naive();
        let now_hour = now.hour() as i64;
        let end = start + Duration::days(6); // full Mon–Sun span
        let (mut peak, mut sum_secs, mut sum_eng) = (0i64, 0i64, 0i64);
        let mut series = Vec::new();
        let mut d = start;
        while d <= end {
            let day_key = d.format("%Y-%m-%d").to_string();
            let label = d.format("%m-%d").to_string();
            for b in 0..12i64 {
                // 12 two-hour blocks/day (84 bars/week) — readable at ~6px, vs a
                // 168-hour blur. Block covers hours [2b, 2b+1].
                let h0 = b * 2;
                if d > today || (d == today && h0 > now_hour) {
                    series.push(point(label.clone(), 0, 0, 0, 0, 0, false, true)); // future
                    continue;
                }
                let (mut bp, mut bs, mut be, mut bd, mut bw, mut has) = (0i64, 0i64, 0i64, 0i64, 0i64, false);
                for h in [h0, h0 + 1] {
                    if let Some((p, s, e, dist, wk)) = by.get(&(day_key.clone(), h)).copied() {
                        bp = bp.max(p);
                        bs += s;
                        be += e;
                        bd += dist;
                        bw += wk;
                        has = true;
                    }
                }
                if has {
                    peak = peak.max(bp);
                    sum_secs += bs;
                    sum_eng += be;
                    series.push(point(label.clone(), bp, bs, be, bd, bw, true, false));
                } else {
                    series.push(point(label.clone(), 0, 0, 0, 0, 0, false, false)); // gap
                }
            }
            d += Duration::days(1);
        }
        let avg = if sum_eng > 0 { sum_secs as f64 / sum_eng as f64 } else { 0.0 };
        return (peak, avg, series);
    }

    // daily resolution (month / all-time): aggregate into days, zero-fill the span.
    let mut by_day: HashMap<String, (i64, i64, i64, i64, i64)> = HashMap::new();
    let start = Range::parse(range).start_day();
    if let Ok(mut st) = conn.prepare(
        "SELECT day, MAX(peak), COALESCE(SUM(secs),0), COALESCE(SUM(eng),0), COALESCE(SUM(dist),0), COALESCE(SUM(wk),0) FROM (
            SELECT local_day day, peak, session_secs secs, engaged_secs eng, distract_secs dist, work_secs wk
              FROM session_hourly WHERE local_day >= ?1
            UNION ALL
            SELECT local_day, peak, session_secs, engaged_secs, distract_secs, work_secs
              FROM session_recent WHERE local_day >= ?1
         ) GROUP BY day",
    ) {
        if let Ok(it) = st.query_map([&start], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?))
        }) {
            for row in it.flatten() {
                by_day.insert(row.0, (row.1, row.2, row.3, row.4, row.5));
            }
        }
    }

    // first day of the span: range start, or the earliest recorded day for "all".
    let first = if start.is_empty() {
        conn.query_row(
            "SELECT MIN(d) FROM (
                SELECT MIN(local_day) d FROM session_hourly
                UNION ALL SELECT MIN(local_day) FROM session_recent)",
            [],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    } else {
        Some(start)
    };

    let today = Local::now().date_naive();
    // month spans the whole calendar month (future days → faint track); all-time
    // has no upper bound, so it stops at today.
    let end_date = match Range::parse(range) {
        Range::Month => end_of_month(today),
        _ => today,
    };
    let mut series: Vec<SessionPoint> = Vec::new();
    let (mut peak, mut sum_secs, mut sum_eng) = (0i64, 0i64, 0i64);
    if let Some(first) = first {
        if let Ok(start_date) = chrono::NaiveDate::parse_from_str(&first, "%Y-%m-%d") {
            let mut d = start_date;
            while d <= end_date {
                let key = d.format("%Y-%m-%d").to_string();
                let label = d.format("%m-%d").to_string();
                if d > today {
                    series.push(point(label, 0, 0, 0, 0, 0, false, true)); // future day
                } else {
                    match by_day.get(&key).copied() {
                        Some((p, secs, eng, dist, wk)) => {
                            peak = peak.max(p);
                            sum_secs += secs;
                            sum_eng += eng;
                            series.push(point(label, p, secs, eng, dist, wk, true, false));
                        }
                        None => series.push(point(label, 0, 0, 0, 0, 0, false, false)),
                    }
                }
                d += Duration::days(1);
            }
        }
    }
    if series.len() > 60 {
        series.drain(0..series.len() - 60);
    }
    let avg = if sum_eng > 0 { sum_secs as f64 / sum_eng as f64 } else { 0.0 };
    (peak, avg, series)
}

/// Insights time window. Every range query reduces to `local_day >= start_day()`
/// — "today"'s start is today (so it yields only today); "all" is "" (matches all).
enum Range {
    Today,
    Week,
    Month,
    All,
}

impl Range {
    fn parse(range: &str) -> Range {
        match range {
            "today" => Range::Today,
            "week" => Range::Week,
            "month" => Range::Month,
            _ => Range::All,
        }
    }
    /// Inclusive lower bound on `local_day`; "" = no bound.
    fn start_day(&self) -> String {
        match self {
            Range::Today => today_str(),
            Range::Week => monday_of(Local::now().date_naive()).format("%Y-%m-%d").to_string(),
            Range::Month => Local::now().format("%Y-%m-01").to_string(),
            Range::All => String::new(),
        }
    }
}

/// Per-app distracted seconds within a range, biggest first.
pub fn drift_app_breakdown(conn: &Connection, range: &str) -> Vec<(String, i64)> {
    let start = Range::parse(range).start_day();
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

fn local_parts(ts: &str) -> (String, i64) {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
        let l = dt.with_timezone(&Local);
        return (l.format("%Y-%m-%d").to_string(), l.hour() as i64);
    }
    (ts.get(0..10).unwrap_or("").to_string(), 0)
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
    let (day, hour) = local_parts(&ts);
    let cwd = parsed.cwd.unwrap_or_default();
    let is_side = if parsed.is_sidechain.unwrap_or(false) { 1 } else { 0 };

    // prepare_cached: reuse one compiled statement across the ingest (this runs
    // once per assistant line — thousands on an initial scan).
    let changed = conn
        .prepare_cached(
            "INSERT OR IGNORE INTO messages_seen
             (msg_id,req_id,project_id,cwd,ts_utc,local_day,local_hour,model,input,output,cache_create,cache_read,is_sidechain)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        )
        .and_then(|mut stmt| {
            stmt.execute(params![
                msg_id, req_id, project_id, cwd, ts, day, hour, model, input, output, cc, cr, is_side
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

/// Modal cwd for ONE project — uses the project_id index instead of scanning
/// every project like `modal_cwds`, for callers that need just one.
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

/// Most recent Monday on or before `d` — the calendar-week start. Pure.
fn monday_of(d: chrono::NaiveDate) -> chrono::NaiveDate {
    d - Duration::days(d.weekday().num_days_from_monday() as i64)
}

/// Last calendar day of `d`'s month. Pure.
fn end_of_month(d: chrono::NaiveDate) -> chrono::NaiveDate {
    let (y, m) = (d.year(), d.month());
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    chrono::NaiveDate::from_ymd_opt(ny, nm, 1).unwrap() - Duration::days(1)
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

/// Deduped token sums over `messages_seen`, scoped to `local_day >= start`
/// (start "" = all time) and optionally one project.
fn sum_tokens(conn: &Connection, project_id: Option<&str>, start: &str) -> TokenBreakdown {
    let (clause, params): (&str, Vec<&str>) = match project_id {
        Some(pid) => ("project_id=?1 AND local_day >= ?2", vec![pid, start]),
        None => ("local_day >= ?1", vec![start]),
    };
    let sql = format!(
        "SELECT COALESCE(SUM(input),0),COALESCE(SUM(output),0),COALESCE(SUM(cache_create),0),COALESCE(SUM(cache_read),0)
         FROM messages_seen WHERE {clause}"
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
    // token composition + focus aggregates share one local_day lower bound.
    let start = Range::parse(range).start_day();
    let tokens = sum_tokens(conn, None, &start);

    // Working/distract/drift are the SAME numbers Home shows: day_stats holds the
    // global per-day totals — work = Σ(running·dt) summed across all sessions,
    // distract + drift = total wall-clock. (Insights just range-sums them so both
    // screens report one measurement.)
    // distract is the honest total (the per-app breakdown is best-effort and
    // undercounts legacy days whose drift_by_app rows predate the total switch).
    let (active, distract, drift, work_app) = conn
        .query_row(
            "SELECT COALESCE(SUM(work_secs),0), COALESCE(SUM(distract_secs),0), COALESCE(SUM(drift_secs),0), COALESCE(SUM(work_app_secs),0)
             FROM day_stats WHERE local_day >= ?1",
            [&start],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?)),
        )
        .unwrap_or((0, 0, 0, 0));

    let distraction_breakdown = drift_app_breakdown(conn, range)
        .into_iter()
        .map(|(name, secs)| DistractionSlice { name, secs })
        .collect();

    let (peak_sessions, avg_sessions, session_series) = session_insights(conn, range);

    Insights {
        range: range.to_string(),
        tokens,
        claude_active_secs: active,
        distract_secs: distract,
        drift_secs: drift,
        work_app_secs: work_app,
        distraction_breakdown,
        peak_sessions,
        avg_sessions,
        session_series,
    }
}

pub fn get_project_detail(conn: &Connection, id: &str, range: &str) -> Option<ProjectDetail> {
    let exists: i64 = conn
        .query_row("SELECT COUNT(*) FROM messages_seen WHERE project_id=?1", [id], |r| r.get(0))
        .unwrap_or(0);
    if exists == 0 {
        return None;
    }

    // tokens for this project within the range
    let start = Range::parse(range).start_day();
    let tokens = sum_tokens(conn, Some(id), &start);

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

/// Fixed key for the single global life row in `biome_state`.
const GLOBAL_ID: &str = "__global__";

/// Global (life, last_reset_day) on the 0..CAP scale; (BASELINE, "") if unseen.
pub fn load_life(conn: &Connection) -> (f64, String) {
    conn.query_row(
        "SELECT cloud_health, last_reset_day FROM biome_state WHERE project_id=?1",
        [GLOBAL_ID],
        |r| Ok((r.get::<_, f64>(0)?, r.get::<_, String>(1)?)),
    )
    .optional()
    .ok()
    .flatten()
    .unwrap_or((crate::drift::BASELINE, String::new()))
}

pub fn save_life(conn: &Connection, life: f64, day: &str) {
    let _ = conn.execute(
        "INSERT INTO biome_state(project_id,cloud_health,last_reset_day) VALUES(?1,?2,?3)
         ON CONFLICT(project_id) DO UPDATE SET cloud_health=?2, last_reset_day=?3",
        params![GLOBAL_ID, life, day],
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn monday_of_returns_week_start() {
        let d = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
        // 2026-06-08 is a Monday → returns itself.
        assert_eq!(monday_of(d("2026-06-08")), d("2026-06-08"));
        // mid-week → back to that Monday.
        assert_eq!(monday_of(d("2026-06-11")), d("2026-06-08")); // Thu
        // Sunday → still the same week's Monday.
        assert_eq!(monday_of(d("2026-06-14")), d("2026-06-08")); // Sun
    }

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrate(&c).unwrap();
        c
    }

    #[test]
    fn compact_folds_slots_into_hours_exactly() {
        let mut c = mem();
        add_session_sample(&c, "2026-06-01", 0, 2, 60); // hour0: peak2 secs120 eng60
        add_session_sample(&c, "2026-06-01", 3, 4, 60); // hour0: peak4 secs240 eng60
        add_session_sample(&c, "2026-06-01", 12, 1, 60); // hour1: peak1 secs60 eng60
        compact_stale(&mut c, "2026-06-02");
        let recent: i64 = c
            .query_row("SELECT COUNT(*) FROM session_recent WHERE local_day='2026-06-01'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(recent, 0); // fine rows dropped after fold
        let hr = |c: &Connection, h: i64| -> (i64, i64, i64) {
            c.query_row(
                "SELECT peak,session_secs,engaged_secs FROM session_hourly WHERE local_day='2026-06-01' AND local_hour=?1",
                [h],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap()
        };
        assert_eq!(hr(&c, 0), (4, 360, 120)); // MAX(2,4); 120+240; 60+60
        assert_eq!(hr(&c, 1), (1, 60, 60));
    }

    #[test]
    fn compact_folds_distraction_into_hours() {
        let mut c = mem();
        add_session_sample(&c, "2026-06-01", 0, 2, 60);
        add_distract_sample(&c, "2026-06-01", 0, 30);
        add_distract_sample(&c, "2026-06-01", 3, 45); // same hour 0 (slots 0..11)
        compact_stale(&mut c, "2026-06-02");
        let d: i64 = c
            .query_row(
                "SELECT distract_secs FROM session_hourly WHERE local_day='2026-06-01' AND local_hour=0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(d, 75);
    }

    #[test]
    fn compact_skips_today_and_is_noop_when_clean() {
        let mut c = mem();
        add_session_sample(&c, "2026-06-02", 5, 2, 60); // "today"
        compact_stale(&mut c, "2026-06-02");
        let recent: i64 = c
            .query_row("SELECT COUNT(*) FROM session_recent WHERE local_day='2026-06-02'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(recent, 1); // today untouched
        let hourly: i64 = c.query_row("SELECT COUNT(*) FROM session_hourly", [], |r| r.get(0)).unwrap();
        assert_eq!(hourly, 0);
        compact_stale(&mut c, "2026-06-02"); // nothing stale → no-op
        let recent2: i64 = c.query_row("SELECT COUNT(*) FROM session_recent", [], |r| r.get(0)).unwrap();
        assert_eq!(recent2, 1);
    }

    #[test]
    fn today_grid_marks_bar_gap_future() {
        let mut m: HashMap<i64, (i64, i64, i64, i64, i64)> = HashMap::new();
        m.insert(2, (3, 120, 60, 30, 45)); // cell 2: peak3 secs120 eng60 distract30 work45
        let (peak, avg, series) = today_cells(&m, 4); // "now" = cell 4 (01:00)
        assert_eq!(series.len(), 96);
        assert_eq!(peak, 3);
        assert!((avg - 2.0).abs() < 1e-9); // 120/60
        assert!(series[2].present && !series[2].future); // bar
        assert_eq!(series[2].distract_secs, 30);
        assert_eq!(series[2].work_secs, 45);
        assert!(!series[1].present && !series[1].future); // gap (≤now, no data)
        assert!(series[5].future && !series[5].present); // > now
        assert_eq!(series[0].label, "00:00");
        assert_eq!(series[4].label, "01:00");
    }

    #[test]
    fn week_is_two_hour_resolution() {
        let c = mem();
        let now = Local::now();
        let today = now.format("%Y-%m-%d").to_string();
        c.execute(
            "INSERT INTO session_hourly(local_day,local_hour,peak,session_secs,engaged_secs) VALUES(?1,0,5,300,60)",
            [&today],
        )
        .unwrap();
        let (peak, _avg, series) = session_insights(&c, "week");
        assert_eq!(peak, 5); // block 0 covers hours 0–1
        // full Mon–Sun, 2-hour blocks, future-padded → always 7×12 = 84 buckets.
        assert_eq!(series.len(), 7 * 12);
    }

    #[test]
    fn month_spans_full_calendar_month() {
        let c = mem();
        let today = Local::now().date_naive();
        let first = today.format("%Y-%m-01").to_string();
        c.execute(
            "INSERT INTO session_hourly(local_day,local_hour,peak,session_secs,engaged_secs) VALUES(?1,0,3,180,60)",
            [&first],
        )
        .unwrap();
        let (peak, _avg, series) = session_insights(&c, "month");
        assert_eq!(peak, 3);
        // spans 1st → last day of the month (future days padded) = days-in-month.
        assert_eq!(series.len() as i64, end_of_month(today).day() as i64);
    }

    #[test]
    fn work_sample_appears_in_today_series() {
        let c = mem();
        add_work_sample(&c, &today_str(), 0, 120); // 120s work in the first slot today
        let (_pk, _av, series) = session_insights(&c, "today");
        assert!(series.iter().any(|p| p.work_secs >= 120), "work_secs should appear in today's series");
    }
}
