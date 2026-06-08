//! Drift state machine + global `life` meter (additive). Integrated each tick
//! over elapsed `dt`:
//!   life += (HEAL·running − DRAIN·waiting)·(dt/60), clamped to [0, CAP]
//! R = BASELINE/time_to_death_min; HEAL = ratio·R per running window (any
//! foreground); DRAIN = R per waiting-past-grace session (distraction foreground
//! only). Idle (away) freezes the meter and every waiting clock; the daily reset
//! (local midnight) sets life = BASELINE. The two rate knobs vary per weekday.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{Datelike, Local, Timelike};
use rusqlite::Connection;
use tauri::{AppHandle, Emitter};

use crate::dto::FocusTickDto;
use crate::watcher::{self, AppClass};
use crate::{db, notify, settings};

/// Full / "par" life — the daily reset level and the 100% baseline marker.
pub const BASELINE: f64 = 100.0;
/// Banked over-charge headroom above baseline, as a fraction of baseline.
pub const BONUS_RATIO: f64 = 0.3;
/// Hard ceiling on life: baseline + banked bonus.
pub const CAP: f64 = BASELINE * (1.0 + BONUS_RATIO); // 130.0
/// Drop a session whose phase clock exceeds this without a `SessionEnd`. Only
/// force-kills (SIGKILL) miss the hook; graceful Ctrl+D/Ctrl+C still fire it.
/// The clock is frozen while idle/away, so this counts active-waiting time.
const ABANDON_SECS: u64 = 600;
/// Cap on a single tick's elapsed seconds, so a suspend/resume gap can't inject a
/// huge slug into the second-counters (the life meter is clamped regardless).
const MAX_TICK_DT: f64 = 10.0;

/// One Claude session, tracked across its lifecycle.
#[derive(Clone, Copy, PartialEq)]
enum SessionPhase {
    Idle,    // SessionStart seen, no prompt yet
    Running, // UserPromptSubmit — Claude is working (tokens flow)
    Waiting, // Stop — finished, waiting for the user
}

struct Session {
    project_id: Option<String>,
    phase: SessionPhase,
    since: Instant, // entered `phase` at this time (drives grace + countdown)
    notified: bool,
}

pub struct DriftRuntime {
    db_path: PathBuf,
    config_dir: PathBuf,
    state: String,
    project_id: Option<String>,
    project_name: String,
    /// `life` on the 0..CAP (130) scale. Field kept named `health` to limit churn.
    health: f64,
    last_reset_day: String,
    last_tick: Instant,
    sessions: HashMap<String, Session>, // session_id → lifecycle state (all live sessions, any phase)
    last_app_name: String,
    // reset-day-scoped activity totals, persisted in day_stats, emitted live.
    stats_day: String,
    active_secs: i64,
    distract_secs: i64,
    drift_secs: i64,     // wall-clock drifting secs (distraction while a turn waits)
    work_secs: i64,      // session-weighted Claude-working secs (Σ running·dt)
    monitored_secs: i64, // present-&-tracking wall-clock (everything but away)
    // settings cached by file mtime so the tick skips re-parsing unchanged ones.
    settings_cache: Option<(std::time::SystemTime, settings::Settings)>,
    // last life persisted to the DB; lets frozen/steady ticks skip the write.
    last_saved_life: f64,
}

/// Summarize waiting sessions given each one's (project_id, elapsed_secs):
/// returns (total past-grace count, per-project past-grace counts, longest
/// elapsed among non-abandoned sessions). Pure -> unit-testable.
fn waiting_load(
    sessions: &[(Option<&str>, u64)],
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
            let key = pid.unwrap_or("_").to_string();
            *per_project.entry(key).or_insert(0) += 1;
        }
    }
    (total, per_project, longest)
}

/// Net budget rate (%-points/min). Drain hits on ANY distraction at base rate
/// `R = baseline / budget_min`; a turn waiting on you multiplies the drain by
/// `multiplier`. HEAL = `ratio·R` per heal unit, where heal units = running
/// windows + 1 while the foreground is a work app (the +1x reward, stacks). Pure.
pub fn life_rate(
    on_distraction: bool,
    waiting: bool,
    running: i64,
    on_work_app: bool,
    baseline: f64,
    budget_min: f64,
    ratio: f64,
    multiplier: f64,
) -> f64 {
    let r = baseline / budget_min;
    let heal = ratio * r * (running + on_work_app as i64) as f64;
    let drain = if on_distraction {
        r * if waiting { multiplier } else { 1.0 }
    } else {
        0.0
    };
    heal - drain
}

