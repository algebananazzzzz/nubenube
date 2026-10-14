//! Output structs returned to the frontend. `rename_all = "camelCase"` makes
//! them match src/types.ts.

use serde::Serialize;

use crate::economy::Day;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FocusTick {
    /// "idle" | "timer" | "drift"
    pub state: String,
    pub app: String,
    /// "work" | "neutral" | "rest"
    pub app_class: String,
    /// Away (idle past the threshold): nothing is earned or spent.
    pub away: bool,
    /// Timer seconds left and length; 0 with no timer running.
    pub left: f64,
    pub len: f64,
    pub run: f64,
    pub pending: f64,
    pub paused: bool,
    /// Pause budget left for the running timer.
    pub pause_left: f64,
    /// 0 = Monday.
    pub weekday: usize,
    pub week: Vec<Day>,
    pub bank: f64,
    /// The browser extension is connected, so sites are tracked and blocked.
    pub extension: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SeriesPoint {
    pub label: String,
    pub focus: f64,
    pub distract: f64,
    /// False when the app wasn't tracking in this bucket (a gap, not a real 0).
    pub present: bool,
    pub future: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSlice {
    pub name: String,
    pub secs: f64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub range: String,
    pub series: Vec<SeriesPoint>,
    pub earned: f64,
    pub spent: f64,
    pub targets_hit: i64,
    pub target_days: i64,
    pub focus_apps: Vec<AppSlice>,
    pub rest_apps: Vec<AppSlice>,
}

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum TrackingHelper {
    Ok,
    Missing,
    /// Installed and enabled; GNOME loads it at the next login.
    Pending,
}
