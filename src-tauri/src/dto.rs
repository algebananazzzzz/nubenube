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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionPoint {
    pub label: String,  // bucket label: "HH:MM" (today, 15-min) or "MM-DD" (daily)
    pub avg: f64,       // time-weighted avg concurrent while engaged
    pub distract_secs: i64, // wall-clock distraction secs in the bucket
    pub work_secs: i64,     // wall-clock work-app secs in the bucket (graph base layer)
    pub present: bool,  // false = app wasn't running this bucket (no data, not a real 0)
    pub future: bool,   // true = bucket is after "now" in the today grid (not yet)
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub range: String,
    pub tokens: TokenBreakdown, // token composition for the range
    pub claude_active_secs: i64, // Claude working
    pub distract_secs: i64,      // total time on a distraction (honest; matches Home)
    pub drift_secs: i64,         // drift (distraction while a turn waits)
    pub work_app_secs: i64,      // total wall-clock time on a work app
    pub distraction_breakdown: Vec<DistractionSlice>,
    pub avg_sessions: f64,       // time-weighted avg concurrent over engaged time in the range
    pub session_series: Vec<SessionPoint>, // time graph over the whole period
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
    /// `life` on the 0..cap (300) scale (field kept named `cloudHealth`).
    pub cloud_health: f64,
    /// Full / "par" life and the daily reset level (100).
    pub baseline: f64,
    /// Hard ceiling on life = baseline + banked bonus (300).
    pub cap: f64,
    pub waiting_sessions: i64,
    pub running_sessions: i64,
    /// Today's full budget in seconds (baseline level = time_to_death_min·60).
    pub budget_total_secs: i64,
    /// Signed budget-seconds gained per minute (negative = draining); lets the
    /// client tick the single budget timer smoothly between backend ticks.
    pub budget_rate_per_min: f64,
    /// Today's (reset-day) activity secs: active = states 1-4; distract = 3-4;
    /// drift = state 3 only (drifting); work = Σ running·dt; monitored = tracked time.
    pub active_secs_today: i64,
    pub distract_secs_today: i64,
    pub drift_secs_today: i64,
    pub work_secs_today: i64,
    pub work_app_secs_today: i64, // today's wall-clock secs on a work app
    pub monitored_secs_today: i64,
    /// Meter frozen (away/idle) — UI stops its local live timers.
    pub frozen: bool,
}
