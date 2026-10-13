//! Active-window + idle snapshot.
//!
//! macOS: app name needs NO permission (window title needs Screen Recording, so
//! it may be empty); idle via CGEventSource needs NO permission.
//! Linux: X11 full; Wayland best-effort (app name may be empty), idle via
//! Mutter on GNOME.

pub struct Snapshot {
    pub app_name: String,
    pub idle_secs: u64,
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
