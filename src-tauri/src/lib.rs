// objc 0.2's sel_impl macro uses #[cfg(cargo-clippy)] which newer rustc flags
// as unexpected; suppress until a newer objc release fixes the macro.
#![allow(unexpected_cfgs)]
// Nube Nube — native (Rust) entry point.

mod browser;
mod commands;
mod db;
mod dto;
mod economy;
mod engine;
mod gnome;
mod installed;
mod notify;
mod settings;
mod watcher;

use std::sync::{Arc, Mutex};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use commands::AppState;
use engine::Engine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // GTK3's Wayland backend has no protocol for keep-above, sticky, or client
    // positioning, so the companion would open wherever the compositor drops it
    // (usually under the main window) and stay on one workspace. XWayland honors
    // _NET_WM_STATE_ABOVE/STICKY and set_position. Must run before GTK init; an
    // explicit GDK_BACKEND from the user still wins.
    #[cfg(target_os = "linux")]
    if std::env::var_os("GDK_BACKEND").is_none() && std::env::var_os("WAYLAND_DISPLAY").is_some() {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    tauri::Builder::default()
        // Single-instance MUST be first: focus the running window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            commands::show_main(app);
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        // Close hides the main window; the app lives on in the tray.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // macOS: Accessory policy (no Dock icon) is the ONLY way a window can
            // float over another app's native-fullscreen Space; the NSWindow
            // tweaks in apply_macos_overlay are necessary but not sufficient alone.
            // Main window stays reachable via the tray.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            browser::refresh(&dir)?;
            let browser = browser::Shared::default();
            browser::listen(browser.clone(), app.config().identifier.ends_with(".dev"));
            // A fresh file: the pre-redesign nube.db (Claude usage) is left untouched.
            let engine = Arc::new(Mutex::new(Engine::new(dir.join("focus.db"), dir, browser)?));
            app.manage(AppState { engine: engine.clone() });
            engine::start(app.handle().clone(), engine);

            // System tray (live presence + quick menu).
            let open = MenuItem::with_id(app, "open", "Open Nube Nube", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Nube Nube")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => commands::show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            let _tray = builder.build(app)?;

            // Always-on-top companion — the live indicator (floats across Spaces).
            if let Ok(w) = WebviewWindowBuilder::new(app.handle(), "companion", WebviewUrl::App("index.html#/companion".into()))
                .title("Nube")
                .inner_size(commands::COMPANION_FULL.0, commands::COMPANION_FULL.1)
                .resizable(false)
                .decorations(false)
                .transparent(true)
                .shadow(false) // kill the macOS window shadow (the gray halo box)
                .always_on_top(true)
                .visible_on_all_workspaces(true)
                .skip_taskbar(true)
                .visible(true)
                .build()
            {
                commands::position_companion(&w);
                commands::apply_macos_overlay(&w);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_focus,
            commands::start_timer,
            commands::stop_timer,
            commands::set_target,
            commands::set_day_target,
            commands::set_day_rest,
            commands::get_insights,
            commands::get_settings,
            commands::save_settings,
            commands::list_apps,
            commands::tracking_helper,
            commands::install_tracking_helper,
            commands::install_browser_extension,
            commands::nube_open_main,
            commands::nube_set_companion,
            commands::nube_resize_companion,
            commands::check_update,
            commands::install_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Nube Nube")
        .run(|app, event| {
            // macOS: clicking the Dock icon after close-to-tray re-shows the window.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                commands::show_main(app);
            }
            let _ = (app, &event);
        });
}
