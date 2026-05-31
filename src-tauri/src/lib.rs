// Nube Nube — native (Rust) entry point.
//
//   M0: plugins + single-instance.
//   M1: usage connector (SQLite + incremental log tailing) + commands.
//   M2: active-window + idle watcher + drift state machine.
//   M3: Claude Code hook installer + events.jsonl tail + drift notifications.
//   M5: system tray.

mod commands;
mod connector;
mod db;
mod drift;
mod dto;
mod events_tail;
mod hooks_installer;
mod model;
mod notify;
mod settings;
mod store_paths;
mod watcher;
mod water;

use std::sync::{Arc, Mutex};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use commands::AppState;
use drift::DriftRuntime;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance MUST be first: focus the running window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        // Closing the main window hides it (the app keeps living in the tray, so
        // the rescue supervisor + companion stay alive). Quit from the tray.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let dir = app.path().app_data_dir().expect("resolve app data dir");
            let _ = std::fs::create_dir_all(&dir);
            let db_path = dir.join("nube.db");
            let config_dir = dir.clone();

            app.manage(AppState {
                db_path: db_path.clone(),
                config_dir: config_dir.clone(),
            });

            // Connector: initial scan + fs watcher.
            connector::start(app.handle().clone(), db_path.clone());

            // Self-heal Claude Code hooks if the user previously installed them
            // (fixes the empty-array regression that silenced events).
            let _ = hooks_installer::ensure_installed();

            // Drift: watcher loop + Claude-Code event tail.
            let runtime = Arc::new(Mutex::new(DriftRuntime::new(db_path, config_dir)));
            drift::start_watcher(app.handle().clone(), runtime.clone());
            events_tail::start(app.handle().clone(), runtime);

            // System tray (live presence + quick menu).
            let open = MenuItem::with_id(app, "open", "Open Nube Nube", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Nube Nube")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            let _tray = builder.build(app)?;

            // Always-on-top desktop companion pet (transparent, borderless).
            let _ = WebviewWindowBuilder::new(app.handle(), "companion", WebviewUrl::App("index.html#/companion".into()))
                .title("Nube")
                .inner_size(176.0, 160.0)
                .resizable(false)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible(false)
                .build();

            // Full-screen rescue takeover (shown system-wide when drift escalates).
            let _ = WebviewWindowBuilder::new(app.handle(), "takeover", WebviewUrl::App("index.html#/takeover".into()))
                .title("Nube — rescue")
                .inner_size(900.0, 640.0)
                .resizable(false)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible(false)
                .build();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_projects,
            commands::get_totals,
            commands::get_insights,
            commands::get_connection_status,
            commands::get_project_detail,
            commands::rescan_logs,
            commands::export_data,
            commands::get_settings,
            commands::save_settings,
            commands::install_hooks,
            commands::uninstall_hooks,
            commands::request_permission,
            commands::reset_today,
            commands::nube_open_main,
            commands::nube_set_companion,
            commands::nube_show_takeover,
            commands::nube_hide_takeover,
            commands::nube_set_paused,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Nube Nube")
        .run(|app, event| {
            // macOS: clicking the Dock icon after close-to-tray re-shows the window.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            let _ = (app, &event);
        });
}
