//! Names must match what the watcher reports: the .desktop `Name` on GNOME,
//! the bundle name on macOS.

#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::path::PathBuf;

pub fn list() -> Vec<String> {
    let me = std::env::current_exe().ok().and_then(|p| Some(p.file_name()?.to_string_lossy().into_owned())).unwrap_or_default();
    platform_list(&me)
}

#[cfg(target_os = "linux")]
fn platform_list(me: &str) -> Vec<String> {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let data_home = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".local/share"));
    let data_dirs = std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
    let dirs = std::iter::once(data_home).chain(data_dirs.split(':').filter(|d| !d.is_empty()).map(PathBuf::from));

    // First desktop-file ID wins, so a user's override shadows the system copy.
    let mut seen = std::collections::HashSet::new();
    let mut names = Vec::new();
    for dir in dirs {
        let root = dir.join("applications");
        for path in desktop_files(&root) {
            let id = path.strip_prefix(&root).unwrap_or(&path).to_string_lossy().replace('/', "-");
            if !seen.insert(id) {
                continue;
            }
            match std::fs::read_to_string(&path).ok().as_deref().and_then(parse_entry) {
                Some((name, exe)) if exe != me => names.push(name),
                _ => {}
            }
        }
    }
    names
}

#[cfg(target_os = "linux")]
fn desktop_files(dir: &std::path::Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out = Vec::new();
    for e in rd.flatten() {
        let p = e.path();
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            out.extend(desktop_files(&p));
        } else if p.extension().is_some_and(|x| x == "desktop") {
            out.push(p);
        }
    }
    out
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_entry(text: &str) -> Option<(String, String)> {
    let (mut in_entry, mut name, mut exe, mut app, mut hidden) = (false, None, String::new(), false, false);
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry {
            continue;
        }
        match line.split_once('=').map(|(k, v)| (k.trim(), v.trim())) {
            Some(("Name", v)) => name = Some(v.to_string()),
            Some(("Exec", v)) => {
                let prog = v.split_whitespace().next().unwrap_or("").trim_matches('"');
                exe = prog.rsplit('/').next().unwrap_or("").to_string();
            }
            Some(("Type", v)) => app = v == "Application",
            Some(("NoDisplay" | "Hidden", "true")) => hidden = true,
            _ => {}
        }
    }
    name.filter(|n| app && !hidden && !n.is_empty()).map(|n| (n, exe))
}

#[cfg(target_os = "macos")]
fn platform_list(me: &str) -> Vec<String> {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let dirs = [
        PathBuf::from("/Applications"),
        PathBuf::from("/Applications/Utilities"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
        home.join("Applications"),
    ];
    dirs.iter()
        .filter_map(|d| std::fs::read_dir(d).ok())
        .flat_map(|rd| rd.flatten())
        .filter_map(|e| {
            let p = e.path();
            if p.extension()? != "app" || p.join("Contents/MacOS").join(me).exists() {
                return None;
            }
            Some(p.file_stem()?.to_string_lossy().into_owned())
        })
        .collect()
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn platform_list(_me: &str) -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_unlocalized_name_of_a_visible_app() {
        let t = "[Desktop Entry]\nType=Application\nName=Spotify\nName[de]=Spotify DE\nExec=/snap/bin/spotify %U\n";
        assert_eq!(parse_entry(t), Some(("Spotify".into(), "spotify".into())));
    }

    #[test]
    fn skips_hidden_entries_and_non_apps() {
        assert_eq!(parse_entry("[Desktop Entry]\nType=Application\nName=Helper\nNoDisplay=true\n"), None);
        assert_eq!(parse_entry("[Desktop Entry]\nType=Application\nName=Gone\nHidden=true\n"), None);
        assert_eq!(parse_entry("[Desktop Entry]\nType=Link\nName=Docs\n"), None);
    }

    #[test]
    fn ignores_keys_outside_the_desktop_entry_group() {
        let t = "[Desktop Entry]\nType=Application\nName=Firefox\nExec=firefox\n[Desktop Action new-window]\nName=New Window\nExec=firefox --new-window\n";
        assert_eq!(parse_entry(t), Some(("Firefox".into(), "firefox".into())));
    }
}
