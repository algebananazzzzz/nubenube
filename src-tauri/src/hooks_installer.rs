//! Non-destructive Claude Code hook installer.
//!
//! Appends a Stop + UserPromptSubmit hook to ~/.claude/settings.json (user
//! scope = all projects) that writes a small event line to
//! ~/.claude/hooks/nube/events.jsonl. We deep-merge into the existing JSON,
//! preserving the user's other hooks (e.g. Notification) and statusLine, and
//! back the file up once before the first edit.

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_json::{json, Value};

const HOOK_SCRIPT: &str = r#"#!/usr/bin/env bash
# Nube Nube hook bridge. $1 = event name (start | reengage | stop | end).
# Reads the Claude Code hook JSON from stdin and appends a compact event line.
set -euo pipefail
dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/nube"
mkdir -p "$dir"
input="$(cat)"
cwd=""
sid=""
if command -v jq >/dev/null 2>&1; then
  cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
  sid="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
fi
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"event":"%s","ts":"%s","cwd":"%s","sessionId":"%s"}\n' "${1:-stop}" "$ts" "$cwd" "$sid" >> "$dir/events.jsonl"
exit 0
"#;

pub fn claude_dir() -> PathBuf {
    if let Ok(v) = std::env::var("CLAUDE_CONFIG_DIR") {
        if let Some(first) = v.split(',').next() {
            let first = first.trim();
            if !first.is_empty() {
                return PathBuf::from(first);
            }
        }
    }
    dirs::home_dir().unwrap_or_default().join(".claude")
}

pub fn events_file() -> PathBuf {
    claude_dir().join("hooks").join("nube").join("events.jsonl")
}

fn script_path_in(dir: &Path) -> PathBuf {
    dir.join("hooks").join("nube").join("nube-hook.sh")
}

