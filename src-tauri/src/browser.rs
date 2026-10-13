//! The bundled Chromium extension (`browser-extension/`) connects over a
//! localhost WebSocket. It reports the site in the focused browser window, and
//! Nube Nube sends back the domains to block while a timer runs.

use std::collections::HashMap;
use std::io::ErrorKind;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Deserialize;
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::http::StatusCode;
use tungstenite::{Message, WebSocket};

/// Pinned by the manifest's `key`. Web pages can open localhost sockets too, so
/// any other origin is refused.
const EXTENSION_ORIGIN: &str = "chrome-extension://hdaagdlhjfiocdohgbeoibmmkkgjhjmn";
/// The release build and `make dev` run side by side; background.js tries both.
const PORT: u16 = 47615;
const DEV_PORT: u16 = 47616;
/// How long a connection waits for a report before checking for a new block list.
const POLL: Duration = Duration::from_millis(250);

const FILES: [(&str, &[u8]); 5] = [
    ("manifest.json", include_bytes!("../browser-extension/manifest.json")),
    ("background.js", include_bytes!("../browser-extension/background.js")),
    ("blocked.html", include_bytes!("../browser-extension/blocked.html")),
    ("blocked.js", include_bytes!("../browser-extension/blocked.js")),
    ("icon.png", include_bytes!("../browser-extension/icon.png")),
];

#[derive(Default)]
pub struct Browser {
    next_id: u64,
    connected: usize,
    /// Connection → the site in its browser's focused window. Each browser
    /// profile is its own connection, and only one window has focus at a time.
    sites: HashMap<u64, String>,
    block: Vec<String>,
    version: u64,
}

pub type Shared = Arc<Mutex<Browser>>;

fn lock(shared: &Shared) -> MutexGuard<'_, Browser> {
    shared.lock().expect("browser mutex poisoned")
}

impl Browser {
    pub fn site(&self) -> Option<String> {
        self.sites.values().next().cloned()
    }

    pub fn connected(&self) -> bool {
        self.connected > 0
    }

    pub fn set_block(&mut self, domains: Vec<String>) {
        if domains != self.block {
            self.block = domains;
            self.version += 1;
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Report {
    Tab { domain: Option<String> },
}

pub fn listen(shared: Shared, dev: bool) {
    let port = if dev { DEV_PORT } else { PORT };
    let listener = match TcpListener::bind(("127.0.0.1", port)) {
        Ok(l) => l,
        // Site tracking and blocking go dark, but app tracking still works.
        Err(e) => return log::error!("browser extension port {port} unavailable: {e}"),
    };
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let shared = shared.clone();
            std::thread::spawn(move || {
                if let Err(e) = serve(stream, &shared) {
                    log::info!("browser extension disconnected: {e}");
                }
            });
        }
    });
}

// tungstenite's handshake callback trait fixes this signature.
#[allow(clippy::result_large_err)]
fn check_origin(req: &Request, res: Response) -> Result<Response, ErrorResponse> {
    if req.headers().get("origin").is_some_and(|o| o == EXTENSION_ORIGIN) {
        return Ok(res);
    }
    let mut err = ErrorResponse::new(None);
    *err.status_mut() = StatusCode::FORBIDDEN;
    Err(err)
}

fn serve(stream: TcpStream, shared: &Shared) -> Result<(), String> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|e| e.to_string())?;
    let mut ws = tungstenite::accept_hdr(stream, check_origin).map_err(|e| e.to_string())?;
    ws.get_ref().set_read_timeout(Some(POLL)).map_err(|e| e.to_string())?;
    let id = {
        let mut b = lock(shared);
        b.next_id += 1;
        b.connected += 1;
        b.next_id
    };
    let out = pump(&mut ws, id, shared);
    let mut b = lock(shared);
    b.connected -= 1;
    b.sites.remove(&id);
    out
}

