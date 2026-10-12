//! Active-window + idle snapshot and work/distraction classification.
//!
//! macOS: app name needs NO permission (window title needs Screen Recording, so
//! it may be empty); idle via CGEventSource needs NO permission.
//! Linux: X11 full; Wayland best-effort (app name may be empty), idle via
//! Mutter on GNOME.

use crate::settings::Settings;

pub struct Snapshot {
    pub app_name: String,
    pub idle_secs: u64,
}

#[derive(Clone, Copy, PartialEq)]
pub enum AppClass {
    Distraction,
    Work,
    Neutral,
}

pub fn snapshot() -> Snapshot {
    let app_name = match active_win_pos_rs::get_active_window() {
        Ok(w) => w.app_name,
        Err(_) => String::new(),
    };
    Snapshot { app_name, idle_secs: idle_secs() }
}

#[cfg(not(target_os = "linux"))]
fn idle_secs() -> u64 {
    user_idle::UserIdle::get_time()
        .map(|u| u.as_seconds())
        .unwrap_or(0)
}

/// GNOME's Mutter IdleMonitor first: it answers on Wayland, where the
/// XScreenSaver extension is missing from XWayland. XScreenSaver remains for
/// other X11 desktops, but each failed query makes Xlib print to stderr, so
/// it is abandoned after the first failure.
#[cfg(target_os = "linux")]
fn idle_secs() -> u64 {
    use std::sync::atomic::{AtomicBool, Ordering};
    static X11_FAILED: AtomicBool = AtomicBool::new(false);

    if let Some(ms) = mutter_idle_ms() {
        return ms / 1000;
    }
    if !X11_FAILED.load(Ordering::Relaxed) {
        match user_idle::UserIdle::get_time() {
            Ok(u) => return u.as_seconds(),
            Err(_) => {
                X11_FAILED.store(true, Ordering::Relaxed);
                log::warn!("no idle-time source (no Mutter IdleMonitor, no XScreenSaver); idle reads as 0");
            }
        }
    }
    0
}

#[cfg(target_os = "linux")]
fn mutter_idle_ms() -> Option<u64> {
    use dbus::blocking::Connection;
    use std::time::Duration;

    let conn = Connection::new_session().ok()?;
    let proxy = conn.with_proxy(
        "org.gnome.Mutter.IdleMonitor",
        "/org/gnome/Mutter/IdleMonitor/Core",
        Duration::from_millis(500),
    );
    let (ms,): (u64,) = proxy
        .method_call("org.gnome.Mutter.IdleMonitor", "GetIdletime", ())
        .ok()?;
    Some(ms)
}

/// Distraction iff the active app's name exactly matches (case-insensitive) a
/// distraction entry; else Work iff it matches a work entry; else Neutral.
/// Exact identity — never substring. Distraction wins if an app is in both lists.
pub fn classify(app_name: &str, settings: &Settings) -> AppClass {
    let a = app_name.trim();
    if a.is_empty() {
        return AppClass::Neutral;
    }
    if settings.distraction_apps.iter().any(|d| d.trim().eq_ignore_ascii_case(a)) {
        AppClass::Distraction
    } else if settings.work_apps.iter().any(|w| w.trim().eq_ignore_ascii_case(a)) {
        AppClass::Work
    } else {
        AppClass::Neutral
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;

    #[test]
    fn exact_match_only_no_substring_false_positive() {
        let s = Settings {
            distraction_apps: vec!["X".into(), "Discord".into()],
            ..Settings::default()
        };
        assert!(matches!(classify("Discord", &s), AppClass::Distraction));
        assert!(matches!(classify("X", &s), AppClass::Distraction));
        // the old substring bug: "X" must NOT match "Xcode"
        assert!(matches!(classify("Xcode", &s), AppClass::Neutral));
        assert!(matches!(classify("", &s), AppClass::Neutral));
    }

    #[test]
    fn work_apps_classify_as_work_distraction_wins_ties() {
        let s = Settings {
            work_apps: vec!["Visual Studio Code".into(), "Google Chrome".into()],
            distraction_apps: vec!["Telegram".into(), "Google Chrome".into()],
            ..Settings::default()
        };
        assert!(matches!(classify("Visual Studio Code", &s), AppClass::Work));
        assert!(matches!(classify("Telegram", &s), AppClass::Distraction));
        // app in BOTH lists → distraction wins (matches classify precedence)
        assert!(matches!(classify("Google Chrome", &s), AppClass::Distraction));
        // unknown → neutral
        assert!(matches!(classify("Finder", &s), AppClass::Neutral));
    }
}
