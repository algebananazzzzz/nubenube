//! Native notifications (gentle, never shaming).

use tauri::AppHandle;
#[cfg(not(target_os = "macos"))]
use tauri::Emitter; // only `app.emit` (non-macOS sound path) needs it
use tauri_plugin_notification::NotificationExt;

pub fn drift(app: &AppHandle, app_name: &str, project: &str, sound_name: Option<&str>, sound_path: Option<&str>) {
    // Each arg is consumed on only one platform; quiet the other so `-D warnings` passes.
    #[cfg(not(target_os = "macos"))]
    let _ = sound_name;
    #[cfg(target_os = "macos")]
    let _ = sound_path;

    let body = if project.is_empty() {
        format!("You've wandered to {app_name}. Your Nube is fading a little — come back when you can. ☁️")
    } else {
        format!("Claude finished on {project} — you've been in {app_name} since. Your Nube is fading a little. ☁️")
    };

    // macOS: custom sounds live in ~/Library/Sounds/ and are referenced by stem.
    // Other platforms: the notification plugin's sound field doesn't support
    // user-uploaded files, so we emit an event for the companion to play instead.
    #[cfg(target_os = "macos")]
    let sound = sound_name.unwrap_or("default");
    #[cfg(not(target_os = "macos"))]
    let sound = "default";

    let _ = app
        .notification()
        .builder()
        .title("Your Nube is drifting")
        .body(body)
        .sound(sound)
        .show();

    #[cfg(not(target_os = "macos"))]
    if let Some(path) = sound_path {
        let _ = app.emit("play-notification-sound", path);
    }
}
