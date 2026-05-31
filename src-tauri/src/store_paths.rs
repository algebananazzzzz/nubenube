//! Discover Claude Code log roots and enumerate session JSONL files.
//! Precedence mirrors ccusage: CLAUDE_CONFIG_DIR (comma-split, each must contain
//! `projects/`), else $XDG_CONFIG_HOME/claude, else ~/.claude and ~/.config/claude.

use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub fn log_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    let push_if_valid = |p: PathBuf, roots: &mut Vec<PathBuf>| {
        if p.join("projects").is_dir() && !roots.contains(&p) {
            roots.push(p);
        }
    };

    if let Ok(v) = std::env::var("CLAUDE_CONFIG_DIR") {
        for part in v.split(',') {
            let part = part.trim();
            if !part.is_empty() {
                push_if_valid(PathBuf::from(part), &mut roots);
            }
        }
    }

    if roots.is_empty() {
        if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
            push_if_valid(PathBuf::from(xdg).join("claude"), &mut roots);
        }
        if let Some(home) = dirs::home_dir() {
            push_if_valid(home.join(".claude"), &mut roots);
            push_if_valid(home.join(".config").join("claude"), &mut roots);
        }
    }

    roots
}

/// The project id = the path segment immediately after `projects/`
/// (ccusage's `extract_project`). Stable & unique even though the dir name
/// is a lossy encoding of the cwd.
pub fn project_id_from_path(path: &Path, root: &Path) -> Option<String> {
    let base = root.join("projects");
    let rel = path.strip_prefix(&base).ok()?;
    rel.components()
        .next()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
}

/// All `*.jsonl` under a root's `projects/` (recursive — includes nested
/// `<sessionId>/subagents/*.jsonl`, which carry real billable usage).
pub fn list_session_files(root: &Path) -> Vec<PathBuf> {
    let base = root.join("projects");
    WalkDir::new(&base)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| p.extension().map(|x| x == "jsonl").unwrap_or(false))
        .collect()
}
