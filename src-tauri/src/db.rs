//! SQLite storage: one row per calendar day (history + plan), 15-minute slots
//! for the Insights graph, per-app time, discovered apps, and a meta table
//! holding the running timer so it survives a restart.

use std::collections::HashMap;
use std::path::Path;

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, Timelike};
use rusqlite::{params, Connection, OptionalExtension};

use crate::dto::*;
use crate::economy::Day;

/// Bump when the schema changes so the one-shot migration re-runs. Stored in
/// `PRAGMA user_version`.
const SCHEMA_VERSION: i64 = 1;

/// 15-minute Insights slots per day.
pub const SLOT_MINUTES: u32 = 15;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    // The tick thread and command handlers write concurrently; wait out a
    // colliding write instead of failing it with SQLITE_BUSY.
    conn.busy_timeout(std::time::Duration::from_millis(1000))?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version >= SCHEMA_VERSION {
        return Ok(());
    }
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS known_apps (
            app_name   TEXT PRIMARY KEY,
            first_seen TEXT NOT NULL,
            last_seen  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS days (
            day       TEXT PRIMARY KEY,
            focus     REAL NOT NULL DEFAULT 0,
            distract  REAL NOT NULL DEFAULT 0,
            earned    REAL NOT NULL DEFAULT 0,
            spent     REAL NOT NULL DEFAULT 0,
            target    REAL,
            hit       INTEGER NOT NULL DEFAULT 0,
            bonus     REAL NOT NULL DEFAULT 0,
            rest_plan REAL NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS slots (
            day      TEXT NOT NULL,
            slot     INTEGER NOT NULL,
            focus    REAL NOT NULL DEFAULT 0,
            distract REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (day, slot)
        );
        CREATE TABLE IF NOT EXISTS app_time (
            day      TEXT NOT NULL,
            app      TEXT NOT NULL,
            focus    REAL NOT NULL DEFAULT 0,
            distract REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (day, app)
        );
        "#,
    )?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)
}

pub fn day_id(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

pub fn monday_of(d: NaiveDate) -> NaiveDate {
    d - Duration::days(d.weekday().num_days_from_monday() as i64)
}

fn end_of_month(d: NaiveDate) -> NaiveDate {
    let (y, m) = (d.year(), d.month());
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    NaiveDate::from_ymd_opt(ny, nm, 1).unwrap() - Duration::days(1)
}

pub fn get_meta(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0)).optional()
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",
        params![key, value],
    )
    .map(|_| ())
}

pub fn delete_meta(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM meta WHERE key=?1", [key]).map(|_| ())
}

pub fn record_known_app(conn: &Connection, app_name: &str) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO known_apps(app_name,first_seen,last_seen) VALUES(?1,?2,?2)
         ON CONFLICT(app_name) DO UPDATE SET last_seen=?2",
        params![app_name, now],
    )
    .map(|_| ())
}

pub fn known_apps(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT app_name FROM known_apps")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

pub fn load_day(conn: &Connection, day: &str) -> rusqlite::Result<Day> {
    conn.query_row(
        "SELECT focus, distract, earned, spent, target, hit, bonus, rest_plan FROM days WHERE day=?1",
        [day],
        |r| {
            Ok(Day {
                focus: r.get(0)?,
                distract: r.get(1)?,
                earned: r.get(2)?,
                spent: r.get(3)?,
                target: r.get(4)?,
                hit: r.get::<_, i64>(5)? != 0,
                bonus: r.get(6)?,
                rest_plan: r.get(7)?,
            })
        },
    )
    .optional()
    .map(Option::unwrap_or_default)
}

pub fn save_day(conn: &Connection, day: &str, d: &Day) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO days(day, focus, distract, earned, spent, target, hit, bonus, rest_plan)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(day) DO UPDATE SET focus=?2, distract=?3, earned=?4, spent=?5,
           target=?6, hit=?7, bonus=?8, rest_plan=?9",
        params![day, d.focus, d.distract, d.earned, d.spent, d.target, d.hit as i64, d.bonus, d.rest_plan],
    )
    .map(|_| ())
}

