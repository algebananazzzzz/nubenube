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
/// user-curated entry. Exact identity — never substring — so "X" can't match
/// "Xcode". Everything else is Neutral (research/editor/etc. never decays).
pub fn classify(app_name: &str, settings: &Settings) -> AppClass {
    let a = app_name.trim();
    if !a.is_empty() && settings.distraction_apps.iter().any(|d| d.trim().eq_ignore_ascii_case(a)) {
        AppClass::Distraction
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
}
