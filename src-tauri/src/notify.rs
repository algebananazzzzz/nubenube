//! Native notifications (gentle, never shaming).

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// "1h 05m" / "12m", matching the frontend's fmtHM.
pub fn fmt_hm(secs: f64) -> String {
    let secs = secs.max(0.0).round() as i64;
    let (h, m) = (secs / 3600, (secs % 3600) / 60);
    if h > 0 {
        format!("{h}h {m:02}m")
    } else {
        format!("{m}m")
    }
}

fn show(app: &AppHandle, title: &str, body: String) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        log::warn!("notification failed: {e}");
    }
}

pub fn timer_done(app: &AppHandle, earned: f64) {
    show(app, "Focus session done", format!("+{} rest earned. Nice work. ☁️", fmt_hm(earned)));
}

pub fn timer_broken(app: &AppHandle, app_name: &str) {
    show(app, "Focus session ended", format!("{app_name} is a Rest app, so you're resting now. Start a new session when you're back."));
}

#[cfg(test)]
mod tests {
    use super::fmt_hm;

    #[test]
    fn formats_hours_and_minutes() {
        assert_eq!(fmt_hm(0.0), "0m");
        assert_eq!(fmt_hm(59.0 * 60.0), "59m");
        assert_eq!(fmt_hm(3900.0), "1h 05m");
    }
}
