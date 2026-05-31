//! Deserialization structs for a Claude Code session JSONL line.
//! Only the fields the connector needs; everything else is ignored. Parsing is
//! defensive (every field Optional) to tolerate schema drift across CC versions.

use serde::Deserialize;

#[derive(Deserialize)]
pub struct Line {
    #[serde(rename = "type")]
    pub rtype: Option<String>,
    pub timestamp: Option<String>,
    #[serde(rename = "requestId")]
    pub request_id: Option<String>,
    pub uuid: Option<String>,
    pub cwd: Option<String>,
    #[serde(rename = "isSidechain")]
    pub is_sidechain: Option<bool>,
    pub message: Option<Msg>,
}

#[derive(Deserialize)]
pub struct Msg {
    pub id: Option<String>,
    pub model: Option<String>,
    pub usage: Option<Usage>,
}

#[derive(Deserialize)]
pub struct Usage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_creation_input_tokens: Option<i64>,
    pub cache_read_input_tokens: Option<i64>,
}
