//! Tauri command handlers. Everything stateful goes through the engine mutex so
//! commands and the 1 s tick never interleave.

use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_updater::UpdaterExt;

use crate::db;
use crate::dto::*;
use crate::engine::Engine;
use crate::settings::Settings;

pub struct AppState {
    pub engine: Arc<Mutex<Engine>>,
    /// Top-right corner the companion's pending resize must keep, plus the
    /// width it was resized to (physical px).
    pub companion_pin: Mutex<Option<(i32, i32, i32)>>,
}

impl AppState {
    fn engine(&self) -> MutexGuard<'_, Engine> {
        self.engine.lock().expect("engine mutex poisoned")
    }
}

/// Run `f` on the engine, then broadcast the new state to every window.
fn mutate<T>(app: &AppHandle, state: &State<AppState>, f: impl FnOnce(&mut Engine) -> Result<T, String>) -> Result<T, String> {
    let mut e = state.engine();
    let out = f(&mut e)?;
    e.emit(app);
    Ok(out)
}

/// Reveal + focus the main window (tray, dock-reopen, single-instance, open cmd).
/// Closing destroys it to free its webview, so this rebuilds it from the config.
pub fn show_main(app: &AppHandle) {
    let w = match app.get_webview_window("main") {
        Some(w) => w,
        None => {
            let config = app.config().app.windows.iter().find(|c| c.label == "main").expect("main window in tauri.conf.json");
            match WebviewWindowBuilder::from_config(app, config).and_then(|b| b.build()) {
                Ok(w) => w,
                Err(e) => return log::error!("reopen main window: {e}"),
            }
        }
    };
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
}

#[tauri::command]
pub fn get_focus(state: State<AppState>) -> FocusTick {
    state.engine().snapshot()
}

#[tauri::command]
pub fn start_timer(app: AppHandle, state: State<AppState>, minutes: f64) -> Result<(), String> {
    mutate(&app, &state, |e| e.start_timer(minutes))
}

#[tauri::command]
pub fn stop_timer(app: AppHandle, state: State<AppState>) -> Result<f64, String> {
    mutate(&app, &state, |e| e.stop_timer())
}

#[tauri::command]
pub fn pause_timer(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    mutate(&app, &state, |e| e.pause_timer())
}

#[tauri::command]
pub fn resume_timer(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    mutate(&app, &state, |e| e.resume_timer())
}

#[tauri::command]
pub fn set_target(app: AppHandle, state: State<AppState>, secs: f64) -> Result<(), String> {
    mutate(&app, &state, |e| e.set_target(secs))
}

#[tauri::command]
pub fn set_day_target(app: AppHandle, state: State<AppState>, day: usize, secs: Option<f64>) -> Result<(), String> {
    mutate(&app, &state, |e| e.set_day_target(day, secs))
}

#[tauri::command]
pub fn set_day_rest(app: AppHandle, state: State<AppState>, day: usize, secs: f64) -> Result<(), String> {
    mutate(&app, &state, |e| e.set_day_rest(day, secs))
}

