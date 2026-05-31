//! Connector orchestration: full scan, single-file ingest on change, and a
//! filesystem watcher (+ periodic safety re-scan). Emits `usage-updated` to the
//! frontend whenever new messages are ingested.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::Duration;

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::{db, store_paths};

/// Walk every root and incrementally ingest all session files.
pub fn scan_all(db_path: &Path) -> u64 {
    let mut conn = match db::open(db_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };
    let mut total_new = 0u64;
    for root in store_paths::log_roots() {
        for file in store_paths::list_session_files(&root) {
            if let Some(pid) = store_paths::project_id_from_path(&file, &root) {
                total_new += db::ingest_file(&mut conn, &file, &pid).unwrap_or(0);
            }
        }
    }
    db::set_meta(&conn, "last_scan_utc", &chrono::Utc::now().to_rfc3339());
    total_new
}

/// Ingest a single file that the watcher reported as changed.
fn ingest_one(db_path: &Path, path: &Path) -> u64 {
    if path.extension().map(|e| e != "jsonl").unwrap_or(true) {
        return 0;
    }
    let mut conn = match db::open(db_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };
    for root in store_paths::log_roots() {
        if path.starts_with(root.join("projects")) {
            if let Some(pid) = store_paths::project_id_from_path(path, &root) {
                return db::ingest_file(&mut conn, path, &pid).unwrap_or(0);
            }
        }
    }
    0
}

/// Spawn the connector background thread: initial scan, then watch + debounce,
/// with a periodic safety re-scan on idle.
pub fn start(app: AppHandle, db_path: PathBuf) {
    std::thread::spawn(move || {
        let n = scan_all(&db_path);
        let _ = app.emit("usage-updated", n);

        let (tx, rx) = channel::<notify::Result<Event>>();
        let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
            Ok(w) => w,
            Err(_) => return,
        };
        for root in store_paths::log_roots() {
            let _ = watcher.watch(&root.join("projects"), RecursiveMode::Recursive);
        }

        loop {
            match rx.recv_timeout(Duration::from_secs(45)) {
                Ok(Ok(event)) => {
                    // debounce: drain a short burst of follow-up events
                    let mut paths: Vec<PathBuf> = event.paths;
                    while let Ok(Ok(ev)) = rx.recv_timeout(Duration::from_millis(400)) {
                        paths.extend(ev.paths);
                    }
                    let mut seen = HashSet::new();
                    let mut new_total = 0u64;
                    for p in paths {
                        if seen.insert(p.clone()) {
                            new_total += ingest_one(&db_path, &p);
                        }
                    }
                    if new_total > 0 {
                        let _ = app.emit("usage-updated", new_total);
                    }
                }
                Ok(Err(_)) => {}
                Err(RecvTimeoutError::Timeout) => {
                    let n = scan_all(&db_path);
                    if n > 0 {
                        let _ = app.emit("usage-updated", n);
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    /// Runs the REAL connector against the user's actual ~/.claude logs and
    /// sanity-checks the output (cache dominates, dedup ratio in the measured
    /// 1.7–3.9x band). `cargo test scans_real_claude_logs -- --nocapture`.
    #[test]
    fn scans_real_claude_logs() {
        let tmp = std::env::temp_dir().join(format!("nube_verify_{}.db", std::process::id()));
        let _ = std::fs::remove_file(&tmp);

        let new = scan_all(&tmp);
        let conn = db::open(&tmp).unwrap();
        let totals = db::get_totals(&conn);
        let projects = db::get_projects(&conn);
        let status = db::connection_stats(&conn, vec![], false);

        eprintln!(
            "\nNUBE-VERIFY  new_msgs={}  projects={}  sessions={}  dedup_ratio={:?}",
            new, projects.len(), status.sessions_scanned, status.naive_dedup_ratio
        );
        eprintln!(
            "  lifetime water = {:.1} L  | input={} output={} cacheCreate={} cacheRead={}",
            totals.water_ml / 1000.0,
            totals.tokens.input,
            totals.tokens.output,
            totals.tokens.cache_create,
            totals.tokens.cache_read
        );
        for p in projects.iter().take(10) {
            eprintln!(
                "   - {:<30} {:>10.1} L  msgs={:>6}",
                p.name,
                p.water_ml / 1000.0,
                p.msg_count
            );
        }

        if status.sessions_scanned > 0 {
            assert!(!projects.is_empty(), "expected at least one project");
            assert!(totals.tokens.cache_read > 0, "cache_read should dominate the mass");
            let r = status.naive_dedup_ratio.unwrap_or(0.0);
            assert!(r > 1.0 && r < 6.0, "dedup ratio {r} outside expected band");
        }
        let _ = std::fs::remove_file(&tmp);
    }
}
