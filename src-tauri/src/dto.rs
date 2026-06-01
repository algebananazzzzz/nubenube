//! Output structs returned to the frontend. `rename_all = "camelCase"` makes
//! them match src/types.ts (cacheCreate, waterMl, projectCount, ...).

use serde::Serialize;

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TokenBreakdown {
    pub input: i64,
    pub output: i64,
    pub cache_create: i64,
    pub cache_read: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub color_hue: i64,
    pub tokens: TokenBreakdown, // lifetime, deduped
    pub water_ml: f64,          // lifetime, derived from tokens
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub water_ml: f64,
    pub tokens: TokenBreakdown,
    pub project_count: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DistractionSlice {
    pub name: String,
    pub secs: i64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub range: String,
    pub tokens: TokenBreakdown, // token composition for the range
    pub claude_active_secs: i64, // Claude working
    pub claude_idle_secs: i64,   // Claude idle, waiting on you
    pub drift_secs: i64,         // time on distractions
    pub distraction_breakdown: Vec<DistractionSlice>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub connected: bool,
    pub projects_detected: i64,
    pub sessions_scanned: i64,
    pub hooks_installed: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub color_hue: i64,
    pub range: String,
    pub tokens: TokenBreakdown,
    pub water_ml: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnownApp {
    pub name: String,
    pub last_seen: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FocusTickDto {
    pub ts: String,
    pub state: String,
    pub app_name: String,
    /// `life` on the 0..cap (130) scale (field kept named `cloudHealth`).
    pub cloud_health: f64,
    /// Full / "par" life and the daily reset level (100).
    pub baseline: f64,
    /// Hard ceiling on life = baseline + banked bonus (130).
    pub cap: f64,
    pub waiting_sessions: i64,
    pub running_sessions: i64,
    pub seconds_to_death: Option<i64>,
    /// Today's (reset-day) activity secs: active = states 1-4; distract = 3-4
    /// (active − distract = focused); work = Σ running·dt; monitored = tracked time.
    pub active_secs_today: i64,
    pub distract_secs_today: i64,
    pub work_secs_today: i64,
    pub monitored_secs_today: i64,
    /// Meter frozen (paused or away/idle) — UI stops its local live timers.
    pub frozen: bool,
    /// Active project's hue (drives the accent + creature tint), 0..360.
    pub color_hue: i64,
}