#[tauri::command]
pub fn get_insights(state: State<AppState>, range: String) -> Result<Insights, String> {
    let mut e = state.engine();
    e.flush().map_err(|e| e.to_string())?;
    db::insights(e.conn(), &range, chrono::Local::now().naive_local()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.engine().settings().clone()
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> Result<Settings, String> {
    state.engine().save_settings(settings.clone()).map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub async fn list_apps(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut apps = crate::installed::list();
    {
        let mut e = state.engine();
        e.flush().map_err(|e| e.to_string())?;
        apps.extend(db::known_apps(e.conn()).map_err(|e| e.to_string())?);
    }
    apps.sort_by_cached_key(|n| n.to_lowercase());
    apps.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    Ok(apps)
}

#[tauri::command]
pub async fn tracking_helper(app: AppHandle) -> Result<TrackingHelper, String> {
    crate::gnome::status(&app.path().data_dir().map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn install_tracking_helper(app: AppHandle) -> Result<TrackingHelper, String> {
    crate::gnome::install(&app.path().data_dir().map_err(|e| e.to_string())?)
}

/// Writes the extension's files and puts their folder on the clipboard for
/// Chrome's "Load unpacked" picker. Copied here, not in the webview: WebKit
/// refuses clipboard writes once the click's user activation has passed.
#[tauri::command]
pub async fn install_browser_extension(app: AppHandle) -> Result<String, String> {
    let dir = crate::browser::install(&app.path().app_data_dir().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let dir = dir.to_string_lossy().into_owned();
    app.clipboard().write_text(dir.clone()).map_err(|e| e.to_string())?;
    Ok(dir)
}

// ── desktop companion window ──────────────────────────────────────────────

/// Initial companion size (logical px) — a first-paint guess; the webview then
/// calls `nube_resize_companion` to fit its measured content exactly.
pub const COMPANION_FULL: (f64, f64) = (208.0, 276.0);

/// Nestle the always-on-top companion into the top-right of its monitor.
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
        let win = w.outer_size().unwrap_or_else(|_| {
            PhysicalSize::new(
                (COMPANION_FULL.0 * scale) as u32,
                (COMPANION_FULL.1 * scale) as u32,
            )
        });
        let margin = (24.0 * scale) as i32;
        let top = (30.0 * scale) as i32; // clear the macOS menu bar
        let x = mpos.x + msize.width as i32 - win.width as i32 - margin;
        let y = mpos.y + top;
        let _ = w.set_position(PhysicalPosition::new(x.max(mpos.x), y.max(mpos.y)));
    }
}

/// Async: building a window inside a sync command deadlocks on Windows.
#[tauri::command]
pub async fn nube_open_main(app: AppHandle) {
    show_main(&app);
}

/// macOS: float the companion over everything (incl. other apps' full-screen
/// Spaces) and let it drag by its background. The level + collectionBehavior here
/// are necessary but NOT sufficient — over-fullscreen only works because the app
/// runs as ActivationPolicy::Accessory (lib.rs). Don't "fix" a not-over-fullscreen
/// regression by bumping the level; check the policy first. No-op elsewhere.
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

/// Resize the companion to the webview's measured content size, pinning the
/// top-right corner so it grows down/left (drops downward, keeps a user-dragged
/// position). Sync → main thread, so the pre-resize rect is real.
#[tauri::command]
pub fn nube_resize_companion(app: AppHandle, width: f64, height: f64) {
    if let Some(w) = app.get_webview_window("companion") {
        if width < 1.0 || height < 1.0 {
            return;
        }
        let scale = w.scale_factor().unwrap_or(1.0);
        let new_w = (width * scale).round() as i32;
        // top-right corner (physical px) BEFORE the resize → our anchor.
        let anchor = match (w.outer_position(), w.outer_size()) {
            (Ok(pos), Ok(size)) => Some((pos.x + size.width as i32, pos.y)),
            _ => None,
        };
        *w.state::<AppState>().companion_pin.lock().expect("pin mutex poisoned") = anchor.map(|(right, top)| (right, top, new_w));
        let _ = w.set_size(LogicalSize::new(width, height));
        match anchor {
            Some((right, top)) => {
                let _ = w.set_position(PhysicalPosition::new(right - new_w, top));
            }
            None => position_companion(&w), // no rect yet → dock to the corner
        }
        apply_macos_overlay(&w);
    }
}

/// GTK moves a window at once but resizes it on its next layout pass, so on a
/// shrink the WM sees the old width at the new x, pushes it back on-screen, and
/// the right edge drifts left. Re-applying the pin once the new size lands fixes
/// it. The move itself also emits Resized with the old size, hence the width check.
pub fn repin_companion(w: &WebviewWindow, size: PhysicalSize<u32>) {
    let state = w.state::<AppState>();
    let mut pin = state.companion_pin.lock().expect("pin mutex poisoned");
    if let Some((right, top, width)) = *pin {
        if width == size.width as i32 {
            *pin = None;
            let _ = w.set_position(PhysicalPosition::new(right - width, top));
        }
    }
}

// ── self-update (channel-aware) ───────────────────────────────────────────

/// The updater plugin bakes a single endpoint in at build time and can't switch
/// it from JS, so the channel is resolved here per call. Beta tracks every
/// `-beta` prerelease through a fixed `beta` release that CI keeps pointed at the
/// newest manifest; stable tracks the latest non-prerelease.
fn channel_manifest(channel: &str) -> &'static str {
    match channel {
        "beta" => "https://github.com/algebananazzzzz/nubenube/releases/download/beta/latest.json",
        _ => "https://github.com/algebananazzzzz/nubenube/releases/latest/download/latest.json",
    }
}

#[derive(Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: Option<String>,
}

fn build_updater(app: &AppHandle, channel: &str) -> Result<tauri_plugin_updater::Updater, String> {
    let url = tauri::Url::parse(channel_manifest(channel)).map_err(|e| e.to_string())?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_update(app: AppHandle, channel: String) -> Result<Option<UpdateInfo>, String> {
    let update = build_updater(&app, &channel)?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
    }))
}

#[tauri::command]
pub async fn install_update(app: AppHandle, channel: String) -> Result<(), String> {
    if let Some(update) = build_updater(&app, &channel)?
        .check()
        .await
        .map_err(|e| e.to_string())?
    {
        update
            .download_and_install(|_chunk: usize, _total: Option<u64>| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}