fn pump(ws: &mut WebSocket<TcpStream>, id: u64, shared: &Shared) -> Result<(), String> {
    let mut sent = None;
    loop {
        let pending = {
            let b = lock(shared);
            (sent != Some(b.version)).then(|| (b.version, b.block.clone()))
        };
        if let Some((version, domains)) = pending {
            let msg = serde_json::json!({ "type": "block", "domains": domains }).to_string();
            ws.send(Message::text(msg)).map_err(|e| e.to_string())?;
            sent = Some(version);
        }
        match ws.read() {
            Ok(Message::Text(text)) => {
                let Report::Tab { domain } = serde_json::from_str(text.as_str()).map_err(|e| e.to_string())?;
                let mut b = lock(shared);
                match domain {
                    Some(d) => b.sites.insert(id, d.to_ascii_lowercase()),
                    None => b.sites.remove(&id),
                };
            }
            Ok(_) => {}
            Err(tungstenite::Error::ConnectionClosed) => return Ok(()),
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
}

pub fn dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("chrome-extension")
}

/// Write the extension where Chrome's "Load unpacked" can pick it up.
pub fn install(app_data_dir: &Path) -> std::io::Result<PathBuf> {
    let dir = dir(app_data_dir);
    std::fs::create_dir_all(&dir)?;
    for (name, bytes) in FILES {
        std::fs::write(dir.join(name), bytes)?;
    }
    Ok(dir)
}

/// Keep an installed copy current: Chrome reads an unpacked extension from disk
/// at launch, so an app update otherwise leaves the old protocol running.
pub fn refresh(app_data_dir: &Path) -> std::io::Result<()> {
    if dir(app_data_dir).exists() {
        install(app_data_dir)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_key_matches_the_allowed_origin() {
        use base64::Engine;
        use sha2::Digest;
        let manifest: serde_json::Value = serde_json::from_slice(FILES[0].1).unwrap();
        let der = base64::engine::general_purpose::STANDARD.decode(manifest["key"].as_str().unwrap()).unwrap();
        // Chrome's id: the first 16 bytes of SHA-256(public key DER), hex digits mapped 0-f → a-p.
        let id: String = sha2::Sha256::digest(&der)[..16]
            .iter()
            .flat_map(|b| [b >> 4, b & 0xf])
            .map(|nib| (b'a' + nib) as char)
            .collect();
        assert_eq!(format!("chrome-extension://{id}"), EXTENSION_ORIGIN);
    }

    #[test]
    fn extension_ports_match_background_js() {
        let js = std::str::from_utf8(FILES[1].1).unwrap();
        assert!(js.contains(&format!("const PORTS = [{PORT}, {DEV_PORT}]")));
    }

    fn read_json<S: std::io::Read + std::io::Write>(ws: &mut WebSocket<S>) -> serde_json::Value {
        serde_json::from_str(ws.read().unwrap().into_text().unwrap().as_str()).unwrap()
    }

    #[test]
    fn a_connected_extension_reports_sites_and_receives_block_lists() {
        let shared = Shared::default();
        lock(&shared).set_block(vec!["youtube.com".into()]);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = shared.clone();
        std::thread::spawn(move || serve(listener.accept().unwrap().0, &server));

        let mut req = tungstenite::client::IntoClientRequest::into_client_request(format!("ws://{addr}")).unwrap();
        req.headers_mut().insert("origin", EXTENSION_ORIGIN.parse().unwrap());
        let (mut ws, _) = tungstenite::connect(req).unwrap();
        assert_eq!(read_json(&mut ws), serde_json::json!({ "type": "block", "domains": ["youtube.com"] }));

        ws.send(Message::text(r#"{"type":"tab","domain":"GitHub.com"}"#)).unwrap();
        lock(&shared).set_block(Vec::new());
        assert_eq!(read_json(&mut ws), serde_json::json!({ "type": "block", "domains": [] }));
        assert!(lock(&shared).connected());
        assert_eq!(lock(&shared).site().as_deref(), Some("github.com"));

        ws.close(None).unwrap();
        while ws.read().is_ok() {}
        std::thread::sleep(POLL * 2);
        assert!(!lock(&shared).connected());
        assert_eq!(lock(&shared).site(), None);
    }

    #[test]
    fn other_origins_are_refused() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || serve(listener.accept().unwrap().0, &Shared::default()));
        let mut req = tungstenite::client::IntoClientRequest::into_client_request(format!("ws://{addr}")).unwrap();
        req.headers_mut().insert("origin", "https://evil.example".parse().unwrap());
        assert!(tungstenite::connect(req).is_err());
    }
}
