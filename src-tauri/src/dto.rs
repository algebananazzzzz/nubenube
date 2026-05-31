//! Output structs returned to the frontend. `rename_all = "camelCase"` makes
//! them match src/types.ts exactly (cacheCreate, waterMl, projectCount, ...).

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
    pub first_seen_utc: String,
    pub last_seen_utc: String,
    pub tokens: TokenBreakdown,
    pub water_ml: f64,
    pub monthly_water_ml: f64,
    pub today_water_ml: f64,
    pub cloud_health: f64,
    pub drift_secs_today: i64,
    pub claude_active_secs_today: i64,
    pub msg_count: i64,
    pub last7: Vec<f64>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub water_ml: f64,
    pub tokens: TokenBreakdown,
    pub project_count: i64,
    pub today_water_ml: f64,
    pub month_water_ml: f64,
    pub claude_active_secs_today: i64,
    pub drift_secs_today: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DayPoint {
    pub day: String,
    pub water_ml: f64,
    pub tokens: TokenBreakdown,
    pub drift_secs: i64,
    pub claude_active_secs: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HourPoint {
    pub hour: i64,
    pub water_ml: f64,
    pub drift_secs: i64,
    pub count: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TopProject {
    pub id: String,
    pub name: String,
    pub water_ml: f64,
    pub color_hue: i64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub range: String,
    pub water_ml: f64,
    pub tokens: TokenBreakdown,
    pub by_day: Vec<DayPoint>,
    pub by_hour: Vec<HourPoint>,
    pub top_projects: Vec<TopProject>,
    pub claude_active_secs: i64,
    pub drift_secs: i64,
    pub longest_focus_streak_secs: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    pub screen_recording: bool,
    pub automation: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub connected: bool,
    pub log_roots: Vec<String>,
    pub projects_detected: i64,
    pub sessions_scanned: i64,
    pub hooks_installed: bool,
    pub last_scan_utc: Option<String>,
    pub naive_dedup_ratio: Option<f64>,
    pub permissions: Permissions,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: Project,
    pub by_day: Vec<DayPoint>,
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
    pub app_id: String,
    pub app_name: String,
    pub app_class: String,
    pub title: Option<String>,
    pub idle_secs: i64,
    pub state: String,
    pub active_project_id: Option<String>,
    pub active_project_name: Option<String>,
    pub cloud_health: f64,
    pub seconds_since_claude_finished: Option<i64>,
    pub waiting_sessions: i64,
    pub running_sessions: i64,
    pub seconds_to_death: Option<i64>,
}