/// Integrate `rate` (%-points/min) over `dt` seconds onto `life`, clamped to
/// [0, CAP]. When `frozen` (idle/paused) life does not change. Pure.
pub fn apply_life(life: f64, dt: f64, rate: f64, frozen: bool) -> f64 {
    if frozen {
        life
    } else {
        (life + rate * dt / 60.0).clamp(0.0, CAP)
    }
}

/// Convert a life rate (%-points/min) into signed budget-seconds/min for the
/// client timer: a 1× distraction (rate = −R) yields −60 (loses 1 min/min). Pure.
pub fn budget_rate_per_min(life_rate: f64, baseline: f64, budget_min: f64) -> f64 {
    life_rate * (budget_min * 60.0) / baseline
}

/// Canonical overlay/Home state from the live signals, by priority: idle (away,
/// or nothing happening) > on a distraction (drifting if a turn waits past grace,
/// else chillin) > waiting (turn waiting) > vibing (running) > idle.
/// focused = vibing+waiting; distracted = drifting+chillin. Pure.
pub fn focus_state(
    away: bool,
    on_distraction: bool,
    waiting_total: i64,
    waiting_past_grace: i64,
    running: i64,
) -> &'static str {
    if away {
        "idle"
    } else if on_distraction {
        if waiting_past_grace > 0 {
            "drifting"
        } else {
            "chillin"
        }
    } else if waiting_total > 0 {
        "waiting"
    } else if running > 0 {
        "vibing"
    } else {
        "idle"
    }
}

/// Weekday index (0=Mon … 6=Sun) for a "%Y-%m-%d" day id; 0 on parse failure. Pure.
fn weekday_index(day_id: &str) -> u8 {
    chrono::NaiveDate::parse_from_str(day_id, "%Y-%m-%d")
        .map(|d| d.weekday().num_days_from_monday() as u8)
        .unwrap_or(0)
}

