//! Keeps the display/system awake while Claude is actively working, gated on the
//! `keepAwake` setting. The OS assertion guard (`keepawake::KeepAwake`) isn't
//! guaranteed `Send`, and `DriftRuntime` lives in an `Arc<Mutex<>>` shared across
//! threads, so the guard can't be a field on it. A dedicated owner thread holds
//! the guard instead; the drift tick only sends the desired on/off state over a
//! `bool` channel (which is always `Send`).

use std::sync::mpsc::{self, Sender};

pub struct AwakeController {
    tx: Sender<bool>,
}

impl AwakeController {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<bool>();
        std::thread::spawn(move || {
            // Held only while awake; dropping releases the OS assertion. A failed
            // create() (e.g. no D-Bus on a headless Linux box) leaves it None and
            // is simply retried on the next "on" edge.
            let mut guard: Option<keepawake::KeepAwake> = None;
            while let Ok(want) = rx.recv() {
                match (want, guard.is_some()) {
                    (true, false) => {
                        guard = keepawake::Builder::default()
                            .display(true)
                            .idle(true)
                            .reason("Claude session running")
                            .app_name("NubeNube")
                            .create()
                            .ok();
                    }
                    (false, true) => guard = None,
                    _ => {}
                }
            }
        });
        AwakeController { tx }
    }

    /// Request the awake state. Idempotent and cheap; the owner thread no-ops a
    /// repeat of the current state.
    pub fn set(&self, on: bool) {
        let _ = self.tx.send(on);
    }
}