/// Mark the slot as tracked (present) and add the tick's focus/rest seconds.
pub fn add_slot(conn: &Connection, day: &str, slot: u32, focus: f64, distract: f64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO slots(day, slot, focus, distract) VALUES(?1,?2,?3,?4)
         ON CONFLICT(day, slot) DO UPDATE SET focus=focus+?3, distract=distract+?4",
        params![day, slot, focus, distract],
    )
    .map(|_| ())
}

pub fn add_app_time(conn: &Connection, day: &str, app: &str, focus: f64, distract: f64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO app_time(day, app, focus, distract) VALUES(?1,?2,?3,?4)
         ON CONFLICT(day, app) DO UPDATE SET focus=focus+?3, distract=distract+?4",
        params![day, app, focus, distract],
    )
    .map(|_| ())
}

fn top_apps(conn: &Connection, col: &str, start: &str, end: &str) -> rusqlite::Result<Vec<AppSlice>> {
    let sql = format!(
        "SELECT app, SUM({col}) AS s FROM app_time WHERE day BETWEEN ?1 AND ?2
         GROUP BY app HAVING s >= 1 ORDER BY s DESC LIMIT 6"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([start, end], |r| Ok(AppSlice { name: r.get(0)?, secs: r.get(1)? }))?;
    rows.collect()
}

/// Focus vs rest over `range` ("today" in 15-minute cells, "week" in 2-hour
/// buckets from Monday, "month" daily), plus totals and the top apps.
pub fn insights(conn: &Connection, range: &str, now: NaiveDateTime) -> rusqlite::Result<Insights> {
    let today = now.date();
    let (start, end) = match range {
        "today" => (today, today),
        "week" => (monday_of(today), monday_of(today) + Duration::days(6)),
        _ => (today.with_day(1).unwrap(), end_of_month(today)),
    };
    let (start_id, end_id, today_id) = (day_id(start), day_id(end), day_id(today));

    let mut slots: HashMap<(String, u32), (f64, f64)> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT day, slot, focus, distract FROM slots WHERE day BETWEEN ?1 AND ?2")?;
        let rows = stmt.query_map([&start_id, &end_id], |r| {
            Ok(((r.get::<_, String>(0)?, r.get::<_, u32>(1)?), (r.get::<_, f64>(2)?, r.get::<_, f64>(3)?)))
        })?;
        for row in rows {
            let (k, v) = row?;
            slots.insert(k, v);
        }
    }
    let per_day = 24 * 60 / SLOT_MINUTES;
    let bucket = |day: &str, from: u32, to: u32| {
        (from..to).fold((0.0, 0.0, false), |(f, d, p), s| match slots.get(&(day.to_string(), s)) {
            Some((sf, sd)) => (f + sf, d + sd, true),
            None => (f, d, p),
        })
    };
    let point = |label: String, (focus, distract, present): (f64, f64, bool), future: bool| SeriesPoint {
        label,
        focus,
        distract,
        present,
        future,
    };

    let series = match range {
        "today" => {
            let now_slot = (now.hour() * 60 + now.minute()) / SLOT_MINUTES;
            (0..per_day)
                .map(|s| {
                    let m = s * SLOT_MINUTES;
                    point(format!("{:02}:{:02}", m / 60, m % 60), bucket(&today_id, s, s + 1), s > now_slot)
                })
                .collect()
        }
        "week" => {
            let per_bucket = 120 / SLOT_MINUTES;
            let mut out = Vec::new();
            for d in 0..7 {
                let date = start + Duration::days(d);
                let id = day_id(date);
                let label = date.format("%a").to_string();
                for b in 0..12u32 {
                    let future = date > today || (date == today && b * 2 > now.hour());
                    out.push(point(label.clone(), bucket(&id, b * per_bucket, (b + 1) * per_bucket), future));
                }
            }
            out
        }
        _ => {
            let mut out = Vec::new();
            let mut date = start;
            while date <= end {
                let id = day_id(date);
                out.push(point(date.format("%m-%d").to_string(), bucket(&id, 0, per_day), date > today));
                date += Duration::days(1);
            }
            out
        }
    };

    let (earned, spent, targets_hit, target_days) = conn.query_row(
        "SELECT COALESCE(SUM(earned),0), COALESCE(SUM(spent),0),
                COALESCE(SUM(hit),0), COUNT(target)
         FROM days WHERE day BETWEEN ?1 AND ?2",
        [&start_id, &today_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;

    Ok(Insights {
        range: range.to_string(),
        series,
        earned,
        spent,
        targets_hit,
        target_days,
        focus_apps: top_apps(conn, "focus", &start_id, &end_id)?,
        rest_apps: top_apps(conn, "distract", &start_id, &end_id)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrate(&c).unwrap();
        c
    }

    fn at(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    #[test]
    fn day_round_trips() {
        let c = mem();
        let d = Day { focus: 10.0, earned: 2.0, target: Some(3600.0), hit: true, bonus: 1800.0, rest_plan: 60.0, ..Day::default() };
        save_day(&c, "2026-10-12", &d).unwrap();
        assert_eq!(load_day(&c, "2026-10-12").unwrap(), d);
        assert_eq!(load_day(&c, "2026-10-13").unwrap(), Day::default());
    }

    #[test]
    fn today_series_marks_gaps_future_and_sums_slots() {
        let c = mem();
        add_slot(&c, "2026-10-13", 40, 30.0, 0.0).unwrap();
        add_slot(&c, "2026-10-13", 40, 20.0, 5.0).unwrap();
        add_slot(&c, "2026-10-13", 41, 0.0, 0.0).unwrap();
        let ins = insights(&c, "today", at("2026-10-13 10:20")).unwrap();
        assert_eq!(ins.series.len(), 96);
        assert_eq!(ins.series[40].label, "10:00");
        assert_eq!((ins.series[40].focus, ins.series[40].distract, ins.series[40].present), (50.0, 5.0, true));
        assert!(ins.series[41].present && !ins.series[41].future);
        assert!(!ins.series[39].present);
        assert!(ins.series[42].future);
    }

    #[test]
    fn week_series_buckets_two_hours_from_monday() {
        let c = mem();
        // Tuesday 08:00–09:59 is bucket 4 of day 1.
        add_slot(&c, "2026-10-13", 32, 100.0, 0.0).unwrap();
        add_slot(&c, "2026-10-13", 39, 50.0, 10.0).unwrap();
        let ins = insights(&c, "week", at("2026-10-13 12:00")).unwrap();
        assert_eq!(ins.series.len(), 84);
        let p = &ins.series[12 + 4];
        assert_eq!((p.label.as_str(), p.focus, p.distract, p.present), ("Tue", 150.0, 10.0, true));
        assert!(ins.series[12 + 7].future);
        assert!(!ins.series[11].future);
    }

    #[test]
    fn totals_and_targets_stop_at_today() {
        let c = mem();
        save_day(&c, "2026-10-12", &Day { earned: 100.0, spent: 30.0, target: Some(1.0), hit: true, ..Day::default() }).unwrap();
        save_day(&c, "2026-10-13", &Day { earned: 50.0, target: Some(1.0), ..Day::default() }).unwrap();
        save_day(&c, "2026-10-14", &Day { target: Some(1.0), ..Day::default() }).unwrap();
        let ins = insights(&c, "week", at("2026-10-13 12:00")).unwrap();
        assert_eq!((ins.earned, ins.spent, ins.targets_hit, ins.target_days), (150.0, 30.0, 1, 2));
    }

    #[test]
    fn top_apps_split_focus_and_rest() {
        let c = mem();
        add_app_time(&c, "2026-10-13", "Code", 300.0, 0.0).unwrap();
        add_app_time(&c, "2026-10-13", "Telegram", 0.0, 120.0).unwrap();
        add_app_time(&c, "2026-10-13", "Code", 100.0, 0.0).unwrap();
        let ins = insights(&c, "today", at("2026-10-13 12:00")).unwrap();
        assert_eq!(ins.focus_apps.len(), 1);
        assert_eq!((ins.focus_apps[0].name.as_str(), ins.focus_apps[0].secs), ("Code", 400.0));
        assert_eq!(ins.rest_apps[0].name, "Telegram");
    }
}
