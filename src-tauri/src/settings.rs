//! User settings, persisted as JSON in the app data dir. Serialized camelCase
//! to match src/types.ts. Read by the watcher/drift loop and the connector.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Per-weekday override of the two rate knobs; `weekday` is 0=Mon … 6=Sun. Days
/// absent from the list fall back to the base `Sensitivity` values.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DayOverride {
    pub weekday: u8,
    pub time_to_death_min: f64,
    pub heal_drain_ratio: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Sensitivity {
    #[serde(default = "def_grace")]
    pub grace_secs: i64,
    /// Daily distraction allowance in minutes — the budget that 1× distraction
    /// spends down. Anchors the base rate `R = baseline / time_to_death_min`.
    #[serde(default = "def_time_to_death")]
    pub time_to_death_min: f64,
    /// heal-per-running ÷ drain-per-waiting. One running window heals at
    /// `ratio · R`; default 0.1 → 10 min of work offsets 1 min of distraction.
    #[serde(default = "def_heal_drain_ratio")]
    pub heal_drain_ratio: f64,
    /// Drain multiplier while a turn is waiting on you: distraction + a waiting
    /// turn burns budget `waiting_multiplier`× faster. Global (not per-weekday).
    #[serde(default = "def_waiting_multiplier")]
    pub waiting_multiplier: f64,
    #[serde(default = "def_idle")]
    pub idle_threshold_secs: i64,
    /// Per-weekday overrides of the two knobs above (empty = same rates all week).
    #[serde(default)]
    pub day_overrides: Vec<DayOverride>,
}

fn def_grace() -> i64 { 10 }
fn def_time_to_death() -> f64 { 30.0 }
fn def_heal_drain_ratio() -> f64 { 0.1 }
fn def_waiting_multiplier() -> f64 { 3.0 }
fn def_idle() -> i64 { 120 }

impl Default for Sensitivity {
    fn default() -> Self {
        Sensitivity {
            grace_secs: def_grace(),
            time_to_death_min: def_time_to_death(),
            heal_drain_ratio: def_heal_drain_ratio(),
            waiting_multiplier: def_waiting_multiplier(),
            idle_threshold_secs: def_idle(),
            day_overrides: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub distraction_apps: Vec<String>,
    pub sensitivity: Sensitivity,
    pub drift_moment_intensity: String,
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
            sensitivity: Sensitivity::default(),
            drift_moment_intensity: "gentle-notification".to_string(),
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

/// Resolved (time_to_death_min, heal_drain_ratio) for a weekday (0=Mon … 6=Sun):
/// the matching day override if present, else the base values. Pure.
pub fn effective_rates(s: &Sensitivity, weekday: u8) -> (f64, f64) {
    s.day_overrides
        .iter()
        .find(|o| o.weekday == weekday)
        .map(|o| (o.time_to_death_min, o.heal_drain_ratio))
        .unwrap_or((s.time_to_death_min, s.heal_drain_ratio))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_30min_budget_and_3x() {
        let s = Sensitivity::default();
        assert_eq!(s.time_to_death_min, 30.0); // daily distraction budget (min)
        assert_eq!(s.waiting_multiplier, 3.0); // X× while a turn waits
    }

    #[test]
    fn effective_rates_prefers_override_then_base() {
        let mut s = Sensitivity::default();
        s.day_overrides = vec![DayOverride { weekday: 5, time_to_death_min: 60.0, heal_drain_ratio: 0.25 }];
        assert_eq!(effective_rates(&s, 5), (60.0, 0.25)); // Saturday → override
        assert_eq!(effective_rates(&s, 0), (s.time_to_death_min, s.heal_drain_ratio)); // Monday → base
    }
}
