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

pub fn drifted(app: &AppHandle, app_name: &str, penalty: f64) {
    show(
        app,
        "You drifted mid-session",
        format!("{app_name} is burning rest {penalty}× faster while your timer runs. Come back when you can."),
    );
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
