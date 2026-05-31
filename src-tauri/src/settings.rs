//! User settings, persisted as JSON in the app data dir. Serialized camelCase
//! to match src/types.ts. Read by the watcher/drift loop and the connector.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Sensitivity {
    #[serde(default = "def_grace")]
    pub grace_secs: i64,
    #[serde(default = "def_decay")]
    pub decay_per_min: f64,
    /// Health recovered per token Claude consumes (input+output+cache_create).
    #[serde(default = "def_recovery_per_token")]
    pub recovery_per_token: f64,
    #[serde(default = "def_idle")]
    pub idle_threshold_secs: i64,
    #[serde(default = "def_granularity")]
    pub window_granularity: String,
}

fn def_grace() -> i64 { 10 }
fn def_decay() -> f64 { 0.06 }
fn def_recovery_per_token() -> f64 { 0.000004 }
fn def_idle() -> i64 { 120 }
fn def_granularity() -> String { "app".to_string() }

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WaterRates {
    pub read: f64,
    pub write: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub distraction_apps: Vec<String>,
    pub sensitivity: Sensitivity,
    pub reset_time_local: String,
    pub pause_until: Option<String>,
    pub drift_moment_intensity: String,
    pub water_rates: WaterRates,
    pub log_roots: Vec<String>,
}

fn s(list: &[&str]) -> Vec<String> {
    list.iter().map(|x| x.to_string()).collect()
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            distraction_apps: s(&[
                "TikTok", "Netflix", "Steam", "Discord", "Twitch", "Disney+", "Hulu",
            ]),
            sensitivity: Sensitivity {
                grace_secs: 10,
                decay_per_min: 0.06,
                recovery_per_token: 0.000004,
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

pub fn save(dir: &Path, settings: &Settings) {
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::write(file(dir), json);
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
