//! User settings, persisted as JSON in the app data dir. Serialized camelCase
//! to match src/types.ts. Read by the watcher/drift loop and the connector.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Sensitivity {
    #[serde(default = "def_grace")]
    pub grace_secs: i64,
    /// Minutes of one-session distraction to drop life baseline→0. Anchors the
    /// base rate `R = baseline / time_to_death_min` (drift.rs).
    #[serde(default = "def_time_to_death")]
    pub time_to_death_min: f64,
    /// heal-per-running ÷ drain-per-waiting. One running window heals at
    /// `ratio · R`; default 0.1 → 10 min of work offsets 1 min of distraction.
    #[serde(default = "def_heal_drain_ratio")]
    pub heal_drain_ratio: f64,
    #[serde(default = "def_idle")]
    pub idle_threshold_secs: i64,
    #[serde(default = "def_granularity")]
    pub window_granularity: String,
}

fn def_grace() -> i64 { 10 }
fn def_time_to_death() -> f64 { 12.0 }
fn def_heal_drain_ratio() -> f64 { 0.1 }
fn def_idle() -> i64 { 120 }
fn def_granularity() -> String { "app".to_string() }

impl Default for Sensitivity {
    fn default() -> Self {
        Sensitivity {
            grace_secs: def_grace(),
            time_to_death_min: def_time_to_death(),
            heal_drain_ratio: def_heal_drain_ratio(),
            idle_threshold_secs: def_idle(),
            window_granularity: def_granularity(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WaterRates {
    pub read: f64,
    pub write: f64,
}

impl Default for WaterRates {
    fn default() -> Self {
        WaterRates {
            read: crate::water::READ_ML_PER_TOKEN,
            write: crate::water::WRITE_ML_PER_TOKEN,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub distraction_apps: Vec<String>,
    pub sensitivity: Sensitivity,
    pub reset_time_local: String,
    pub pause_until: Option<String>,
    pub drift_moment_intensity: String,
    pub water_rates: WaterRates,
    pub log_roots: Vec<String>,
    pub notification_sound_name: Option<String>,
    pub notification_sound_path: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            // No prefilled distractions — empty list means classify() is always
            // Neutral until the user tags an app.
            distraction_apps: Vec::new(),
            sensitivity: Sensitivity {
                grace_secs: 10,
                time_to_death_min: 12.0,
                heal_drain_ratio: 0.1,
                idle_threshold_secs: 120,
                window_granularity: "app".to_string(),
            },
            reset_time_local: "05:00".to_string(),
            pause_until: None,
            drift_moment_intensity: "gentle-notification".to_string(),
            water_rates: WaterRates {
                read: crate::water::READ_ML_PER_TOKEN,
                write: crate::water::WRITE_ML_PER_TOKEN,
            },
            log_roots: crate::store_paths::log_roots()
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
            notification_sound_name: None,
            notification_sound_path: None,
        }
    }
}

fn file(dir: &Path) -> std::path::PathBuf {
    dir.join("settings.json")
}

pub fn load(dir: &Path) -> Settings {
    std::fs::read_to_string(file(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Settings-file mtime, if it exists; lets the drift tick skip a re-read when
/// unchanged (saves are atomic, so a new mtime = a fully-written file).
pub fn modified(dir: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(file(dir)).and_then(|m| m.modified()).ok()
}

pub fn save(dir: &Path, settings: &Settings) {
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = std::fs::create_dir_all(dir);
        // Write-then-rename (atomic within a dir) so the drift tick never reads a
        // half-written file and falls back to defaults.
        let path = file(dir);
        let tmp = dir.join("settings.json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
    }
}

pub fn is_paused(settings: &Settings) -> bool {
    match &settings.pause_until {
        Some(ts) if !ts.is_empty() => chrono::DateTime::parse_from_rfc3339(ts)
            .map(|t| t > chrono::Utc::now())
            .unwrap_or(false),
        _ => false,
    }
}
