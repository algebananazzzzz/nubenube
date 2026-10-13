//! The live engine. Once a second it reads the foreground app (or the browser
//! extension's focused site) and idle time, advances the economy, persists
//! today, hands the extension its block list, and emits `focus-tick`. Commands
//! (timer, targets, week plan) mutate it under the same mutex, so a command and
//! a tick never interleave.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use chrono::{Datelike, Local, NaiveDate, Timelike};
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::dto::FocusTick;
use crate::economy::{self, Day, Event, Foreground, Timer};
use crate::settings::{self, Settings};
use crate::{browser, db, notify, watcher};

/// Idle this long and you're away: nothing is earned or spent.
const IDLE_SECS: u64 = 120;
/// Cap on one tick's elapsed time so a suspend/resume gap isn't booked as focus.
const MAX_TICK_DT: f64 = 5.0;
/// Continuous seconds on a Rest app or site mid-timer before the drift notification.
const DRIFT_NOTIFY_SECS: f64 = 15.0;
const TIMER_KEY: &str = "timer";

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FocusEvent {
    TimerFinished { earned: f64, bonus: f64 },
    TargetHit { bonus: f64 },
}

pub struct Engine {
    conn: Connection,
    config_dir: PathBuf,
    monday: NaiveDate,
    week: Vec<Day>,
    timer: Option<Timer>,
    state: &'static str,
    app: String,
    away: bool,
    last_tick: Instant,
    settings: (Option<SystemTime>, Settings),
    drift_secs: f64,
    drift_notified: bool,
    last_app: String,
    browser: browser::Shared,
}

fn weekday(d: NaiveDate) -> usize {
    d.weekday().num_days_from_monday() as usize
}

fn load_week(conn: &Connection, monday: NaiveDate) -> rusqlite::Result<Vec<Day>> {
    (0..7).map(|i| db::load_day(conn, &db::day_id(monday + chrono::Duration::days(i)))).collect()
}

