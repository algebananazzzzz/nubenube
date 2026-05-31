//! Post-Stop drift state machine + cloudHealth — per-session and additive.
//!
//! Two-force model: WATER (tokens) grows the Nube's size (connector); FOCUS-vs-
//! DRIFT drives HEALTH (here), which resets daily. Idle (away) FREEZES health.
//!
//! Drift accrues ONLY while a Claude session is stopped-and-waiting for you AND
//! you're on a distraction app, and it STACKS across concurrently-waiting
//! sessions — each attributed to that session's own project. So 1 waiting
//! session = 1×, 4 waiting = 4×.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::Local;
use rusqlite::Connection;
use tauri::{AppHandle, Emitter};

use crate::dto::FocusTickDto;
use crate::watcher::{self, AppClass};
use crate::{db, notify, settings};

const RESET_BASELINE: f64 = 0.7;
/// A session waiting longer than this (e.g. closed terminal, never re-engaged)
/// is treated as abandoned and stops counting toward drift.
const ABANDON_SECS: u64 = 1800;

/// One Claude session that has stopped and is waiting for the user.
struct Waiting {
    since: Instant,
    project_id: Option<String>,
    notified: bool,
}

pub struct DriftRuntime {
    db_path: PathBuf,
    config_dir: PathBuf,
    state: String,
    project_id: Option<String>,
    project_name: String,
    health: f64,
    last_reset_day: String,
    last_tick: Instant,
    waiting: HashMap<String, Waiting>,
}

/// Summarize waiting sessions given each one's (project_id, elapsed_secs):
/// returns (total past-grace count, per-project past-grace counts, longest
/// elapsed among non-abandoned sessions). Pure -> unit-testable.
fn waiting_load(
    sessions: &[(Option<String>, u64)],
    grace: u64,
) -> (i64, HashMap<String, i64>, Option<u64>) {
    let mut total = 0i64;
    let mut per_project: HashMap<String, i64> = HashMap::new();
    let mut longest: Option<u64> = None;
    for (pid, elapsed) in sessions {
        if *elapsed > ABANDON_SECS {
            continue;
        }
        longest = Some(longest.map_or(*elapsed, |l| l.max(*elapsed)));
        if *elapsed >= grace {
            total += 1;
            let key = pid.clone().unwrap_or_else(|| "_".to_string());
            *per_project.entry(key).or_insert(0) += 1;
        }
    }
    (total, per_project, longest)
}

impl DriftRuntime {
    pub fn new(db_path: PathBuf, config_dir: PathBuf) -> Self {
        let mut rt = DriftRuntime {
            db_path,
            config_dir,
            state: "growing".to_string(),
            project_id: None,
            project_name: String::new(),
            health: RESET_BASELINE,
            last_reset_day: String::new(),
            last_tick: Instant::now(),
            waiting: HashMap::new(),
        };
        if let Ok(conn) = db::open(&rt.db_path) {
            if let Some(pid) = db::most_recent_project(&conn) {
                rt.adopt_project(&conn, &pid);
            }
        }
        rt
    }

    fn adopt_project(&mut self, conn: &Connection, pid: &str) {
        if self.project_id.as_deref() == Some(pid) {
            return;
        }
        let (h, d) = db::load_health(conn, pid);
        self.project_id = Some(pid.to_string());
        self.project_name = db::project_name(conn, pid);
        self.health = h;
        self.last_reset_day = d;
    }

    fn session_key(session_id: &str) -> String {
        if session_id.is_empty() {
            "_".to_string()
        } else {
            session_id.to_string()
        }
    }

    /// Stop hook: this session finished — begin its waiting window.
    pub fn handle_stop(&mut self, session_id: &str, cwd: &str) {
        let mut project_id = None;
        if let Ok(conn) = db::open(&self.db_path) {
            if let Some(pid) = db::resolve_project_by_cwd(&conn, cwd) {
                project_id = Some(pid.clone());
                self.adopt_project(&conn, &pid);
            }
        }
        self.waiting.insert(
            Self::session_key(session_id),
            Waiting { since: Instant::now(), project_id, notified: false },
        );
    }

