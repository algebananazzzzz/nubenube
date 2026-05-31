//! Native notifications (gentle, never shaming).

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub fn drift(app: &AppHandle, app_name: &str, project: &str) {
    let body = if project.is_empty() {
        format!("You've wandered to {app_name}. Your Nube is fading a little — come back when you can. ☁️")
    } else {
        format!("Claude finished on {project} — you've been in {app_name} since. Your Nube is fading a little. ☁️")
    };
    let _ = app
        .notification()
        .builder()
        .title("Your Nube is drifting")
        .body(body)
        .show();
}

#[allow(dead_code)]
pub fn simple(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}
