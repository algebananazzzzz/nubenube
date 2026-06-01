//! Tauri command handlers. Each opens a short-lived SQLite connection (WAL
//! handles concurrent reads/writes with the connector + watcher threads).

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};

use crate::settings::Settings;
use crate::{connector, db, dto::*, hooks_installer, store_paths};

pub struct AppState {
    pub db_path: PathBuf,
    pub config_dir: PathBuf,
}

fn roots_str() -> Vec<String> {
    store_paths::log_roots()
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

fn conn_status(db_path: &Path) -> ConnectionStatus {
    let roots = roots_str();
    let installed = hooks_installer::is_installed();
    match db::open(db_path) {
        Ok(c) => db::connection_stats(&c, roots, installed),
        Err(_) => ConnectionStatus {
            connected: false,
            log_roots: roots,
            projects_detected: 0,
            sessions_scanned: 0,
            hooks_installed: installed,
            last_scan_utc: None,
            naive_dedup_ratio: None,
            permissions: Permissions { screen_recording: false, automation: false },
        },
    }
}

#[tauri::command]
pub fn get_projects(state: State<AppState>) -> Vec<Project> {
    db::open(&state.db_path).map(|c| db::get_projects(&c)).unwrap_or_default()
}

#[tauri::command]
pub fn get_totals(state: State<AppState>) -> Totals {
    db::open(&state.db_path).map(|c| db::get_totals(&c)).unwrap_or_default()
}

#[tauri::command]
pub fn get_insights(state: State<AppState>, range: String) -> Insights {
    match db::open(&state.db_path) {
        Ok(c) => db::get_insights(&c, &range),
        Err(_) => Insights { range, ..Default::default() },
    }
}

#[tauri::command]
pub fn get_connection_status(state: State<AppState>) -> ConnectionStatus {
    conn_status(&state.db_path)
}

#[tauri::command]
pub fn get_project_detail(state: State<AppState>, id: String) -> Option<ProjectDetail> {
    db::open(&state.db_path).ok().and_then(|c| db::get_project_detail(&c, &id))
}

#[tauri::command]
pub fn rescan_logs(state: State<AppState>) -> ConnectionStatus {
    connector::scan_all(&state.db_path);
    conn_status(&state.db_path)
}

#[tauri::command]
pub fn export_data(state: State<AppState>) -> String {
    let projects = db::open(&state.db_path)
        .map(|c| db::get_projects(&c))
        .unwrap_or_default();
    serde_json::to_string_pretty(&projects).unwrap_or_else(|_| "[]".to_string())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    crate::settings::load(&state.config_dir)
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> Settings {
    crate::settings::save(&state.config_dir, &settings);
    settings
}

#[tauri::command]
pub fn install_hooks(state: State<AppState>) -> ConnectionStatus {
    let _ = hooks_installer::install();
    conn_status(&state.db_path)
}

#[tauri::command]
pub fn uninstall_hooks(state: State<AppState>) -> ConnectionStatus {
    let _ = hooks_installer::uninstall();
    conn_status(&state.db_path)
}

#[tauri::command]
pub fn request_permission(kind: String, state: State<AppState>) -> ConnectionStatus {
    // App-level focus tracking needs no permission. Window-title / browser-URL
    // permissions (Screen Recording / Automation) are a later opt-in upgrade.
    let _ = kind;
    conn_status(&state.db_path)
}

#[tauri::command]
pub fn reset_today(state: State<AppState>) {
    if let Ok(c) = db::open(&state.db_path) {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db::reset_all_health(&c, 0.7, &today);
    }
}

// ── desktop companion window ──────────────────────────────────────────────

/// Nestle the always-on-top companion into the bottom-right of its monitor.
pub fn position_companion(w: &WebviewWindow) {
    let mon = w
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| w.primary_monitor().ok().flatten());
    if let Some(mon) = mon {
        let scale = mon.scale_factor();
        let msize = mon.size();
        let mpos = mon.position();
        let win = w
            .outer_size()
            .unwrap_or_else(|_| PhysicalSize::new((196.0 * scale) as u32, (214.0 * scale) as u32));
        let margin = (24.0 * scale) as i32;
        let dock = (40.0 * scale) as i32; // clear the macOS dock / taskbar
        let x = mpos.x + msize.width as i32 - win.width as i32 - margin;
        let y = mpos.y + msize.height as i32 - win.height as i32 - margin - dock;
        let _ = w.set_position(PhysicalPosition::new(x.max(mpos.x), y.max(mpos.y)));
    }
}

#[tauri::command]
pub fn nube_open_main(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// macOS: make the companion float over EVERYTHING — full-screen apps and all
/// Spaces — and be draggable by its whole background. Tauri's always_on_top /
/// visible_on_all_workspaces don't cover full-screen; this sets the native
/// NSWindow level + collection behavior directly. No-op on other platforms.
#[cfg(target_os = "macos")]
pub fn apply_macos_overlay(w: &WebviewWindow) {
    use objc::runtime::{Object, YES};
    use objc::{msg_send, sel, sel_impl};
    if let Ok(ptr) = w.ns_window() {
        let ns = ptr as *mut Object;
        unsafe {
            // NSStatusWindowLevel (25): above normal + floating app windows.
            let _: () = msg_send![ns, setLevel: 25_isize];
            // canJoinAllSpaces(1<<0) | stationary(1<<4) | fullScreenAuxiliary(1<<8) = 273
            // fullScreenAuxiliary is the bit that lets it show over full-screen apps.
            let _: () = msg_send![ns, setCollectionBehavior: 273_usize];
            // drag the window by clicking anywhere on its background.
            let _: () = msg_send![ns, setMovableByWindowBackground: YES];
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn apply_macos_overlay(_w: &WebviewWindow) {}

#[tauri::command]
pub fn nube_set_companion(app: AppHandle, visible: bool) {
    if let Some(w) = app.get_webview_window("companion") {
        if visible {
            let _ = w.set_always_on_top(true);
            let _ = w.set_visible_on_all_workspaces(true);
            let _ = w.show();
            apply_macos_overlay(&w); // macOS: over-fullscreen + all-Spaces + bg-drag
        } else {
            let _ = w.hide();
        }
    }
}

/// Toggle indefinite drift-tracking pause. true -> far-future pauseUntil
/// (matches the frontend PAUSE_SENTINEL); false -> clear it. The drift loop
/// reads pauseUntil each tick, so this takes effect within ~2s for every window.
#[tauri::command]
pub fn nube_set_paused(state: State<AppState>, paused: bool) {
    let mut s = crate::settings::load(&state.config_dir);
    s.pause_until = if paused {
        Some("9999-12-31T23:59:59Z".to_string())
    } else {
        None
    };
    crate::settings::save(&state.config_dir, &s);
}

#[tauri::command]
pub fn get_known_apps(state: State<AppState>) -> Vec<KnownApp> {
    db::open(&state.db_path).map(|c| db::get_known_apps(&c)).unwrap_or_default()
}

/// Best-effort list of currently-running GUI apps (to pre-populate the picker).
/// Auto-discovery (known_apps) is the primary source; this is a bonus.
#[tauri::command]
pub fn list_running_apps() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("osascript")
            .args(["-e", "tell application \"System Events\" to get name of (every process whose background only is false)"])
            .output();
        if let Ok(o) = out {
            let s = String::from_utf8_lossy(&o.stdout);
            let mut v: Vec<String> = s.split(", ").map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect();
            v.sort();
            v.dedup();
            return v;
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(o) = std::process::Command::new("wmctrl").arg("-lx").output() {
            let s = String::from_utf8_lossy(&o.stdout);
            let mut v: Vec<String> = s
                .lines()
                .filter_map(|l| l.split_whitespace().nth(2)) // WM_CLASS col
                .filter_map(|c| c.split('.').last())
                .map(|x| x.to_string())
                .collect();
            v.sort();
            v.dedup();
            return v;
        }
    }
    Vec::new()
}