impl DriftRuntime {
    pub fn new(db_path: PathBuf, config_dir: PathBuf) -> Self {
        let mut rt = DriftRuntime {
            db_path,
            config_dir,
            state: "idle".to_string(),
            project_id: None,
            project_name: String::new(),
            health: BASELINE,
            last_reset_day: String::new(),
            last_tick: Instant::now(),
            sessions: HashMap::new(),
            last_app_name: String::new(),
            stats_day: String::new(),
            active_secs: 0,
            distract_secs: 0,
            drift_secs: 0,
            work_secs: 0,
            monitored_secs: 0,
            settings_cache: None,
            last_saved_life: -1.0, // impossible value → first tick persists
        };
        if let Ok(conn) = db::open(&rt.db_path) {
            let (life, day) = db::load_life(&conn);
            rt.health = life;
            rt.last_reset_day = day;
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
        // Tracks the active project for telemetry attribution + the notification
        // name only; life is global (loaded once), not per-project.
        self.project_id = Some(pid.to_string());
        self.project_name = db::project_name(conn, pid);
    }

    fn session_key(session_id: &str) -> String {
        if session_id.is_empty() {
            "_".to_string()
        } else {
            session_id.to_string()
        }
    }

    fn upsert(&mut self, session_id: &str, cwd: &str, phase: SessionPhase) {
        let mut project_id = None;
        if let Ok(conn) = db::open(&self.db_path) {
            if let Some(pid) = db::resolve_project_by_cwd(&conn, cwd) {
                project_id = Some(pid.clone());
                self.adopt_project(&conn, &pid);
            }
        }
        let key = Self::session_key(session_id);
        let entry = self.sessions.entry(key).or_insert(Session {
            project_id: project_id.clone(),
            phase,
            since: Instant::now(),
            notified: false,
        });
        if project_id.is_some() {
            entry.project_id = project_id;
        }
        entry.phase = phase;
        entry.since = Instant::now();
        entry.notified = false;
    }

    /// SessionStart hook.
    pub fn handle_start(&mut self, session_id: &str, cwd: &str) {
        self.upsert(session_id, cwd, SessionPhase::Idle);
    }
    /// UserPromptSubmit hook: session is running (Claude working).
    pub fn handle_reengage(&mut self, session_id: &str, cwd: &str) {
        self.upsert(session_id, cwd, SessionPhase::Running);
    }
    /// Stop hook: session finished — begin its waiting window + countdown.
    pub fn handle_stop(&mut self, session_id: &str, cwd: &str) {
        self.upsert(session_id, cwd, SessionPhase::Waiting);
    }
    /// Mid-turn block (AskUserQuestion prompt / permission Notification): Claude
    /// is parked on you like a finished turn → Waiting. Back to Running on the
    /// next `reengage`. No-op if already Waiting, so grace/countdown aren't reset.
    pub fn handle_wait(&mut self, session_id: &str, cwd: &str) {
        let key = Self::session_key(session_id);
        if matches!(self.sessions.get(&key), Some(s) if s.phase == SessionPhase::Waiting) {
            return;
        }
        self.upsert(session_id, cwd, SessionPhase::Waiting);
    }
    /// SessionEnd hook: session removed.
    pub fn handle_end(&mut self, session_id: &str) {
        self.sessions.remove(&Self::session_key(session_id));
    }

    /// Settings, reusing the cached copy while settings.json's mtime is unchanged
    /// (the tick runs every 2s; `stat` beats a read + JSON parse).
    fn load_settings(&mut self) -> settings::Settings {
        let mtime = settings::modified(&self.config_dir);
        if let (Some(mt), Some((cached_mt, cached))) = (mtime, &self.settings_cache) {
            if mt == *cached_mt {
                return cached.clone();
            }
        }
        let s = settings::load(&self.config_dir);
        if let Some(mt) = mtime {
            self.settings_cache = Some((mt, s.clone()));
        }
        s
    }

    pub fn tick(&mut self, app: &AppHandle) {
        let now = Instant::now();
        let dt = (now - self.last_tick).as_secs_f64().min(MAX_TICK_DT);
        self.last_tick = now;

        let s = self.load_settings();
        let snap = watcher::snapshot();
        let class = watcher::classify(&snap.app_name, &s);

        // One connection for the whole tick (WAL covers the other threads).
        let mut conn = db::open(&self.db_path).ok();

        if !snap.app_name.is_empty() && snap.app_name != self.last_app_name {
            self.last_app_name = snap.app_name.clone();
            if let Some(c) = &conn {
                db::record_known_app(c, &snap.app_name);
            }
        }
        let now_local = Local::now();
        let today = now_local.format("%Y-%m-%d").to_string();

        if self.project_id.is_none() {
            if let Some(c) = &conn {
                if let Some(pid) = db::most_recent_project(c) {
                    self.adopt_project(c, &pid);
                }
            }
        }

        // Daily reset at local midnight: snaps life back to BASELINE on the first
        // tick of a new calendar day.
        let reset_day = today.clone();
        if self.last_reset_day != reset_day {
            self.health = BASELINE;
            self.last_reset_day = reset_day.clone();
        }
        // Rate knobs can vary per weekday (0=Mon … 6=Sun), keyed to the calendar day.
        let weekday = weekday_index(&reset_day);

        // evict sessions stuck in a phase past the abandon timeout (also catches
        // a missed SessionEnd).
        self.sessions.retain(|_, s| (now - s.since).as_secs() <= ABANDON_SECS);
        let grace = s.sensitivity.grace_secs.max(0) as u64;
        let waiting_list: Vec<(Option<&str>, u64)> = self
            .sessions
            .values()
            .filter(|s| s.phase == SessionPhase::Waiting)
            .map(|s| (s.project_id.as_deref(), (now - s.since).as_secs()))
            .collect();
        let (waiting_count, _per_project, _longest) = waiting_load(&waiting_list, grace);
        // waiting_count = past grace (drives DRAIN); waiting_total = all waiting
        // (shown immediately, including during grace).
        let waiting_total = waiting_list.len() as i64;
        let running_count = self
            .sessions
            .values()
            .filter(|s| s.phase == SessionPhase::Running)
            .count() as i64;

        let idle = snap.idle_secs > s.sensitivity.idle_threshold_secs as u64;
        let frozen = idle;
        let dts = dt.round() as i64;

        // life_rate gates the two forces (DRAIN: distraction only; HEAL: any
        // foreground), so pass the raw counts.
        let on_distraction = matches!(class, AppClass::Distraction);
        let on_work_app = matches!(class, AppClass::Work);
        let (budget_min, ratio) = settings::effective_rates(&s.sensitivity, weekday);
        let multiplier = s.sensitivity.waiting_multiplier.max(1.0);
        let waiting = waiting_count > 0; // past grace → X× escalation
        let rate = life_rate(on_distraction, waiting, running_count, on_work_app, BASELINE, budget_min, ratio, multiplier);
        // drifting is positional: on a distraction while a turn waits past grace.
        let drifting = !frozen && on_distraction && waiting;
        let budget_total_secs = (budget_min * 60.0).round() as i64;
        let budget_rate = budget_rate_per_min(rate, BASELINE, budget_min);

        if frozen {
            // freeze waiting clocks so a break doesn't age the wait (life is held
            // by apply_life's frozen no-op).
            let frozen_dur = Duration::from_secs_f64(dt);
            for session in self.sessions.values_mut() {
                if session.phase == SessionPhase::Waiting {
                    session.since += frozen_dur;
                }
            }
        }

        self.health = apply_life(self.health, dt, rate, frozen);

        // see `focus_state`.
        self.state =
            focus_state(idle, on_distraction, waiting_total, waiting_count, running_count)
                .to_string();

        // reset-day-scoped activity totals; reloaded from day_stats on day change
        // so a restart doesn't zero them.
        if self.stats_day != reset_day {
            let (a, d, dr, w, m) =
                conn.as_ref().map_or((0, 0, 0, 0, 0), |c| db::load_day_stats(c, &reset_day));
            self.active_secs = a;
            self.distract_secs = d;
            self.drift_secs = dr;
            self.work_secs = w;
            self.monitored_secs = m;
            self.stats_day = reset_day.clone();
        }
        // `active` = engaged time only (a session running/waiting, or on a
        // distraction), so idle minutes don't inflate it; focused = active − distract.
        let engaged = running_count > 0 || waiting_total > 0;
        let active_delta = if !frozen && (on_distraction || engaged) { dts } else { 0 };
        let distract_delta = if !frozen && on_distraction { dts } else { 0 };
        // `drift` = wall-clock drifting (distraction while a turn waits past grace);
        // `drifting` already implies !frozen.
        let drift_delta = if drifting { dts } else { 0 };
        // `work` is session-weighted (Σ running·dt); `monitored` is all tracked time.
        let work_delta = if !frozen { dts * running_count } else { 0 };
        let monitored_delta = if !frozen { dts } else { 0 };
        let stats_delta = active_delta > 0
            || distract_delta > 0
            || drift_delta > 0
            || work_delta > 0
            || monitored_delta > 0;
        if stats_delta {
            self.active_secs += active_delta;
            self.distract_secs += distract_delta;
            self.drift_secs += drift_delta;
            self.work_secs += work_delta;
            self.monitored_secs += monitored_delta;
        }

        // Every write this tick (per-app distraction, day totals, hourly
        // concurrency sample, life snapshot) commits in ONE transaction. All
        // Insights-only — none drives life. Life is persisted only when it
        // actually moved, so frozen/steady ticks write nothing.
        let life_changed = (self.health - self.last_saved_life).abs() > 1e-6;
        // Fold finished days' 5-min slots down to hourly (lazy + atomic), so
        // session_recent only ever holds the live day.
        if let Some(c) = conn.as_mut() {
            db::compact_stale(c, &today);
        }
        if let Some(c) = conn.as_mut() {
            if let Ok(tx) = c.transaction() {
                // Per-app Insights breakdown = TOTAL time on a distraction app
                // (not just drift), so it reflects all distraction, waiting or not.
                if distract_delta > 0 {
                    db::add_drift_by_app(&tx, &today, &snap.app_name, distract_delta);
                }
                if stats_delta {
                    db::add_day_stats(
                        &tx,
                        &reset_day,
                        active_delta,
                        distract_delta,
                        drift_delta,
                        work_delta,
                        monitored_delta,
                    );
                }
                // Mark this 5-min slot present (app running) so the graph shows a
                // gap for slots it wasn't, instead of a misleading zero.
                let slot = (now_local.hour() as i64 * 60 + now_local.minute() as i64) / 5;
                db::mark_session_slot(&tx, &today, slot);
                if distract_delta > 0 {
                    db::add_distract_sample(&tx, &today, slot, distract_delta);
                }
                if !frozen {
                    let total_sessions = running_count + waiting_total;
                    if total_sessions > 0 {
                        db::add_session_sample(&tx, &today, slot, total_sessions, dts);
                    }
                }
                if life_changed {
                    db::save_life(&tx, self.health, &reset_day);
                }
                if tx.commit().is_ok() && life_changed {
                    self.last_saved_life = self.health;
                }
            }
        }

        if self.state == "drifting" {
            let mut fire = false;
            for w in self.sessions.values_mut().filter(|s| s.phase == SessionPhase::Waiting) {
                let elapsed = (now - w.since).as_secs();
                if elapsed <= ABANDON_SECS && !w.notified && elapsed >= grace + 60 {
                    w.notified = true;
                    fire = true;
                }
            }
            if fire {
                let _ = app.emit("drift-moment", self.build_tick(&snap, waiting_total, running_count, budget_total_secs, budget_rate, frozen));
                if s.drift_moment_intensity != "passive" {
                    notify::drift(
                        app,
                        &snap.app_name,
                        &self.project_name,
                        s.notification_sound_name.as_deref(),
                        s.notification_sound_path.as_deref(),
                    );
                }
            }
        }

        let _ = app.emit("focus-tick", self.build_tick(&snap, waiting_total, running_count, budget_total_secs, budget_rate, frozen));
    }

    fn build_tick(
        &self,
        snap: &watcher::Snapshot,
        waiting_sessions: i64,
        running_sessions: i64,
        budget_total_secs: i64,
        budget_rate_per_min: f64,
        frozen: bool,
    ) -> FocusTickDto {
        FocusTickDto {
            ts: chrono::Utc::now().to_rfc3339(),
            state: self.state.clone(),
            app_name: snap.app_name.clone(),
            cloud_health: self.health, // `life` 0..CAP (130) = budget %, banked up to cap
            baseline: BASELINE,
            cap: CAP,
            waiting_sessions,
            running_sessions,
            budget_total_secs,
            budget_rate_per_min,
            active_secs_today: self.active_secs,
            distract_secs_today: self.distract_secs,
            drift_secs_today: self.drift_secs,
            work_secs_today: self.work_secs,
            monitored_secs_today: self.monitored_secs,
            frozen,
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
            waiting_load(&[(Some("A"), 100)], 90);
        assert_eq!(total, 1);
        assert_eq!(per_project.get("A"), Some(&1));
        assert_eq!(longest, Some(100));
    }

    #[test]
    fn multiplier_counts_past_grace_sessions_per_project() {
        let sessions = vec![
            (Some("A"), 120),
            (Some("A"), 100),
            (Some("B"), 200),
            (Some("A"), 30),   // under grace — excluded from counts
            (Some("B"), 5000), // abandoned — excluded entirely
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
        // (None entries bucket under the "_" fallback key)
        assert_eq!(total, 2);
        assert_eq!(per_project.get("_"), Some(&2));
    }

    #[test]
    fn sub_grace_only_yields_zero_multiplier() {
        let (total, per_project, longest) =
            waiting_load(&[(Some("A"), 10)], 90);
        assert_eq!(total, 0);
        assert!(per_project.is_empty());
        assert_eq!(longest, Some(10)); // still drives the away-timer
    }

    // ----- life_rate (the two forces, netted) -----

    const T: f64 = 30.0; // default daily budget (min)
    const RATIO: f64 = 0.1; // default earn-back ratio
    const X: f64 = 3.0; // default waiting multiplier
    // R = baseline / T = 100/30 ≈ 3.3333 %/min per 1× distraction.
    const R: f64 = BASELINE / T;

    #[test]
    fn base_drain_on_any_distraction() {
        // On a distraction, nothing waiting → 1× → −R.
        let r = life_rate(true, false, 0, false, BASELINE, T, RATIO, X);
        assert!((r - (-R)).abs() < 1e-9);
    }

    #[test]
    fn waiting_turn_multiplies_drain() {
        // On a distraction + a waiting turn → X× → −X·R.
        let r = life_rate(true, true, 0, false, BASELINE, T, RATIO, X);
        assert!((r - (-X * R)).abs() < 1e-9);
    }

    #[test]
    fn no_drain_off_distraction() {
        // Not on a distraction → no drain, even with a waiting turn.
        assert_eq!(life_rate(false, true, 0, false, BASELINE, T, RATIO, X), 0.0);
    }

    #[test]
    fn heal_when_running_regardless_of_foreground() {
        // One running window heals ratio·R whether or not the foreground is a
        // distraction (on a distraction it nets against the base drain).
        let on = life_rate(true, false, 1, false, BASELINE, T, RATIO, X);
        assert!((on - (RATIO * R - R)).abs() < 1e-9);
        let off = life_rate(false, false, 1, false, BASELINE, T, RATIO, X);
        assert!((off - RATIO * R).abs() < 1e-9);
    }

    #[test]
    fn enough_running_outpaces_base_drain() {
        // Many running windows out-heal a 1× distraction → net positive.
        let r = life_rate(true, false, 20, false, BASELINE, T, RATIO, X);
        assert!(r > 0.0);
    }

    #[test]
    fn budget_rate_is_one_min_per_min_at_base() {
        // 1× distraction loses exactly 60 budget-secs/min; X× loses X·60.
        let one = life_rate(true, false, 0, false, BASELINE, T, RATIO, X);
        assert!((budget_rate_per_min(one, BASELINE, T) - (-60.0)).abs() < 1e-9);
        let x = life_rate(true, true, 0, false, BASELINE, T, RATIO, X);
        assert!((budget_rate_per_min(x, BASELINE, T) - (-60.0 * X)).abs() < 1e-9);
    }

    #[test]
    fn work_app_heals_like_one_running() {
        // On a work app with no Claude sessions still heals at ratio·R (the +1x reward).
        let solo = life_rate(false, false, 0, true, BASELINE, T, RATIO, X);
        assert!((solo - RATIO * R).abs() < 1e-9);
        // Stacks: work app + 2 running windows = 3× heal.
        let stacked = life_rate(false, false, 2, true, BASELINE, T, RATIO, X);
        assert!((stacked - 3.0 * RATIO * R).abs() < 1e-9);
    }

    // ----- apply_life -----

    #[test]
    fn apply_life_drains_over_dt() {
        // 1× distraction for 60s → −R points.
        let rate = life_rate(true, false, 0, false, BASELINE, T, RATIO, X);
        let life = apply_life(BASELINE, 60.0, rate, false);
        assert!((life - (BASELINE - R)).abs() < 1e-9);
    }

    #[test]
    fn apply_life_clamps_at_zero() {
        // Huge drain can't push life below 0.
        let life = apply_life(5.0, 600.0, -R, false);
        assert_eq!(life, 0.0);
    }

    #[test]
    fn apply_life_clamps_at_cap() {
        // Healing can't push life above CAP (130).
        let life = apply_life(CAP - 1.0, 600.0, RATIO * R, false);
        assert_eq!(life, CAP);
    }

    #[test]
    fn apply_life_frozen_is_noop() {
        // Frozen (idle/paused): no change regardless of rate.
        assert_eq!(apply_life(73.0, 60.0, -R, true), 73.0);
        assert_eq!(apply_life(73.0, 60.0, RATIO * R, true), 73.0);
    }

    // ----- focus_state (the canonical state machine) -----

    #[test]
    fn state_vibing_when_running_not_distracted() {
        // Claude working, nothing waiting, neutral foreground → vibing.
        assert_eq!(focus_state(false, false, 0, 0, 2), "vibing");
    }

    #[test]
    fn state_waiting_when_turn_waiting_not_distracted() {
        // A turn is waiting, neutral foreground → waiting, even during grace
        // (waiting_total>0, past_grace=0) so the buddy reacts immediately.
        assert_eq!(focus_state(false, false, 1, 0, 0), "waiting");
        assert_eq!(focus_state(false, false, 1, 1, 1), "waiting");
    }

    #[test]
    fn state_drifting_on_distraction_with_waiting_past_grace() {
        // On a distraction while a turn waits past grace → drifting.
        assert_eq!(focus_state(false, true, 1, 1, 0), "drifting");
        // During grace (past_grace=0) it's not drifting yet → chillin.
        assert_eq!(focus_state(false, true, 1, 0, 0), "chillin");
    }

    #[test]
    fn state_chillin_on_distraction_nothing_waiting() {
        // On a distraction, nothing waiting → chillin — whether or not Claude is
        // running in the background.
        assert_eq!(focus_state(false, true, 0, 0, 0), "chillin");
        assert_eq!(focus_state(false, true, 0, 0, 3), "chillin");
    }

    #[test]
    fn state_idle_when_nothing_happening() {
        // No session, neutral foreground → idle.
        assert_eq!(focus_state(false, false, 0, 0, 0), "idle");
    }

    #[test]
    fn away_overrides_everything() {
        // Away (frozen) reads as idle even on a distraction with a waiting turn.
        assert_eq!(focus_state(true, true, 5, 5, 5), "idle");
    }

    // ----- weekday index (calendar day → 0=Mon … 6=Sun) -----

    #[test]
    fn weekday_index_maps_calendar_day() {
        assert_eq!(weekday_index("2026-06-08"), 0); // Monday
        assert_eq!(weekday_index("2026-06-14"), 6); // Sunday
        assert_eq!(weekday_index("garbage"), 0); // parse failure → 0
    }
}