    /// UserPromptSubmit hook: this session re-engaged.
    pub fn handle_reengage(&mut self, session_id: &str, cwd: &str) {
        self.waiting.remove(&Self::session_key(session_id));
        if let Ok(conn) = db::open(&self.db_path) {
            if let Some(pid) = db::resolve_project_by_cwd(&conn, cwd) {
                self.adopt_project(&conn, &pid);
            }
        }
    }

    /// Apply scaled decay to one project's health (active project tracked in
    /// `self.health`; others read/written straight to the DB).
    fn decay_project(&mut self, conn: &Connection, pid: &str, today: &str, decay: f64) {
        if self.project_id.as_deref() == Some(pid) {
            self.health = (self.health - decay).clamp(0.0, 1.0);
        } else {
            let (h, day) = db::load_health(conn, pid);
            let base = if day != today { RESET_BASELINE } else { h };
            db::save_health(conn, pid, (base - decay).clamp(0.0, 1.0), today);
        }
    }

    pub fn tick(&mut self, app: &AppHandle) {
        let now = Instant::now();
        let dt = (now - self.last_tick).as_secs_f64();
        self.last_tick = now;

        let s = settings::load(&self.config_dir);
        let snap = watcher::snapshot();
        let class = watcher::classify(&snap.app_name, &s);
        let today = Local::now().format("%Y-%m-%d").to_string();

        if self.project_id.is_none() {
            if let Ok(conn) = db::open(&self.db_path) {
                if let Some(pid) = db::most_recent_project(&conn) {
                    self.adopt_project(&conn, &pid);
                }
            }
        }

        if self.last_reset_day != today {
            self.health = RESET_BASELINE;
            self.last_reset_day = today.clone();
        }

        // drop abandoned sessions, then summarize what's still waiting
        self.waiting.retain(|_, w| (now - w.since).as_secs() <= ABANDON_SECS);
        let grace = s.sensitivity.grace_secs.max(0) as u64;
        let sessions: Vec<(Option<String>, u64)> = self
            .waiting
            .values()
            .map(|w| (w.project_id.clone(), (now - w.since).as_secs()))
            .collect();
        let (waiting_count, per_project, longest) = waiting_load(&sessions, grace);

        let paused = settings::is_paused(&s);
        let idle = snap.idle_secs > s.sensitivity.idle_threshold_secs as u64;
        let dts = dt.round() as i64;
        let conn = db::open(&self.db_path).ok();

        if paused || idle {
            // freeze every waiting clock so a break/away doesn't age the wait
            let frozen = Duration::from_secs_f64(dt);
            for w in self.waiting.values_mut() {
                w.since += frozen;
            }
            self.state = (if paused { "paused" } else { "idle" }).to_string();
            if idle && !paused {
                if let (Some(c), Some(pid)) = (&conn, self.project_id.clone()) {
                    db::add_drift(c, &pid, &today, 0, 0, dts);
                }
            }
        } else {
            match class {
                AppClass::Work => {
                    self.state = "growing".to_string();
                    self.health += s.sensitivity.recovery_per_min * dt / 60.0;
                    if let (Some(c), Some(pid)) = (&conn, self.project_id.clone()) {
                        db::add_drift(c, &pid, &today, dts, 0, 0);
                    }
                }
                AppClass::Distraction if waiting_count > 0 => {
                    self.state = "drifting".to_string();
                    if let Some(c) = &conn {
                        for (key, k) in &per_project {
                            let drift = dts * *k;
                            let decay = s.sensitivity.decay_per_min * (dt / 60.0) * (*k as f64);
                            let pid = if key == "_" {
                                self.project_id.clone()
                            } else {
                                Some(key.clone())
                            };
                            if let Some(pid) = pid {
                                db::add_drift(c, &pid, &today, 0, drift, 0);
                                self.decay_project(c, &pid, &today, decay);
                            }
                        }
                    }
                }
                _ => {
                    // distraction while Claude is still busy, or a neutral app -> hold
                    self.state = "growing".to_string();
                }
            }
        }

        self.health = self.health.clamp(0.0, 1.0);
        if let (Some(c), Some(pid)) = (&conn, self.project_id.clone()) {
            db::save_health(c, &pid, self.health, &today);
        }

        // gentle drift-moment: once per session, after grace + sustained drift
        if self.state == "drifting" {
            let mut fire = false;
            for w in self.waiting.values_mut() {
                let elapsed = (now - w.since).as_secs();
                if elapsed <= ABANDON_SECS && !w.notified && elapsed >= grace + 60 {
                    w.notified = true;
                    fire = true;
                }
            }
            if fire {
                let _ = app.emit("drift-moment", self.build_tick(&snap, class, longest, waiting_count));
                if s.drift_moment_intensity != "passive" {
                    notify::drift(app, &snap.app_name, &self.project_name);
                }
            }
        }

        let _ = app.emit("focus-tick", self.build_tick(&snap, class, longest, waiting_count));
    }

