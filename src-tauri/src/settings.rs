//! User settings, persisted as JSON in the app data dir. Serialized camelCase
//! to match src/types.ts.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::economy::Rules;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Site {
    pub domain: String,
    pub class: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Shield {
    pub enabled: bool,
    pub subdomains: bool,
    pub doh_guard: bool,
}

impl Default for Shield {
    fn default() -> Self {
        Shield { enabled: true, subdomains: true, doh_guard: true }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// App name → "work" | "neutral" | "rest". Absent apps are neutral.
    pub apps: BTreeMap<String, String>,
    pub sites: Vec<Site>,
    pub shield: Shield,
    /// Minutes of focus that earn one minute of rest.
    pub ratio: f64,
    /// Rest-spend multiplier while on a Rest app during a timer.
    pub penalty: f64,
    pub target_bonus_min: f64,
    /// Quick-start timer lengths in minutes.
    pub presets: Vec<u32>,
    /// Minutes of unbroken focus per finish-bonus step.
    pub finish_every: f64,
    /// Pre-redesign app lists; folded into `apps` on load and never written back.
    #[serde(skip_serializing)]
    distraction_apps: Vec<String>,
    #[serde(skip_serializing)]
    work_apps: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            apps: BTreeMap::new(),
            sites: ["youtube.com", "reddit.com", "x.com", "instagram.com", "tiktok.com"]
                .into_iter()
                .map(|d| Site { domain: d.into(), class: "rest".into() })
                .collect(),
            shield: Shield::default(),
            ratio: 5.0,
            penalty: 3.0,
            target_bonus_min: 30.0,
            presets: vec![25, 45, 60, 90],
            finish_every: 15.0,
            distraction_apps: Vec::new(),
            work_apps: Vec::new(),
        }
    }
}

impl Settings {
    pub fn rules(&self) -> Rules {
        Rules {
            ratio: self.ratio.max(1.0),
            penalty: self.penalty.max(1.0),
            target_bonus_secs: self.target_bonus_min.max(0.0) * 60.0,
            finish_every_min: self.finish_every.max(1.0),
        }
    }

    /// The class of `app_name` by exact, case-insensitive name. Never substring:
    /// "X" must not match "Xcode".
    pub fn class_of(&self, app_name: &str) -> &str {
        let a = app_name.trim();
        self.apps
            .iter()
            .find(|(name, _)| name.trim().eq_ignore_ascii_case(a))
            .map_or("neutral", |(_, class)| class.as_str())
    }

    fn fold_legacy(&mut self) {
        for app in self.work_apps.drain(..) {
            self.apps.entry(app).or_insert_with(|| "work".into());
        }
        // Rest wins when an app was in both old lists, as it did before.
        for app in self.distraction_apps.drain(..) {
            self.apps.insert(app, "rest".into());
        }
    }
}

fn file(dir: &Path) -> std::path::PathBuf {
    dir.join("settings.json")
}

pub fn load(dir: &Path) -> Settings {
    let mut s: Settings = std::fs::read_to_string(file(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    s.fold_legacy();
    s
}

/// Settings-file mtime, if it exists; lets the tick skip a re-read when
/// unchanged (saves are atomic, so a new mtime = a fully-written file).
pub fn modified(dir: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(file(dir)).and_then(|m| m.modified()).ok()
}

pub fn save(dir: &Path, settings: &Settings) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(settings)?;
    std::fs::create_dir_all(dir)?;
    // Write-then-rename (atomic within a dir) so the tick never reads a
    // half-written file and falls back to defaults.
    let tmp = dir.join("settings.json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, file(dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn class_is_exact_and_case_insensitive() {
        let mut s = Settings::default();
        s.apps.insert("X".into(), "rest".into());
        s.apps.insert("Visual Studio Code".into(), "work".into());
        assert_eq!(s.class_of("x"), "rest");
        assert_eq!(s.class_of("visual studio code"), "work");
        assert_eq!(s.class_of("Xcode"), "neutral");
        assert_eq!(s.class_of(""), "neutral");
    }

    #[test]
    fn legacy_lists_fold_into_apps_with_rest_winning() {
        let old = r#"{"distractionApps":["Telegram","Chrome"],"workApps":["Code","Chrome"],"sensitivity":{}}"#;
        let mut s: Settings = serde_json::from_str(old).unwrap();
        s.fold_legacy();
        assert_eq!(s.class_of("Telegram"), "rest");
        assert_eq!(s.class_of("Code"), "work");
        assert_eq!(s.class_of("Chrome"), "rest");
        assert_eq!(s.ratio, 5.0);
        assert!(!serde_json::to_string(&s).unwrap().contains("distractionApps"));
    }
}
