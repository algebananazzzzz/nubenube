//! GNOME on Wayland hides the focused window from other apps, so a bundled
//! Shell extension reports it. GNOME only loads new extensions at login.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::dto::TrackingHelper as Helper;

const UUID: &str = "nubenube-tracker@nubenube.app";
const METADATA: &str = include_str!("../gnome-extension/metadata.json");
const EXTENSION: &str = include_str!("../gnome-extension/extension.js");

#[cfg(target_os = "linux")]
fn call<R: dbus::arg::ReadAll>(dest: &str, path: &str, iface: &str, method: &str) -> Option<R> {
    use dbus::blocking::Connection;
    thread_local! {
        static SESSION: Option<Connection> = Connection::new_session().ok();
    }
    SESSION.with(|c| {
        c.as_ref()?
            .with_proxy(dest, path, std::time::Duration::from_millis(200))
            .method_call(iface, method, ())
            .ok()
    })
}

#[cfg(target_os = "linux")]
pub fn focused() -> Option<(String, u32)> {
    call("org.gnome.Shell", "/app/nubenube/Tracker", "app.nubenube.Tracker", "Focused")
}

#[cfg(not(target_os = "linux"))]
pub fn focused() -> Option<(String, u32)> {
    None
}

#[cfg(target_os = "linux")]
pub fn idle_ms() -> Option<u64> {
    call::<(u64,)>("org.gnome.Mutter.IdleMonitor", "/org/gnome/Mutter/IdleMonitor/Core", "org.gnome.Mutter.IdleMonitor", "GetIdletime")
        .map(|(ms,)| ms)
}

pub fn needed() -> bool {
    static NEEDED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *NEEDED.get_or_init(|| {
        cfg!(target_os = "linux")
            && is_gnome_wayland(
                &std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default(),
                std::env::var_os("WAYLAND_DISPLAY").is_some(),
            )
    })
}

fn ext_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("gnome-shell/extensions").join(UUID)
}

fn is_gnome_wayland(desktop: &str, wayland: bool) -> bool {
    wayland && desktop.split(':').any(|d| d.eq_ignore_ascii_case("gnome"))
}

fn gsettings(args: &[&str]) -> Result<String, String> {
    let out = Command::new("gsettings").args(args).output().map_err(|e| format!("gsettings: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn gsettings_get(key: &str) -> Result<String, String> {
    gsettings(&["get", "org.gnome.shell", key])
}

fn listed(key: &str) -> Result<bool, String> {
    Ok(parse_list(&gsettings_get(key)?).iter().any(|x| x == UUID))
}

fn set_listed(key: &str, want: bool) -> Result<(), String> {
    let mut list = parse_list(&gsettings_get(key)?);
    if list.iter().any(|x| x == UUID) == want {
        return Ok(());
    }
    if want {
        list.push(UUID.into());
    } else {
        list.retain(|x| x != UUID);
    }
    gsettings(&["set", "org.gnome.shell", key, &print_list(&list)]).map(|_| ())
}

/// Extension UUIDs never contain quotes or commas.
fn parse_list(printed: &str) -> Vec<String> {
    printed
        .trim_start_matches("@as ")
        .trim_matches(|c| c == '[' || c == ']')
        .split(',')
        .map(|x| x.trim().trim_matches('\'').to_string())
        .filter(|x| !x.is_empty())
        .collect()
}

fn print_list(items: &[String]) -> String {
    format!("[{}]", items.iter().map(|x| format!("'{x}'")).collect::<Vec<_>>().join(", "))
}

pub fn status(data_dir: &Path) -> Result<Helper, String> {
    if !needed() || focused().is_some() {
        return Ok(Helper::Ok);
    }
    let dir = ext_dir(data_dir);
    let current = std::fs::read_to_string(dir.join("extension.js")).ok().as_deref() == Some(EXTENSION)
        && std::fs::read_to_string(dir.join("metadata.json")).ok().as_deref() == Some(METADATA);
    Ok(if current && listed("enabled-extensions")? { Helper::Pending } else { Helper::Missing })
}

pub fn install(data_dir: &Path) -> Result<Helper, String> {
    // The Extensions app's master switch; enabling ours would silently do nothing.
    if gsettings_get("disable-user-extensions")? == "true" {
        return Err("Extensions are turned off. Turn them on in GNOME's Extensions app, then try again.".into());
    }
    let dir = ext_dir(data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("metadata.json"), METADATA).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("extension.js"), EXTENSION).map_err(|e| e.to_string())?;
    // Written directly: `gnome-extensions enable` asks the running shell, which
    // rejects an extension it hasn't loaded ("does not exist") until next login.
    set_listed("enabled-extensions", true)?;
    set_listed("disabled-extensions", false)?;
    Ok(Helper::Pending)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_metadata_carries_the_uuid_we_enable() {
        let meta: serde_json::Value = serde_json::from_str(METADATA).unwrap();
        assert_eq!(meta["uuid"], UUID);
    }

    #[test]
    fn detects_gnome_wayland_from_desktop_list() {
        assert!(is_gnome_wayland("ubuntu:GNOME", true));
        assert!(is_gnome_wayland("GNOME", true));
        assert!(!is_gnome_wayland("ubuntu:GNOME", false));
        assert!(!is_gnome_wayland("KDE", true));
    }

    #[test]
    fn extension_lists_round_trip_through_gsettings_syntax() {
        assert!(parse_list("@as []").is_empty());
        let v = parse_list("['ding@rastersoft.com', 'ubuntu-dock@ubuntu.com']");
        assert_eq!(v, ["ding@rastersoft.com", "ubuntu-dock@ubuntu.com"]);
        assert_eq!(print_list(&v), "['ding@rastersoft.com', 'ubuntu-dock@ubuntu.com']");
        assert_eq!(print_list(&[]), "[]");
    }
}
