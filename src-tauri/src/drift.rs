//! Drift state machine + `life` meter (per-session, additive). Integrated each
//! tick over elapsed `dt`:
//!   life += (HEAL·running − DRAIN·waiting)·(dt/60), clamped to [0, CAP]
//! R = BASELINE/time_to_death_min; HEAL = ratio·R per running window (any
//! foreground); DRAIN = R per waiting-past-grace session (distraction foreground
//! only). Idle/paused freezes the meter and every waiting clock; the daily reset
//! (resetTimeLocal) sets life = BASELINE.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{Local, NaiveTime, Timelike};
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
    work_secs: i64,      // session-weighted Claude-working secs (Σ running·dt)
    monitored_secs: i64, // present-&-tracking wall-clock (everything but paused/away)
    // settings cached by file mtime so the tick skips re-parsing unchanged ones.
    settings_cache: Option<(std::time::SystemTime, settings::Settings)>,
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

/// Net life rate (%-points/min): `ratio·R·running − (on_distraction ? R·waiting
/// : 0)`, R = baseline/T. HEAL applies whenever running; DRAIN only on a
/// distraction foreground. Pure.
pub fn life_rate(
    on_distraction: bool,
    waiting: i64,
    running: i64,
    baseline: f64,
    time_to_death_min: f64,
    ratio: f64,
) -> f64 {
    let r = baseline / time_to_death_min;
    let heal = ratio * r * running as f64;
    let drain = if on_distraction { r * waiting as f64 } else { 0.0 };
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

/// Seconds until life hits 0 at the current net rate; Some only while draining
/// (`rate < 0`), None when holding/healing. life includes banked bonus. Pure.
pub fn countdown_secs(life: f64, rate: f64) -> Option<i64> {
    if rate < 0.0 {
        Some(((life / -rate) * 60.0).round() as i64)
    } else {
        None
    }
}

/// Canonical overlay/Home state from the live signals, by priority: paused >
/// idle (away, or nothing happening) > on a distraction (drifting if a turn
/// waits past grace, else chillin) > waiting (turn waiting) > vibing (running) >
/// idle. focused = vibing+waiting; distracted = drifting+chillin. Pure.
pub fn focus_state(
    paused: bool,
    away: bool,
    on_distraction: bool,
    waiting_total: i64,
    waiting_past_grace: i64,
    running: i64,
) -> &'static str {
    if paused {
        "paused"
    } else if away {
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

/// "Reset day" id (`%Y-%m-%d`) for `now` given the local reset time `HH:MM`. The
/// boundary is that time, not midnight: before it, the slate is yesterday's. Pure.
fn reset_day_id(now: &chrono::DateTime<Local>, reset_time_local: &str) -> String {
    let reset = NaiveTime::parse_from_str(reset_time_local, "%H:%M")
        .unwrap_or_else(|_| NaiveTime::from_hms_opt(5, 0, 0).unwrap());
    let now_mins = now.hour() * 60 + now.minute();
    let reset_mins = reset.hour() * 60 + reset.minute();
    if now_mins >= reset_mins {
        now.format("%Y-%m-%d").to_string()
    } else {
        (now.date_naive() - chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string()
    }
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
            work_secs: 0,
            monitored_secs: 0,
            settings_cache: None,
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
        let dt = (now - self.last_tick).as_secs_f64();
        self.last_tick = now;

        let s = self.load_settings();
        let snap = watcher::snapshot();
        let class = watcher::classify(&snap.app_name, &s);

        // One connection for the whole tick (WAL covers the other threads).
        let conn = db::open(&self.db_path).ok();

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

        // Daily reset keyed to resetTimeLocal (not midnight): snaps life back to
        // BASELINE on the first tick of a new reset-day.
        let reset_day = reset_day_id(&now_local, &s.reset_time_local);
        if self.last_reset_day != reset_day {
            self.health = BASELINE;
            self.last_reset_day = reset_day.clone();
        }

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
        let (waiting_count, per_project, _longest) = waiting_load(&waiting_list, grace);
        // waiting_count = past grace (drives DRAIN); waiting_total = all waiting
        // (shown immediately, including during grace).
        let waiting_total = waiting_list.len() as i64;
        let running_count = self
            .sessions
            .values()
            .filter(|s| s.phase == SessionPhase::Running)
            .count() as i64;

        let paused = settings::is_paused(&s);
        let idle = snap.idle_secs > s.sensitivity.idle_threshold_secs as u64;
        let frozen = paused || idle;
        let dts = dt.round() as i64;

        // life_rate gates the two forces (DRAIN: distraction only; HEAL: any
        // foreground), so pass the raw counts.
        let on_distraction = matches!(class, AppClass::Distraction);
        let rate = life_rate(
            on_distraction,
            waiting_count,
            running_count,
            BASELINE,
            s.sensitivity.time_to_death_min,
            s.sensitivity.heal_drain_ratio,
        );
        // drifting is positional (distraction + a turn past grace), not net-rate-
        // gated; the countdown may still be None if running out-heals the bleed.
        let drifting = !frozen && on_distraction && waiting_count > 0;

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
            focus_state(paused, idle, on_distraction, waiting_total, waiting_count, running_count)
                .to_string();

        // Per-project/app attribution for Insights (distraction, active-work,
        // idle-wait secs); no longer drives life.
        if let Some(c) = &conn {
            if frozen {
                if idle && !paused {
                    if let Some(pid) = self.project_id.as_deref() {
                        db::add_drift(c, pid, &today, 0, 0, dts, 0);
                    }
                }
            } else if drifting {
                for (key, kx) in &per_project {
                    let drift = dts * *kx;
                    let pid = if key == "_" { self.project_id.as_deref() } else { Some(key.as_str()) };
                    if let Some(pid) = pid {
                        db::add_drift(c, pid, &today, 0, drift, 0, 0);
                    }
                }
                // per-app distraction time for Insights.
                db::add_drift_by_app(c, &today, &snap.app_name, dts);
            } else if running_count > 0 {
                if let Some(pid) = self.project_id.as_deref() {
                    db::add_drift(c, pid, &today, dts, 0, 0, 0); // honest "active" secs
                }
            } else if waiting_total > 0 {
                if let Some(pid) = self.project_id.as_deref() {
                    db::add_drift(c, pid, &today, 0, 0, 0, dts); // Claude idle, waiting on you
                }
            }
        }

        // reset-day-scoped activity totals; reloaded from day_stats on day change
        // so a restart doesn't zero them.
        if self.stats_day != reset_day {
            let (a, d, w, m) =
                conn.as_ref().map_or((0, 0, 0, 0), |c| db::load_day_stats(c, &reset_day));
            self.active_secs = a;
            self.distract_secs = d;
            self.work_secs = w;
            self.monitored_secs = m;
            self.stats_day = reset_day.clone();
        }
        // `active` = engaged time only (a session running/waiting, or on a
        // distraction), so idle minutes don't inflate it; focused = active − distract.
        let engaged = running_count > 0 || waiting_total > 0;
        let active_delta = if !frozen && (on_distraction || engaged) { dts } else { 0 };
        let distract_delta = if !frozen && on_distraction { dts } else { 0 };
        // `work` is session-weighted (Σ running·dt); `monitored` is all tracked time.
        let work_delta = if !frozen { dts * running_count } else { 0 };
        let monitored_delta = if !frozen { dts } else { 0 };
        if active_delta > 0 || distract_delta > 0 || work_delta > 0 || monitored_delta > 0 {
            self.active_secs += active_delta;
            self.distract_secs += distract_delta;
            self.work_secs += work_delta;
            self.monitored_secs += monitored_delta;
            if let Some(c) = &conn {
                db::add_day_stats(
                    c,
                    &reset_day,
                    active_delta,
                    distract_delta,
                    work_delta,
                    monitored_delta,
                );
            }
        }

        // Concurrency history (peak + time-weighted avg) at hourly resolution so
        // the insights time graph can plot the whole period; idle/paused excluded.
        if !frozen {
            let total_sessions = running_count + waiting_total;
            if total_sessions > 0 {
                if let Some(c) = &conn {
                    db::add_session_sample(c, &today, now_local.hour() as i64, total_sessions, dts);
                }
            }
        }

        if let (Some(c), Some(pid)) = (&conn, self.project_id.as_deref()) {
            db::save_health(c, pid, self.health, &reset_day);
        }

        // Honest net-rate countdown: Some only while net-draining (drifting).
        let seconds_to_death = countdown_secs(self.health, rate);
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
                let _ = app.emit("drift-moment", self.build_tick(&snap, waiting_total, running_count, seconds_to_death, frozen));
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

        let _ = app.emit("focus-tick", self.build_tick(&snap, waiting_total, running_count, seconds_to_death, frozen));
    }

    fn build_tick(
        &self,
        snap: &watcher::Snapshot,
        waiting_sessions: i64,
        running_sessions: i64,
        seconds_to_death: Option<i64>,
        frozen: bool,
    ) -> FocusTickDto {
        FocusTickDto {
            ts: chrono::Utc::now().to_rfc3339(),
            state: self.state.clone(),
            app_name: snap.app_name.clone(),
            cloud_health: self.health, // now `life` on the 0..CAP (130) scale
            baseline: BASELINE,
            cap: CAP,
            waiting_sessions,
            running_sessions,
            seconds_to_death,
            active_secs_today: self.active_secs,
            distract_secs_today: self.distract_secs,
            work_secs_today: self.work_secs,
            monitored_secs_today: self.monitored_secs,
            frozen,
            color_hue: self
                .project_id
                .as_deref()
                .map(crate::water::hue_for)
                .unwrap_or(222),
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

    const T: f64 = 12.0; // default time-to-death (min)
    const RATIO: f64 = 0.1; // default heal/drain ratio
    // R = baseline / T = 100/12 ≈ 8.3333 %/min per waiting session.
    const R: f64 = BASELINE / T;

    #[test]
    fn r_equals_baseline_over_t() {
        // The base rate identity: one waiting session on a distraction drains R%/min.
        let rate = life_rate(true, 1, 0, BASELINE, T, RATIO);
        assert!((rate - (-R)).abs() < 1e-9);
        assert!((R - 8.333333333).abs() < 1e-6);
    }

    #[test]
    fn drain_only_when_on_distraction() {
        // 2 waiting on a distraction, no running → −2R%/min.
        let r = life_rate(true, 2, 0, BASELINE, T, RATIO);
        assert!((r - (-2.0 * R)).abs() < 1e-9);
        // Same waiting but NOT on a distraction → no drain at all.
        assert_eq!(life_rate(false, 2, 0, BASELINE, T, RATIO), 0.0);
    }

    #[test]
    fn heal_only_when_running() {
        // 1 running window heals ratio·R, regardless of foreground (distraction or not).
        let on = life_rate(true, 0, 1, BASELINE, T, RATIO);
        let off = life_rate(false, 0, 1, BASELINE, T, RATIO);
        assert!((on - RATIO * R).abs() < 1e-9);
        assert!((off - RATIO * R).abs() < 1e-9);
        // More windows heal faster.
        assert!((life_rate(false, 0, 3, BASELINE, T, RATIO) - 3.0 * RATIO * R).abs() < 1e-9);
    }

    #[test]
    fn heal_nets_against_drain() {
        // On a distraction with 1 waiting and 1 running: net = ratio·R − R = −0.9R.
        let r = life_rate(true, 1, 1, BASELINE, T, RATIO);
        assert!((r - (RATIO * R - R)).abs() < 1e-9);
        assert!(r < 0.0);
        // Ten running windows out-heal one waiting session → net positive.
        let r2 = life_rate(true, 1, 10, BASELINE, T, RATIO);
        assert!((r2 - (10.0 * RATIO * R - R)).abs() < 1e-9);
        assert!(r2 > 0.0);
    }

    #[test]
    fn ten_min_work_equals_one_min_distraction() {
        // The user's intended rule at ratio=0.1: heal per running = ratio·R,
        // drain per waiting = R, so 10 min of 1 running = 1 min of 1 waiting.
        let heal_per_min = RATIO * R; // life gained / min by one running window
        let drain_per_min = R; // life lost / min by one ignored waiting session
        assert!((heal_per_min * 10.0 - drain_per_min * 1.0).abs() < 1e-9);
    }

    // ----- apply_life -----

    #[test]
    fn apply_life_drains_over_dt() {
        // 1 waiting on a distraction for 60s at default settings → −R points.
        let rate = life_rate(true, 1, 0, BASELINE, T, RATIO);
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

    // ----- countdown_secs (honest net rate) -----

    #[test]
    fn countdown_some_only_when_net_draining() {
        // Net-draining at full baseline, 1 waiting on a distraction: 100 / R min.
        let rate = life_rate(true, 1, 0, BASELINE, T, RATIO);
        let expected = ((BASELINE / R) * 60.0).round() as i64; // == T·60 = 720s
        assert_eq!(countdown_secs(BASELINE, rate), Some(expected));
        assert_eq!(countdown_secs(BASELINE, rate), Some(720));
        // Net ≥ 0 → no countdown.
        assert_eq!(countdown_secs(BASELINE, 0.0), None);
        assert_eq!(countdown_secs(BASELINE, RATIO * R), None);
    }

    #[test]
    fn countdown_scales_with_waiting_shrinks_with_running() {
        // 4 waiting drains 4× as fast → countdown ~1/4 as long.
        let one = countdown_secs(BASELINE, life_rate(true, 1, 0, BASELINE, T, RATIO)).unwrap();
        let four = countdown_secs(BASELINE, life_rate(true, 4, 0, BASELINE, T, RATIO)).unwrap();
        assert_eq!(four, (one as f64 / 4.0).round() as i64);
        // Adding a running window softens the drain → longer countdown.
        let softened =
            countdown_secs(BASELINE, life_rate(true, 4, 1, BASELINE, T, RATIO)).unwrap();
        assert!(softened > four);
    }

    // ----- focus_state (the canonical 5-state machine) -----

    #[test]
    fn state_vibing_when_running_not_distracted() {
        // Claude working, nothing waiting, neutral foreground → vibing (state 1).
        assert_eq!(focus_state(false, false, false, 0, 0, 2), "vibing");
    }

    #[test]
    fn state_waiting_when_turn_waiting_not_distracted() {
        // A turn is waiting, neutral foreground → waiting (state 2), even during
        // grace (waiting_total>0, past_grace=0) so the buddy reacts immediately.
        assert_eq!(focus_state(false, false, false, 1, 0, 0), "waiting");
        assert_eq!(focus_state(false, false, false, 1, 1, 1), "waiting");
    }

    #[test]
    fn state_drifting_on_distraction_with_waiting_past_grace() {
        // On a distraction while a turn waits past grace → drifting (state 3).
        assert_eq!(focus_state(false, false, true, 1, 1, 0), "drifting");
        // During grace (past_grace=0) it's not drifting yet → chillin.
        assert_eq!(focus_state(false, false, true, 1, 0, 0), "chillin");
    }

    #[test]
    fn state_chillin_on_distraction_nothing_waiting() {
        // On a distraction, nothing waiting → chillin (state 4) — whether or not
        // Claude is running in the background.
        assert_eq!(focus_state(false, false, true, 0, 0, 0), "chillin");
        assert_eq!(focus_state(false, false, true, 0, 0, 3), "chillin");
    }

    #[test]
    fn state_idle_when_nothing_happening() {
        // No session, neutral foreground → idle (state 5).
        assert_eq!(focus_state(false, false, false, 0, 0, 0), "idle");
    }

    #[test]
    fn state_paused_and_away_override_everything() {
        // Paused beats all, including a distraction with a waiting turn.
        assert_eq!(focus_state(true, false, true, 5, 5, 5), "paused");
        // Away (frozen) reads as idle even on a distraction with a waiting turn.
        assert_eq!(focus_state(false, true, true, 5, 5, 5), "idle");
        // Paused wins over away.
        assert_eq!(focus_state(true, true, true, 1, 1, 1), "paused");
    }

    // ----- daily reset keyed to resetTimeLocal -----

    fn at(h: u32, m: u32) -> chrono::DateTime<Local> {
        use chrono::TimeZone;
        Local.with_ymd_and_hms(2026, 6, 1, h, m, 0).unwrap()
    }

    #[test]
    fn reset_day_id_before_reset_time_belongs_to_yesterday() {
        // At 04:30 with reset 05:00, the slate is still 2026-05-31's.
        assert_eq!(reset_day_id(&at(4, 30), "05:00"), "2026-05-31");
        // At 05:00 exactly, we flip to today's slate.
        assert_eq!(reset_day_id(&at(5, 0), "05:00"), "2026-06-01");
        // Later in the day stays on today's slate.
        assert_eq!(reset_day_id(&at(23, 59), "05:00"), "2026-06-01");
    }

    #[test]
    fn daily_reset_fires_once_at_reset_time() {
        // Yesterday's slate persisted; first tick at/after reset time is a new day.
        let last = "2026-05-31".to_string();
        // Before reset time → still yesterday's slate → no reset.
        assert_eq!(reset_day_id(&at(4, 59), "05:00"), last);
        // At reset time → new slate id → reset fires.
        let new_day = reset_day_id(&at(5, 0), "05:00");
        assert_ne!(new_day, last);
        assert_eq!(new_day, "2026-06-01");
        // A later tick the same day yields the same id → no second reset.
        assert_eq!(reset_day_id(&at(9, 0), "05:00"), new_day);
    }
}
