//! Active-window + idle snapshot and work/distraction classification.
//!
//! macOS: app name needs NO permission (window title needs Screen Recording, so
//! it may be empty); idle via CGEventSource needs NO permission.
//! Linux: X11 full; Wayland best-effort (app name may be empty).

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
    let idle_secs = user_idle::UserIdle::get_time()
        .map(|u| u.as_seconds())
        .unwrap_or(0);
    Snapshot { app_name, idle_secs }
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
        let mut s = Settings::default();
        s.distraction_apps = vec!["X".into(), "Discord".into()];
        assert!(matches!(classify("Discord", &s), AppClass::Distraction));
        assert!(matches!(classify("X", &s), AppClass::Distraction));
        // the old substring bug: "X" must NOT match "Xcode"
        assert!(matches!(classify("Xcode", &s), AppClass::Neutral));
        assert!(matches!(classify("", &s), AppClass::Neutral));
    }

    #[test]
    fn work_apps_classify_as_work_distraction_wins_ties() {
        let mut s = Settings::default();
        s.work_apps = vec!["Visual Studio Code".into(), "Google Chrome".into()];
        s.distraction_apps = vec!["Telegram".into(), "Google Chrome".into()];
        assert!(matches!(classify("Visual Studio Code", &s), AppClass::Work));
        assert!(matches!(classify("Telegram", &s), AppClass::Distraction));
        // app in BOTH lists → distraction wins (matches classify precedence)
        assert!(matches!(classify("Google Chrome", &s), AppClass::Distraction));
        // unknown → neutral
        assert!(matches!(classify("Finder", &s), AppClass::Neutral));
    }
}
