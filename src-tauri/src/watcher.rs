//! Active-window + idle snapshot and work/distraction classification.
//!
//! macOS: app name needs NO permission (window title needs Screen Recording, so
//! it may be empty); idle via CGEventSource needs NO permission.
//! Linux: X11 full; Wayland best-effort (app name may be empty).

use crate::settings::Settings;

pub struct Snapshot {
    pub app_name: String,
    pub title: String,
    pub idle_secs: u64,
}

#[derive(Clone, Copy)]
pub enum AppClass {
    Work,
    Distraction,
    Neutral,
}

impl AppClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            AppClass::Work => "work",
            AppClass::Distraction => "distraction",
            AppClass::Neutral => "neutral",
        }
    }
}

pub fn snapshot() -> Snapshot {
    let (app_name, title) = match active_win_pos_rs::get_active_window() {
        Ok(w) => (w.app_name, w.title),
        Err(_) => (String::new(), String::new()),
    };
    let idle_secs = user_idle::UserIdle::get_time()
        .map(|u| u.as_seconds())
        .unwrap_or(0);
    Snapshot { app_name, title, idle_secs }
}

fn matches(app_lower: &str, list: &[String]) -> bool {
    list.iter().any(|x| {
        let x = x.to_lowercase();
        !x.is_empty() && (app_lower.contains(&x) || x.contains(app_lower))
    })
}

pub fn classify(app_name: &str, settings: &Settings) -> AppClass {
    if app_name.is_empty() {
        return AppClass::Neutral;
    }
    let a = app_name.to_lowercase();
    if matches(&a, &settings.distraction_apps) {
        return AppClass::Distraction;
    }
    if matches(&a, &settings.work_apps) {
        return AppClass::Work;
    }
    AppClass::Neutral
}