fn entry_is_nube(entry: &Value) -> bool {
    entry
        .get("hooks")
        .and_then(|h| h.as_array())
        .map(|hs| {
            hs.iter().any(|hh| {
                hh.get("command")
                    .and_then(|c| c.as_str())
                    .map(|c| c.contains("nube-hook"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn add_hook_entry(root: &mut Value, event: &str, command: &str) {
    let hooks = root
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert(json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let arr = hooks.as_object_mut().unwrap().entry(event).or_insert(json!([]));
    if !arr.is_array() {
        *arr = json!([]);
    }
    let arr = arr.as_array_mut().unwrap();
    if arr.iter().any(entry_is_nube) {
        return; // already present — idempotent
    }
    arr.push(json!({
        "hooks": [ { "type": "command", "command": command, "timeout": 5 } ]
    }));
}

pub fn install_at(dir: &Path) -> Result<()> {
    let nube_dir = dir.join("hooks").join("nube");
    std::fs::create_dir_all(&nube_dir)?;

    let script = script_path_in(dir);
    std::fs::write(&script, HOOK_SCRIPT)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755));
    }

    let settings_path = dir.join("settings.json");
    let mut root: Value = if settings_path.exists() {
        let txt = std::fs::read_to_string(&settings_path)?;
        let bak = dir.join("settings.json.nube-backup");
        if !bak.exists() {
            let _ = std::fs::write(&bak, &txt);
        }
        serde_json::from_str(&txt).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };
    if !root.is_object() {
        root = json!({});
    }

    let base = format!("bash '{}'", script.display());
    add_hook_entry(&mut root, "SessionStart", &format!("{base} start"));
    add_hook_entry(&mut root, "UserPromptSubmit", &format!("{base} reengage"));
    add_hook_entry(&mut root, "Stop", &format!("{base} stop"));
    add_hook_entry(&mut root, "SessionEnd", &format!("{base} end"));

    std::fs::write(&settings_path, serde_json::to_string_pretty(&root)?)?;
    Ok(())
}

pub fn uninstall_at(dir: &Path) -> Result<()> {
    let settings_path = dir.join("settings.json");
    if !settings_path.exists() {
        return Ok(());
    }
    let txt = std::fs::read_to_string(&settings_path)?;
    let mut root: Value = serde_json::from_str(&txt).unwrap_or_else(|_| json!({}));
    for ev in ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"] {
        if let Some(arr) = root
            .get_mut("hooks")
            .and_then(|h| h.get_mut(ev))
            .and_then(|a| a.as_array_mut())
        {
            arr.retain(|entry| !entry_is_nube(entry));
        }
    }
    std::fs::write(&settings_path, serde_json::to_string_pretty(&root)?)?;
    Ok(())
}

pub fn is_installed_at(dir: &Path) -> bool {
    let txt = match std::fs::read_to_string(dir.join("settings.json")) {
        Ok(t) => t,
        Err(_) => return false,
    };
    let root: Value = match serde_json::from_str(&txt) {
        Ok(v) => v,
        Err(_) => return false,
    };
    ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"].iter().any(|ev| {
        root.get("hooks")
            .and_then(|h| h.get(*ev))
            .and_then(|a| a.as_array())
            .map(|arr| arr.iter().any(entry_is_nube))
            .unwrap_or(false)
    })
}

pub fn install() -> Result<()> {
    install_at(&claude_dir())
}
pub fn uninstall() -> Result<()> {
    uninstall_at(&claude_dir())
}
pub fn is_installed() -> bool {
    is_installed_at(&claude_dir())
}

/// Re-add any missing nube hook entries IF the user previously installed
/// (the script file exists). Fixes the empty-array regression on launch.
pub fn ensure_installed_at(dir: &Path) -> Result<()> {
    if script_path_in(dir).exists() {
        install_at(dir)?; // add_hook_entry is idempotent — only fills gaps
    }
    Ok(())
}
pub fn ensure_installed() -> Result<()> {
    ensure_installed_at(&claude_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_destructive_merge() {
        let dir = std::env::temp_dir().join(format!("nube_hooks_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Pre-existing config like the real machine: a Notification hook + ccstatusline.
        let existing = json!({
            "hooks": {
                "Notification": [ { "hooks": [ { "type": "command", "command": "terminal-notifier" } ] } ],
                "Stop": []
            },
            "statusLine": { "type": "command", "command": "ccstatusline" },
            "env": { "FOO": "bar" }
        });
        std::fs::write(dir.join("settings.json"), serde_json::to_string_pretty(&existing).unwrap()).unwrap();

        install_at(&dir).unwrap();
        assert!(is_installed_at(&dir));

        let after: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("settings.json")).unwrap()).unwrap();
        // preserved
        assert_eq!(after["statusLine"]["command"], "ccstatusline");
        assert_eq!(after["env"]["FOO"], "bar");
        assert!(after["hooks"]["Notification"][0]["hooks"][0]["command"] == "terminal-notifier");
        // added
        let stop = after["hooks"]["Stop"].as_array().unwrap();
        assert!(stop.iter().any(entry_is_nube));
        assert!(after["hooks"]["UserPromptSubmit"].as_array().unwrap().iter().any(entry_is_nube));
        assert!(after["hooks"]["SessionStart"].as_array().unwrap().iter().any(entry_is_nube));
        assert!(after["hooks"]["SessionEnd"].as_array().unwrap().iter().any(entry_is_nube));
        // backup
        assert!(dir.join("settings.json.nube-backup").exists());
        assert!(script_path_in(&dir).exists());

        // idempotent
        install_at(&dir).unwrap();
        let after2: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(after2["hooks"]["Stop"].as_array().unwrap().len(), 1);

        // uninstall restores
        uninstall_at(&dir).unwrap();
        assert!(!is_installed_at(&dir));
        let after3: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("settings.json")).unwrap()).unwrap();
        assert!(after3["hooks"]["Notification"].as_array().unwrap().len() >= 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_installed_repairs_empty_arrays() {
        let dir = std::env::temp_dir().join(format!("nube_heal_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // First install (creates script + entries), then simulate the regression:
        install_at(&dir).unwrap();
        let regressed = json!({ "hooks": { "Stop": [], "UserPromptSubmit": [], "SessionStart": [], "SessionEnd": [] } });
        std::fs::write(dir.join("settings.json"), serde_json::to_string_pretty(&regressed).unwrap()).unwrap();
        assert!(!is_installed_at(&dir));

        // Script still exists -> ensure_installed re-adds all four.
        ensure_installed_at(&dir).unwrap();
        assert!(is_installed_at(&dir));
        let after: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("settings.json")).unwrap()).unwrap();
        for ev in ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"] {
            assert!(after["hooks"][ev].as_array().unwrap().iter().any(entry_is_nube), "{ev} not repaired");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
