//! Active-window + idle snapshot.
//!
//! macOS: app name needs NO permission (window title needs Screen Recording, so
//! it may be empty); idle via CGEventSource needs NO permission.
//! Linux: X11 full; GNOME Wayland through the bundled Shell extension
//! (`gnome.rs`), other Wayland compositors best-effort; idle via Mutter on GNOME.

pub struct Snapshot {
    pub app_name: String,
    pub idle_secs: u64,
}

pub fn snapshot() -> Snapshot {
    Snapshot { app_name: foreground_app(), idle_secs: idle_secs() }
}

/// NubeNube's own windows read as no app. Matched by pid: the name differs per platform.
fn foreground_app() -> String {
    match focused_window() {
        Some((name, pid)) if pid != u64::from(std::process::id()) => name,
        _ => String::new(),
    }
}

fn focused_window() -> Option<(String, u64)> {
    if let Some((name, pid)) = crate::gnome::needed().then(crate::gnome::focused).flatten() {
        return Some((name, pid.into()));
    }
    active_win_pos_rs::get_active_window().ok().map(|w| (w.app_name, w.process_id))
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

    if let Some(ms) = crate::gnome::idle_ms() {
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
