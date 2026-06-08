//! Non-destructive Claude Code hook installer. Deep-merges nube hooks into
//! ~/.claude/settings.json (user scope), preserving the user's other hooks and
//! statusLine and backing the file up once before the first edit. Each hook
//! writes one event line to ~/.claude/hooks/nube/events.jsonl. Events:
//! SessionStart, UserPromptSubmit, Stop, SessionEnd, plus mid-turn block
//! (PreToolUse[AskUserQuestion] + Notification → wait, PostToolUse → reengage).

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_json::{json, Value};

const HOOK_SCRIPT: &str = r#"#!/usr/bin/env bash
# Nube Nube hook bridge. $1 = event name (start | reengage | stop | end | wait).
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

/// Every hook event nube installs into; the single source for install / uninstall
/// / is-installed so they can't drift out of sync.
const HOOK_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "Stop",
    "SessionEnd",
    "PreToolUse",
    "PostToolUse",
    "Notification",
];

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

fn add_hook_entry(root: &mut Value, event: &str, command: &str, matcher: Option<&str>) {
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
    let mut entry = json!({
        "hooks": [ { "type": "command", "command": command, "timeout": 5 } ]
    });
    // PreToolUse/PostToolUse entries carry a tool-name matcher; the lifecycle and
    // Notification hooks have none (they apply unconditionally).
    if let Some(m) = matcher {
        entry.as_object_mut().unwrap().insert("matcher".to_string(), json!(m));
    }
    arr.push(entry);
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
    add_hook_entry(&mut root, "SessionStart", &format!("{base} start"), None);
    add_hook_entry(&mut root, "UserPromptSubmit", &format!("{base} reengage"), None);
    add_hook_entry(&mut root, "Stop", &format!("{base} stop"), None);
    add_hook_entry(&mut root, "SessionEnd", &format!("{base} end"), None);
    // Mid-turn block: AskUserQuestion (PreToolUse) + permission/idle Notification
    // → wait; resume to Running when any tool completes (PostToolUse → reengage).
    add_hook_entry(&mut root, "PreToolUse", &format!("{base} wait"), Some("AskUserQuestion"));
    add_hook_entry(&mut root, "Notification", &format!("{base} wait"), None);
    add_hook_entry(&mut root, "PostToolUse", &format!("{base} reengage"), Some("*"));

    std::fs::write(&settings_path, serde_json::to_string_pretty(&root)?)?;
    Ok(())
}

pub fn uninstall_at(dir: &Path) -> Result<()> {
    let settings_path = dir.join("settings.json");
    if settings_path.exists() {
        let txt = std::fs::read_to_string(&settings_path)?;
        let mut root: Value = serde_json::from_str(&txt).unwrap_or_else(|_| json!({}));
        for &ev in HOOK_EVENTS {
            if let Some(arr) = root
                .get_mut("hooks")
                .and_then(|h| h.get_mut(ev))
                .and_then(|a| a.as_array_mut())
            {
                arr.retain(|entry| !entry_is_nube(entry));
            }
        }
        std::fs::write(&settings_path, serde_json::to_string_pretty(&root)?)?;
    }
    // Remove the script and its directory so ensure_installed doesn't re-add on next launch.
    let nube_dir = dir.join("hooks").join("nube");
    if nube_dir.exists() {
        let _ = std::fs::remove_dir_all(&nube_dir);
    }
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
    HOOK_EVENTS.iter().all(|ev| {
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
    if script_path_in(dir).exists() && !is_installed_at(dir) {
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
        // mid-turn hooks added with the right matchers + event suffixes
        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        let pre_nube = pre.iter().find(|e| entry_is_nube(e)).expect("PreToolUse nube entry");
        assert_eq!(pre_nube["matcher"], "AskUserQuestion");
        assert!(pre_nube["hooks"][0]["command"].as_str().unwrap().ends_with(" wait"));
        let post = after["hooks"]["PostToolUse"].as_array().unwrap();
        let post_nube = post.iter().find(|e| entry_is_nube(e)).expect("PostToolUse nube entry");
        assert_eq!(post_nube["matcher"], "*");
        assert!(post_nube["hooks"][0]["command"].as_str().unwrap().ends_with(" reengage"));
        // our Notification entry is added ALONGSIDE the user's terminal-notifier
        let notif = after["hooks"]["Notification"].as_array().unwrap();
        assert!(notif.iter().any(entry_is_nube));
        assert!(notif.iter().any(|e| e["hooks"][0]["command"] == "terminal-notifier"));
        // backup
        assert!(dir.join("settings.json.nube-backup").exists());
        assert!(script_path_in(&dir).exists());

        // idempotent
        install_at(&dir).unwrap();
        let after2: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(after2["hooks"]["Stop"].as_array().unwrap().len(), 1);
        assert_eq!(after2["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);
        // user's terminal-notifier + our one nube entry, no duplication
        assert_eq!(after2["hooks"]["Notification"].as_array().unwrap().len(), 2);

        // uninstall restores settings and removes script dir
        uninstall_at(&dir).unwrap();
        assert!(!is_installed_at(&dir));
        let after3: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("settings.json")).unwrap()).unwrap();
        // our Notification entry removed, the user's terminal-notifier preserved
        let notif3 = after3["hooks"]["Notification"].as_array().unwrap();
        assert!(!notif3.iter().any(entry_is_nube));
        assert!(notif3.iter().any(|e| e["hooks"][0]["command"] == "terminal-notifier"));
        // mid-turn tool hooks removed
        assert!(!after3["hooks"]["PreToolUse"].as_array().unwrap().iter().any(entry_is_nube));
        assert!(!after3["hooks"]["PostToolUse"].as_array().unwrap().iter().any(entry_is_nube));
        assert!(!script_path_in(&dir).exists(), "script should be deleted on uninstall");
        assert!(!dir.join("hooks").join("nube").exists(), "nube dir should be deleted on uninstall");
        // ensure_installed must NOT re-add after uninstall (no script on disk)
        ensure_installed_at(&dir).unwrap();
        assert!(!is_installed_at(&dir), "ensure_installed must not re-add after uninstall");

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
        for ev in [
            "SessionStart",
            "UserPromptSubmit",
            "Stop",
            "SessionEnd",
            "PreToolUse",
            "PostToolUse",
            "Notification",
        ] {
            assert!(after["hooks"][ev].as_array().unwrap().iter().any(entry_is_nube), "{ev} not repaired");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
