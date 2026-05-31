//! Tails ~/.claude/hooks/nube/events.jsonl and feeds
//! SessionStart/UserPromptSubmit/Stop/SessionEnd events into the drift state
//! machine. Decoupled from Claude Code (events
//! queue on disk even while the app is closed); we start reading at EOF so only
//! NEW events fire.

use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;

use crate::drift::DriftRuntime;
use crate::hooks_installer;

#[derive(Deserialize)]
struct Ev {
    event: Option<String>,
    cwd: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}

pub fn start(_app: AppHandle, runtime: Arc<Mutex<DriftRuntime>>) {
    std::thread::spawn(move || {
        let path = hooks_installer::events_file();
        let mut offset: u64 = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

        loop {
            std::thread::sleep(Duration::from_secs(3));
            let size = match std::fs::metadata(&path) {
                Ok(m) => m.len(),
                Err(_) => {
                    offset = 0;
                    continue;
                }
            };
            if size < offset {
                offset = 0; // rotated/truncated
            }
            if size == offset {
                continue;
            }
            let mut f = match File::open(&path) {
                Ok(f) => f,
                Err(_) => continue,
            };
            if f.seek(SeekFrom::Start(offset)).is_err() {
                continue;
            }
            let mut reader = BufReader::new(f);
            let mut consumed = offset;
            loop {
                let mut line = String::new();
                let n = match reader.read_line(&mut line) {
                    Ok(n) => n,
                    Err(_) => break,
                };
                if n == 0 {
                    break;
                }
                if !line.ends_with('\n') {
                    break; // partial line — wait for the rest
                }
                consumed += n as u64;
                if let Ok(ev) = serde_json::from_str::<Ev>(&line) {
                    let cwd = ev.cwd.unwrap_or_default();
                    let sid = ev.session_id.unwrap_or_default();
                    if let Ok(mut rt) = runtime.lock() {
                        match ev.event.as_deref() {
                            Some("start") => rt.handle_start(&sid, &cwd),
                            Some("reengage") => rt.handle_reengage(&sid, &cwd),
                            Some("stop") => rt.handle_stop(&sid, &cwd),
                            Some("end") => rt.handle_end(&sid),
                            _ => {}
                        }
                    }
                }
            }
            offset = consumed;
        }
    });
}