impl Engine {
    pub fn new(db_path: PathBuf, config_dir: PathBuf, browser: browser::Shared) -> rusqlite::Result<Self> {
        let conn = db::open(&db_path)?;
        let monday = db::monday_of(Local::now().date_naive());
        let week = load_week(&conn, monday)?;
        let timer = match db::get_meta(&conn, TIMER_KEY)? {
            Some(json) => serde_json::from_str(&json)
                .map_err(|e| log::warn!("dropping unreadable saved timer: {e}"))
                .ok(),
            None => None,
        };
        let settings = (settings::modified(&config_dir), settings::load(&config_dir));
        Ok(Engine {
            conn,
            config_dir,
            monday,
            week,
            state: economy::state(timer.is_some(), Foreground::Focus),
            timer,
            app: String::new(),
            away: false,
            last_tick: Instant::now(),
            settings,
            drift_secs: 0.0,
            drift_notified: false,
            last_app: String::new(),
            browser,
        })
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    /// Settings, re-read only when settings.json's mtime moves.
    pub fn settings(&mut self) -> &Settings {
        let mtime = settings::modified(&self.config_dir);
        if mtime != self.settings.0 {
            self.settings = (mtime, settings::load(&self.config_dir));
        }
        &self.settings.1
    }

    pub fn save_settings(&mut self, s: Settings) -> std::io::Result<()> {
        settings::save(&self.config_dir, &s)?;
        self.settings = (settings::modified(&self.config_dir), s);
        Ok(())
    }

    fn today(&mut self) -> rusqlite::Result<(NaiveDate, usize)> {
        let date = Local::now().date_naive();
        let monday = db::monday_of(date);
        if monday != self.monday {
            self.week = load_week(&self.conn, monday)?;
            self.monday = monday;
        }
        Ok((date, weekday(date)))
    }

    fn save_day(&self, i: usize) -> rusqlite::Result<()> {
        db::save_day(&self.conn, &db::day_id(self.monday + chrono::Duration::days(i as i64)), &self.week[i])
    }

    fn save_timer(&self) -> rusqlite::Result<()> {
        match &self.timer {
            Some(t) => db::set_meta(&self.conn, TIMER_KEY, &serde_json::to_string(t).expect("timer serializes")),
            None => db::delete_meta(&self.conn, TIMER_KEY),
        }
    }

    pub fn snapshot(&self) -> FocusTick {
        let t = self.timer.as_ref();
        FocusTick {
            state: self.state.to_string(),
            app: self.app.clone(),
            away: self.away,
            left: t.map_or(0.0, |t| t.left.max(0.0)),
            len: t.map_or(0.0, |t| t.len),
            run: t.map_or(0.0, |t| t.run),
            pending: t.map_or(0.0, |t| t.pending),
            weekday: weekday(Local::now().date_naive()),
            week: self.week.clone(),
            bank: economy::bank(&self.week),
            extension: self.browser.lock().expect("browser mutex poisoned").connected(),
        }
    }

    pub fn tick(&mut self, app: &AppHandle, snap: watcher::Snapshot) -> rusqlite::Result<()> {
        let now = Instant::now();
        let dt = (now - self.last_tick).as_secs_f64().min(MAX_TICK_DT);
        self.last_tick = now;

        let (date, wd) = self.today()?;
        let site = self.browser.lock().expect("browser mutex poisoned").site();
        let s = self.settings();
        let rules = s.rules();
        let blocked = s.blocked_sites();
        let away = snap.idle_secs >= IDLE_SECS;
        // An unlisted site takes the browser's own class.
        let class = site.as_deref().and_then(|d| s.site_class(d)).unwrap_or_else(|| s.class_of(&snap.app_name));
        let fg = if away {
            Foreground::Away
        } else if class == "rest" {
            Foreground::Rest
        } else {
            Foreground::Focus
        };
        let name = site.unwrap_or_else(|| snap.app_name.clone());

        let before = self.week[wd].clone();
        let events = economy::step(&mut self.timer, &mut self.week[wd], &rules, fg, dt);
        self.state = economy::state(self.timer.is_some(), fg);
        self.away = away;
        self.app = name;
        let block = if self.timer.is_some() { blocked } else { Vec::new() };
        self.browser.lock().expect("browser mutex poisoned").set_block(block);
        let focus = self.week[wd].focus - before.focus;
        let distract = self.week[wd].distract - before.distract;

        let day = db::day_id(date);
        let local = Local::now();
        let slot = (local.hour() * 60 + local.minute()) / db::SLOT_MINUTES;
        let tx = self.conn.unchecked_transaction()?;
        if !snap.app_name.is_empty() && snap.app_name != self.last_app {
            db::record_known_app(&tx, &snap.app_name)?;
        }
        db::save_day(&tx, &day, &self.week[wd])?;
        if !away {
            db::add_slot(&tx, &day, slot, focus, distract)?;
        }
        if !self.app.is_empty() && (focus > 0.0 || distract > 0.0) {
            db::add_app_time(&tx, &day, &self.app, focus, distract)?;
        }
        self.save_timer()?;
        tx.commit()?;
        self.last_app = snap.app_name;

        if self.state == "timerDrift" {
            self.drift_secs += dt;
            if !self.drift_notified && self.drift_secs >= DRIFT_NOTIFY_SECS {
                self.drift_notified = true;
                notify::drifted(app, &self.app);
            }
        } else {
            self.drift_secs = 0.0;
            self.drift_notified = false;
        }

        for ev in events {
            let ev = match ev {
                Event::Finished { earned, bonus } => {
                    notify::timer_done(app, earned);
                    FocusEvent::TimerFinished { earned, bonus }
                }
                Event::TargetHit { bonus } => FocusEvent::TargetHit { bonus },
            };
            app.emit("focus-event", ev).map_err(|e| log::warn!("emit focus-event: {e}")).ok();
        }
        self.emit(app);
        Ok(())
    }

    pub fn emit(&self, app: &AppHandle) {
        if let Err(e) = app.emit("focus-tick", self.snapshot()) {
            log::warn!("emit focus-tick: {e}");
        }
    }

    pub fn start_timer(&mut self, minutes: f64) -> Result<(), String> {
        if self.timer.is_some() {
            return Err("A timer is already running".into());
        }
        if !(1.0..=480.0).contains(&minutes) {
            return Err(format!("Timer length must be 1–480 minutes, got {minutes}"));
        }
        self.timer = Some(Timer::new(minutes));
        self.state = economy::state(true, Foreground::Focus);
        self.save_timer().map_err(|e| e.to_string())
    }

    /// Stop early. Returns the finish bonus that was forfeited.
    pub fn stop_timer(&mut self) -> Result<f64, String> {
        let forfeited = self.timer.take().map_or(0.0, |t| t.pending);
        self.state = economy::state(false, Foreground::Focus);
        self.save_timer().map_err(|e| e.to_string())?;
        Ok(forfeited)
    }

    /// Today's target can only go up, so it can't be lowered to dodge the bonus rule.
    pub fn set_target(&mut self, secs: f64) -> Result<(), String> {
        let (_, wd) = self.today().map_err(|e| e.to_string())?;
        if self.week[wd].target.is_some_and(|t| secs <= t) {
            return Err("Today's target can only be raised".into());
        }
        let bonus = self.settings().rules().target_bonus_secs;
        economy::apply_target(&mut self.week[wd], Some(secs), bonus);
        self.save_day(wd).map_err(|e| e.to_string())
    }

    pub fn set_day_target(&mut self, day: usize, secs: Option<f64>) -> Result<(), String> {
        let (_, wd) = self.today().map_err(|e| e.to_string())?;
        if day <= wd || day > 6 {
            return Err("Only later days this week can be planned".into());
        }
        self.week[day].target = secs.filter(|s| *s > 0.0);
        self.save_day(day).map_err(|e| e.to_string())
    }

    pub fn set_day_rest(&mut self, day: usize, secs: f64) -> Result<(), String> {
        let (_, wd) = self.today().map_err(|e| e.to_string())?;
        if day < wd || day > 6 {
            return Err("Past days can't be planned".into());
        }
        self.week[day].rest_plan = secs.max(0.0);
        self.save_day(day).map_err(|e| e.to_string())
    }
}

pub fn start(app: AppHandle, engine: Arc<Mutex<Engine>>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let snap = watcher::snapshot();
        let mut e = engine.lock().expect("engine mutex poisoned");
        if let Err(err) = e.tick(&app, snap) {
            log::error!("tick failed: {err}");
        }
    });
}