    fn build_tick(
        &self,
        snap: &watcher::Snapshot,
        class: AppClass,
        since_stop: Option<u64>,
        waiting_sessions: i64,
    ) -> FocusTickDto {
        FocusTickDto {
            ts: chrono::Utc::now().to_rfc3339(),
            app_id: snap.app_name.clone(),
            app_name: snap.app_name.clone(),
            app_class: class.as_str().to_string(),
            title: if snap.title.is_empty() { None } else { Some(snap.title.clone()) },
            idle_secs: snap.idle_secs as i64,
            state: self.state.clone(),
            active_project_id: self.project_id.clone(),
            active_project_name: if self.project_name.is_empty() {
                None
            } else {
                Some(self.project_name.clone())
            },
            cloud_health: self.health,
            seconds_since_claude_finished: since_stop.map(|x| x as i64),
            waiting_sessions,
        }
    }
}

/// Spawn the ~2s watcher loop.
pub fn start_watcher(app: AppHandle, runtime: Arc<Mutex<DriftRuntime>>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        if let Ok(mut rt) = runtime.lock() {
            rt.tick(&app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_waiting_session_is_one_x() {
        let (total, per_project, longest) =
            waiting_load(&[(Some("A".to_string()), 100)], 90);
        assert_eq!(total, 1);
        assert_eq!(per_project.get("A"), Some(&1));
        assert_eq!(longest, Some(100));
    }

    #[test]
    fn multiplier_counts_past_grace_sessions_per_project() {
        let sessions = vec![
            (Some("A".to_string()), 120),
            (Some("A".to_string()), 100),
            (Some("B".to_string()), 200),
            (Some("A".to_string()), 30),   // under grace — excluded from counts
            (Some("B".to_string()), 5000), // abandoned — excluded entirely
        ];
        let (total, per_project, longest) = waiting_load(&sessions, 90);
        assert_eq!(total, 3); // 2xA + 1xB past grace
        assert_eq!(per_project.get("A"), Some(&2));
        assert_eq!(per_project.get("B"), Some(&1));
        assert_eq!(longest, Some(200)); // 5000 abandoned -> excluded from longest
    }

    #[test]
    fn empty_session_id_buckets_under_fallback() {
        let (total, per_project, _) =
            waiting_load(&[(None, 100), (None, 100)], 90);
        assert_eq!(total, 2);
        assert_eq!(per_project.get("_"), Some(&2));
    }

    #[test]
    fn sub_grace_only_yields_zero_multiplier() {
        let (total, per_project, longest) =
            waiting_load(&[(Some("A".to_string()), 10)], 90);
        assert_eq!(total, 0);
        assert!(per_project.is_empty());
        assert_eq!(longest, Some(10)); // still drives the away-timer
    }
}
