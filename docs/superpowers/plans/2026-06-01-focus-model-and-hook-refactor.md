# NubeNube Hook + Focus Model + Overlay Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Claude Code hook reliable, retie the focus meter to real Claude session activity (token-driven recovery, distraction-only decay), replace the full-screen takeover with a draggable always-on-top buddy indicator, and surface per-app distraction time + a transparent calculation in Insights.

**Architecture:** Tauri 2 app. Rust backend: a `nube-hook.sh` bridge writes session events to `events.jsonl`; `events_tail.rs` feeds them to a `DriftRuntime` (drift.rs) state machine that tracks per-session lifecycle and a per-project `cloudHealth` (0..1). The watcher samples the active app; classification is now a user-curated **distraction-only** exact-match set. Health **decays** only while ≥1 session waits and the active app is a distraction; **recovers** proportional to tokens Claude consumes (from `messages_seen`), 10× gentler than decay; **holds** otherwise. The React frontend (Zustand stores, hash-routed windows) renders a `companion` overlay window as the live indicator.

**Tech Stack:** Rust (rusqlite, serde_json, chrono, tauri 2.11, active-win-pos-rs), TypeScript/React 19, Zustand, Vite.

**Spec:** `docs/superpowers/specs/2026-06-01-focus-model-and-hook-refactor-design.md`

**Verification gate (per project memory):** Rust = `cd src-tauri && cargo test` / `cargo build`. Frontend = `npm run build` (which is `tsc -b && vite build`). **Do NOT use `npm run lint`** (pre-broken). Repo is not git-initialized — Phase 0 fixes that.

**Key calibration constants (confirm against real usage during Phase 2):**
- `decay_per_min = 0.06` (6% of life/min per waiting session). From full health: 1 waiting ≈ 16 min to death, 4 waiting ≈ 4 min.
- `recovery_per_token = 0.000004` (4e-6 health per token), counting `input + output + cache_create` (excludes `cache_read` context-replay). ⇒ ~75k tokens of real work ≈ +0.30 health. Intentionally ~10× gentler than decay.
- `grace_secs = 10` (default for new installs; decay begins after 10s of drift; countdown shown immediately).

---

## File Structure

**Rust (`src-tauri/src/`)**
- `hooks_installer.rs` — register/self-heal 4 hooks (`SessionStart`/`UserPromptSubmit`/`Stop`/`SessionEnd`); idempotent.
- `events_tail.rs` — map `start`/`reengage`/`stop`/`end` → `DriftRuntime`.
- `drift.rs` — per-session lifecycle map + token-driven focus model + countdown; pure helpers `apply_focus`/`seconds_to_death`.
- `watcher.rs` — distraction-only exact-match classification.
- `settings.rs` — `Sensitivity` gains `recovery_per_token`, default `grace_secs=10`; drop `work_apps`/`neutral_apps` from the model.
- `db.rs` — `project_token_total`, `record_known_app`, `get_known_apps`, `drift_by_app` table + `add_drift_by_app`/`drift_app_breakdown`.
- `commands.rs` — `list_running_apps`, `get_known_apps`; drop takeover commands; don't reposition companion on every show.
- `dto.rs` — `FocusTickDto` gains `running_sessions`, `seconds_to_death`; `Insights` gains `distraction_breakdown`; new `KnownApp`.
- `lib.rs` — companion window `visible(true)` + `visible_on_all_workspaces`; remove takeover window; `ensure_installed()` at startup; register new commands.
- `notify.rs` — unchanged.

**Frontend (`src/`)**
- `types.ts` — `FocusTick` gains `runningSessions`/`secondsToDeath`; `Sensitivity.recoveryPerMin`→`recoveryPerToken`; drop `workApps`/`neutralApps`; `AppClass='distraction'|'neutral'`; `Insights` gains `distractionBreakdown`.
- `lib/mockData.ts` — match new types.
- `lib/derive.ts` — `phaseFromTick` reads `state==='waiting'`.
- `lib/rescue.ts` — drop takeover wrappers.
- `lib/api.ts` — add `listRunningApps`, `getKnownApps`.
- `components/Companion.tsx` — drag handle + counts + countdown indicator.
- `components/AppShell.tsx` — remove takeover supervisor + in-app overlay + rescue demo row.
- `components/Takeover.tsx` — deleted.
- `App.tsx` — remove `takeover` route.
- `store/prefs.ts` — drop takeover flags.
- `store/demo.ts` — drop takeover.
- `pages/Settings.tsx` — distraction picker from discovered/running apps; remove full-screen-rescues card.
- `pages/Insights.tsx` — distraction breakdown + honest labels.

**Config**
- `src-tauri/tauri.conf.json` — main window stays resizable (verify); companion drag handled in JS.

---

## Phase 0 — Repo init (enables commits)

### Task 0.1: Initialize git + baseline commit

**Files:**
- Create: `/Users/bytedance/nubenube/.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
src-tauri/target/
*.log
.DS_Store
```

- [ ] **Step 2: Init and commit baseline**

Run:
```bash
cd /Users/bytedance/nubenube
git init
git add -A
git commit -m "chore: baseline before hook + focus-model refactor"
```
Expected: a commit is created. (If `git` identity is unset, set `user.email`/`user.name` first.)

> All later "Commit" steps assume git now works. Commit messages must NOT include `Co-Authored-By` (per user CLAUDE.md).

---

## Phase 1 — Hook reliability + session lifecycle (backend only)

End state: all 4 hooks register and self-heal on launch; `DriftRuntime` tracks running/waiting/idle sessions; `focus-tick` carries `runningSessions` + `secondsToDeath`. `cargo build` + `cargo test` pass. Frontend untouched (extra JSON fields are ignored by `invoke<FocusTick>`).

### Task 1.1: Hook installer registers 4 events + self-heals

**Files:**
- Modify: `src-tauri/src/hooks_installer.rs`

- [ ] **Step 1: Update the hook-script comment and add `start`/`end` to the model**

Replace the comment line inside `HOOK_SCRIPT` (line 15):
```rust
# Nube Nube hook bridge. $1 = event name (start | reengage | stop | end).
```
(The script body already writes `$1` verbatim — no other change needed.)

- [ ] **Step 2: Register all four hooks in `install_at`**

Replace the two `add_hook_entry` calls (currently lines 117-118) with:
```rust
    let base = format!("bash '{}'", script.display());
    add_hook_entry(&mut root, "SessionStart", &format!("{base} start"));
    add_hook_entry(&mut root, "UserPromptSubmit", &format!("{base} reengage"));
    add_hook_entry(&mut root, "Stop", &format!("{base} stop"));
    add_hook_entry(&mut root, "SessionEnd", &format!("{base} end"));
```

- [ ] **Step 3: Update `uninstall_at` + `is_installed_at` event lists**

In `uninstall_at`, change the loop array to:
```rust
    for ev in ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"] {
```
In `is_installed_at`, change the array to:
```rust
    ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"].iter().any(|ev| {
```

- [ ] **Step 4: Add self-heal `ensure_installed`**

Add after the `is_installed()` fn (after line 170):
```rust
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
```

- [ ] **Step 5: Add a test for self-heal of empty arrays**

Add inside `mod tests`:
```rust
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
```

- [ ] **Step 6: Update the existing `non_destructive_merge` test for 4 events**

In `non_destructive_merge`, after the existing `UserPromptSubmit` assertion (line ~205), add:
```rust
        assert!(after["hooks"]["SessionStart"].as_array().unwrap().iter().any(entry_is_nube));
        assert!(after["hooks"]["SessionEnd"].as_array().unwrap().iter().any(entry_is_nube));
```

- [ ] **Step 7: Run tests**

Run: `cd /Users/bytedance/nubenube/src-tauri && cargo test hooks_installer -- --nocapture`
Expected: PASS (both tests).

- [ ] **Step 8: Commit**

```bash
cd /Users/bytedance/nubenube
git add src-tauri/src/hooks_installer.rs
git commit -m "feat(hook): register 4 lifecycle hooks + self-heal empty arrays"
```

### Task 1.2: Call `ensure_installed` on startup

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Self-heal hooks during setup**

In `lib.rs` `setup`, immediately after `connector::start(...)` (line 76), add:
```rust
            // Self-heal Claude Code hooks if the user previously installed them
            // (fixes the empty-array regression that silenced events).
            let _ = hooks_installer::ensure_installed();
```

- [ ] **Step 2: Build**

Run: `cd /Users/bytedance/nubenube/src-tauri && cargo build`
Expected: compiles (warnings ok).

- [ ] **Step 3: Commit**

```bash
cd /Users/bytedance/nubenube
git add src-tauri/src/lib.rs
git commit -m "feat(hook): self-heal hooks on app launch"
```

### Task 1.3: DTO — running sessions + countdown

**Files:**
- Modify: `src-tauri/src/dto.rs:116-131`

- [ ] **Step 1: Extend `FocusTickDto`**

In `FocusTickDto`, after `pub waiting_sessions: i64,` add:
```rust
    pub running_sessions: i64,
    pub seconds_to_death: Option<i64>,
```

- [ ] **Step 2: Build (will fail until drift.rs fills the fields — expected)**

Run: `cd /Users/bytedance/nubenube/src-tauri && cargo build`
Expected: FAIL — `build_tick` in drift.rs is missing the two new fields. Fixed in Task 1.4.

### Task 1.4: Session lifecycle state machine in `drift.rs`

**Files:**
- Modify: `src-tauri/src/drift.rs`

- [ ] **Step 1: Replace `Waiting` with a lifecycle `Session`**

Replace the `Waiting` struct (lines 29-34) with:
```rust
/// One Claude session, tracked across its lifecycle.
#[derive(Clone, Copy, PartialEq)]
enum SessionPhase {
    Idle,    // SessionStart seen, no prompt yet
    Running, // UserPromptSubmit — Claude is working (tokens flow)
    Waiting, // Stop — finished, waiting for the user
}

struct Session {
    project_id: Option<String>,
    phase: SessionPhase,
    since: Instant, // entered `phase` at this time (drives grace + countdown)
    notified: bool,
}
```

- [ ] **Step 2: Update `DriftRuntime` fields**

In `pub struct DriftRuntime` (lines 36-46), rename `waiting` and add a token cursor:
```rust
    waiting: HashMap<String, Session>,
    last_token_total: i64,
```
And in `DriftRuntime::new` (line 74-84), add the initializer after `waiting: HashMap::new(),`:
```rust
            last_token_total: 0,
```

- [ ] **Step 3: Track token cursor on adopt**

In `adopt_project` (lines 93-102), after `self.health = h;` add:
```rust
        self.last_token_total = db::project_token_total(conn, pid);
```
(The `project_token_total` helper is added in Task 2.2; for now Phase 1 builds because drift.rs and db.rs compile together — add the helper now as a stub if running Phase 1 in isolation. If executing phases in order, do Task 2.2's helper before building this. To keep Phase 1 self-contained, add this minimal helper to `db.rs` now:)

```rust
/// Sum of "meaningful" tokens (input+output+cache_create; excludes cache_read
/// context replay) for a project. Drives token-based health recovery.
pub fn project_token_total(conn: &Connection, pid: &str) -> i64 {
    conn.query_row(
        "SELECT COALESCE(SUM(input+output+cache_create),0) FROM messages_seen WHERE project_id=?1",
        [pid],
        |r| r.get(0),
    )
    .unwrap_or(0)
}
```

- [ ] **Step 4: Rewrite the event handlers**

Replace `handle_stop` and `handle_reengage` (lines 112-135) with:
```rust
    fn upsert(&mut self, session_id: &str, cwd: &str, phase: SessionPhase) {
        let mut project_id = None;
        if let Ok(conn) = db::open(&self.db_path) {
            if let Some(pid) = db::resolve_project_by_cwd(&conn, cwd) {
                project_id = Some(pid.clone());
                self.adopt_project(&conn, &pid);
            }
        }
        let key = Self::session_key(session_id);
        let entry = self.waiting.entry(key).or_insert(Session {
            project_id: project_id.clone(),
            phase,
            since: Instant::now(),
            notified: false,
        });
        if project_id.is_some() {
            entry.project_id = project_id;
        }
        entry.phase = phase;
        entry.since = Instant::now();
        entry.notified = false;
    }

    /// SessionStart hook.
    pub fn handle_start(&mut self, session_id: &str, cwd: &str) {
        self.upsert(session_id, cwd, SessionPhase::Idle);
    }
    /// UserPromptSubmit hook: session is running (Claude working).
    pub fn handle_reengage(&mut self, session_id: &str, cwd: &str) {
        self.upsert(session_id, cwd, SessionPhase::Running);
    }
    /// Stop hook: session finished — begin its waiting window + countdown.
    pub fn handle_stop(&mut self, session_id: &str, cwd: &str) {
        self.upsert(session_id, cwd, SessionPhase::Waiting);
    }
    /// SessionEnd hook: session removed.
    pub fn handle_end(&mut self, session_id: &str) {
        self.waiting.remove(&Self::session_key(session_id));
    }
```

- [ ] **Step 5: Update `tick` to use phases + emit counts (Phase-1 scope: counts only; full model math lands in Phase 2)**

In `tick`, replace the abandoned-session retain + waiting summary block (lines 172-180) with:
```rust
        // drop only abandoned WAITING sessions; keep running/idle
        self.waiting.retain(|_, s| {
            !(s.phase == SessionPhase::Waiting && (now - s.since).as_secs() > ABANDON_SECS)
        });
        let grace = s.sensitivity.grace_secs.max(0) as u64;
        let waiting_list: Vec<(Option<String>, u64)> = self
            .waiting
            .values()
            .filter(|s| s.phase == SessionPhase::Waiting)
            .map(|s| (s.project_id.clone(), (now - s.since).as_secs()))
            .collect();
        let (waiting_count, per_project, longest) = waiting_load(&waiting_list, grace);
        let running_count = self
            .waiting
            .values()
            .filter(|s| s.phase == SessionPhase::Running)
            .count() as i64;
```

In the `paused || idle` branch, the freeze loop (lines 189-192) should only freeze waiting sessions:
```rust
            for s in self.waiting.values_mut() {
                if s.phase == SessionPhase::Waiting {
                    s.since += frozen;
                }
            }
```

In the drift-moment block (lines 239-247), change `for w in self.waiting.values_mut()` to filter waiting:
```rust
            for w in self.waiting.values_mut().filter(|s| s.phase == SessionPhase::Waiting) {
```

- [ ] **Step 6: Fill the new DTO fields in `build_tick`**

Change `build_tick`'s signature and body. Replace the signature (lines 259-265) and the `FocusTickDto { ... }` tail so it accepts and emits the counts. Update the two call sites (lines 249 and 256) to pass `running_count` and the computed `seconds_to_death`.

For Phase 1, compute a placeholder countdown from the existing fields (real decay math arrives in Phase 2). Add this just before the final `app.emit("focus-tick", ...)` (line 256):
```rust
        let seconds_to_death = seconds_to_death(self.health, waiting_count, s.sensitivity.decay_per_min);
```
Then change `build_tick` to:
```rust
    fn build_tick(
        &self,
        snap: &watcher::Snapshot,
        class: AppClass,
        since_stop: Option<u64>,
        waiting_sessions: i64,
        running_sessions: i64,
        seconds_to_death: Option<i64>,
    ) -> FocusTickDto {
        FocusTickDto {
            ts: chrono::Utc::now().to_rfc3339(),
            app_id: snap.app_name.clone(),
            app_name: snap.app_name.clone(),
            app_class: class.as_str().to_string(),
            title: if snap.title.is_empty() { None } else { Some(snap.title.clone()) },
            idle_secs: snap.idle_secs as i64,
            state: self.state.clone(),
            active_project_id: self.project_id.clone(),
            active_project_name: if self.project_name.is_empty() { None } else { Some(self.project_name.clone()) },
            cloud_health: self.health,
            seconds_since_claude_finished: since_stop.map(|x| x as i64),
            waiting_sessions,
            running_sessions,
            seconds_to_death,
        }
    }
```
Update both call sites:
```rust
            let _ = app.emit("drift-moment", self.build_tick(&snap, class, longest, waiting_count, running_count, seconds_to_death));
```
```rust
        let _ = app.emit("focus-tick", self.build_tick(&snap, class, longest, waiting_count, running_count, seconds_to_death));
```

- [ ] **Step 7: Add the pure `seconds_to_death` helper + test**

Add near `waiting_load` (after line 70):
```rust
/// Time until health reaches 0 at the current decay rate (minutes→seconds).
/// None when nothing is waiting (the meter holds, so there is no countdown).
pub fn seconds_to_death(health: f64, waiting_count: i64, decay_per_min: f64) -> Option<i64> {
    if waiting_count > 0 && decay_per_min > 0.0 {
        Some(((health / (decay_per_min * waiting_count as f64)) * 60.0).round() as i64)
    } else {
        None
    }
}
```
Add to `mod tests`:
```rust
    #[test]
    fn countdown_scales_with_waiting_count() {
        // full health, decay 0.06/min: 1 session ≈ 1000s (~16.7m), 4 ≈ 250s
        assert_eq!(seconds_to_death(1.0, 1, 0.06), Some(1000));
        assert_eq!(seconds_to_death(1.0, 4, 0.06), Some(250));
        assert_eq!(seconds_to_death(1.0, 0, 0.06), None);
    }
```

- [ ] **Step 8: Update events_tail to dispatch all four events**

In `src-tauri/src/events_tail.rs`, replace the `match ev.event.as_deref()` block (lines 71-75) with:
```rust
                        match ev.event.as_deref() {
                            Some("start") => rt.handle_start(&sid, &cwd),
                            Some("reengage") => rt.handle_reengage(&sid, &cwd),
                            Some("stop") => rt.handle_stop(&sid, &cwd),
                            Some("end") => rt.handle_end(&sid),
                            _ => {}
                        }
```

- [ ] **Step 9: Build + test**

Run: `cd /Users/bytedance/nubenube/src-tauri && cargo test drift -- --nocapture && cargo build`
Expected: PASS + compiles. (Existing `waiting_load` tests still pass — that fn is unchanged.)

- [ ] **Step 10: Commit**

```bash
cd /Users/bytedance/nubenube
git add src-tauri/src/drift.rs src-tauri/src/events_tail.rs src-tauri/src/dto.rs src-tauri/src/db.rs
git commit -m "feat(drift): per-session lifecycle (running/waiting) + countdown + counts"
```

---

## Phase 2 — Token-driven focus model (backend)

End state: health decays only on a distraction while a session waits; recovers from token consumption; holds otherwise. Classification is distraction-only exact match. `cargo test` covers the math. Frontend still builds (its `Sensitivity` type is cleaned in Phase 3; nothing reads `recoveryPerMin`).

### Task 2.1: `Sensitivity` gains `recovery_per_token`; grace default 10; drop work/neutral from model

**Files:**
- Modify: `src-tauri/src/settings.rs`

- [ ] **Step 1: Update `Sensitivity` struct + serde defaults**

Replace the `Sensitivity` struct (lines 8-16) with:
```rust
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Sensitivity {
    #[serde(default = "def_grace")]
    pub grace_secs: i64,
    #[serde(default = "def_decay")]
    pub decay_per_min: f64,
    /// Health recovered per token Claude consumes (input+output+cache_create).
    #[serde(default = "def_recovery_per_token")]
    pub recovery_per_token: f64,
    #[serde(default = "def_idle")]
    pub idle_threshold_secs: i64,
    #[serde(default = "def_granularity")]
    pub window_granularity: String,
}

fn def_grace() -> i64 { 10 }
fn def_decay() -> f64 { 0.06 }
fn def_recovery_per_token() -> f64 { 0.000004 }
fn def_idle() -> i64 { 120 }
fn def_granularity() -> String { "app".to_string() }
```

- [ ] **Step 2: Drop `work_apps`/`neutral_apps` from the `Settings` struct**

In `Settings` (lines 25-37) remove the `pub work_apps:` and `pub neutral_apps:` lines, keep `pub distraction_apps: Vec<String>,`.

- [ ] **Step 3: Update `Default for Settings`**

Replace the `work_apps`/`distraction_apps`/`neutral_apps` block (lines 46-58) with a single curated default distraction list (browsers excluded — those are research-friendly):
```rust
            distraction_apps: s(&[
                "TikTok", "Netflix", "Steam", "Discord", "Twitch", "Disney+", "Hulu",
            ]),
```
And in the `sensitivity: Sensitivity { ... }` block (lines 59-65) replace `recovery_per_min: 0.03,` and `grace_secs: 90,` with:
```rust
                grace_secs: 10,
                decay_per_min: 0.06,
                recovery_per_token: 0.000004,
                idle_threshold_secs: 120,
                window_granularity: "app".to_string(),
```

- [ ] **Step 4: Build**

Run: `cd /Users/bytedance/nubenube/src-tauri && cargo build`
Expected: FAIL — `watcher.rs` and `drift.rs` still reference `work_apps`/`recovery_per_min`. Fixed next.

### Task 2.2: Distraction-only exact-match classification + known-app discovery

**Files:**
- Modify: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Add `known_apps` table + helpers in `db.rs`**

In `migrate` (inside the `execute_batch` string, after the `biome_state` table, before the closing `"#`), add:
```sql
        CREATE TABLE IF NOT EXISTS known_apps (
            app_name   TEXT PRIMARY KEY,
            first_seen TEXT NOT NULL DEFAULT '',
            last_seen  TEXT NOT NULL DEFAULT ''
        );
```
Add these helpers near `project_token_total` (added in Phase 1):
```rust
/// Record a foreground app the watcher observed (auto-discovery backbone).
pub fn record_known_app(conn: &Connection, app_name: &str) {
    if app_name.is_empty() {
        return;
    }
    let now = chrono::Utc::now().to_rfc3339();
    let _ = conn.execute(
        "INSERT INTO known_apps(app_name,first_seen,last_seen) VALUES(?1,?2,?2)
         ON CONFLICT(app_name) DO UPDATE SET last_seen=?2",
        params![app_name, now],
    );
}

/// All discovered apps, most-recently-seen first.
pub fn get_known_apps(conn: &Connection) -> Vec<KnownApp> {
    let mut out = Vec::new();
    if let Ok(mut stmt) =
        conn.prepare("SELECT app_name, last_seen FROM known_apps ORDER BY last_seen DESC")
    {
        let rows = stmt
            .query_map([], |r| Ok(KnownApp { name: r.get(0)?, last_seen: r.get(1)? }))
            .into_iter()
            .flatten()
            .flatten();
        out.extend(rows);
    }
    out
}
```
(`KnownApp` DTO is added in Task 2.5 Step 1 — add it before building.)

- [ ] **Step 2: Rewrite `watcher.rs` classification (distraction-only, exact match)**

Replace the `AppClass` enum + `matches`/`classify` (lines 15-62) with:
```rust
#[derive(Clone, Copy, PartialEq)]
pub enum AppClass {
    Distraction,
    Neutral,
}

impl AppClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            AppClass::Distraction => "distraction",
            AppClass::Neutral => "neutral",
        }
    }
}

/// Distraction iff the active app's name exactly matches (case-insensitive) a
/// user-curated entry. Exact identity — never substring — so "X" can't match
/// "Xcode". Everything else is Neutral (research/editor/etc. never decays).
pub fn classify(app_name: &str, settings: &Settings) -> AppClass {
    let a = app_name.trim();
    if !a.is_empty() && settings.distraction_apps.iter().any(|d| d.trim().eq_ignore_ascii_case(a)) {
        AppClass::Distraction
    } else {
        AppClass::Neutral
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;

    #[test]
    fn exact_match_only_no_substring_false_positive() {
        let mut s = Settings::default();
        s.distraction_apps = vec!["X".into(), "Discord".into()];
        assert!(matches!(classify("Discord", &s), AppClass::Distraction));
        assert!(matches!(classify("X", &s), AppClass::Distraction));
        // the old substring bug: "X" must NOT match "Xcode"
        assert!(matches!(classify("Xcode", &s), AppClass::Neutral));
        assert!(matches!(classify("", &s), AppClass::Neutral));
    }
}
```

- [ ] **Step 3: Build (still fails on drift.rs — expected)**

Run: `cd /Users/bytedance/nubenube/src-tauri && cargo build`
Expected: FAIL — `drift.rs` still uses `AppClass::Work` + `recovery_per_min`. Fixed next.

### Task 2.3: Token-driven health math in `drift.rs`

**Files:**
- Modify: `src-tauri/src/drift.rs`

- [ ] **Step 1: Add the pure `apply_focus` helper + test**

Add after `seconds_to_death` (added in Phase 1):
```rust
/// The whole-life model in one place (pure → unit-testable).
/// Decay applies only while drifting (distraction + ≥1 waiting session);
/// recovery is token-driven and ~10× gentler; otherwise health holds.
pub fn apply_focus(
    health: f64,
    dt: f64,
    drifting: bool,
    waiting_count: i64,
    new_tokens: i64,
    decay_per_min: f64,
    recovery_per_token: f64,
) -> f64 {
    let mut h = health;
    if drifting && waiting_count > 0 {
        h -= decay_per_min * waiting_count as f64 * (dt / 60.0);
    }
    if new_tokens > 0 {
        h += recovery_per_token * new_tokens as f64;
    }
    h.clamp(0.0, 1.0)
}
```
Add to `mod tests`:
```rust
    #[test]
    fn holds_when_no_distraction_and_no_tokens() {
        // session waiting, but on a neutral app, no tokens → unchanged
        assert_eq!(apply_focus(0.5, 2.0, false, 1, 0, 0.06, 4e-6), 0.5);
    }
    #[test]
    fn decays_only_when_drifting() {
        let h = apply_focus(0.5, 60.0, true, 2, 0, 0.06, 4e-6); // 1 min, 2 waiting
        assert!((h - (0.5 - 0.12)).abs() < 1e-9);
    }
    #[test]
    fn recovers_from_tokens() {
        let h = apply_focus(0.5, 2.0, false, 0, 50_000, 0.06, 4e-6); // 50k tokens → +0.2
        assert!((h - 0.7).abs() < 1e-9);
    }
```

- [ ] **Step 2: Rewrite the `else { match class { ... } }` block in `tick`**

Replace the whole `else { match class { ... } }` block (lines 199-231) with:
```rust
        } else {
            // token-driven recovery (works whenever Claude is consuming for you)
            let mut new_tokens = 0i64;
            if let (Some(c), Some(pid)) = (&conn, self.project_id.clone()) {
                let cur = db::project_token_total(c, &pid);
                new_tokens = (cur - self.last_token_total).max(0);
                self.last_token_total = cur;
            }
            let drifting = matches!(class, AppClass::Distraction) && waiting_count > 0;

            self.health = apply_focus(
                self.health,
                dt,
                drifting,
                waiting_count,
                new_tokens,
                s.sensitivity.decay_per_min,
                s.sensitivity.recovery_per_token,
            );

            if drifting {
                self.state = "drifting".to_string();
                if let Some(c) = &conn {
                    for (key, kx) in &per_project {
                        let drift = dts * *kx;
                        let pid = if key == "_" { self.project_id.clone() } else { Some(key.clone()) };
                        if let Some(pid) = pid {
                            db::add_drift(c, &pid, &today, 0, drift, 0);
                        }
                    }
                    // per-app distraction time (Phase 5 reads this) — guarded so it
                    // is a no-op until the table exists.
                    db::add_drift_by_app(c, &today, &snap.app_name, dts);
                }
            } else if waiting_count > 0 {
                self.state = "waiting".to_string(); // session waiting, you're attending
            } else if new_tokens > 0 {
                self.state = "growing".to_string(); // Claude actively working for you
                if let (Some(c), Some(pid)) = (&conn, self.project_id.clone()) {
                    db::add_drift(c, &pid, &today, dts, 0, 0); // honest "active" secs
                }
            } else {
                self.state = "idle".to_string(); // nothing happening — hold
            }
        }
```
(`db::add_drift_by_app` is added in Phase 5 Task 5.1 — to keep Phase 2 compiling, add a minimal version now in `db.rs`; see Phase 5 Step 1. If executing strictly in order, add that helper now.)

- [ ] **Step 3: Build + test**

Run: `cd /Users/bytedance/nubenube/src-tauri && cargo test -- --nocapture && cargo build`
Expected: PASS (focus math, classify, countdown, installer) + compiles.

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/nubenube
git add src-tauri/src/settings.rs src-tauri/src/watcher.rs src-tauri/src/drift.rs src-tauri/src/db.rs
git commit -m "feat(drift): token-driven recovery + distraction-only decay model"
```

### Task 2.4: Record discovered apps each tick

**Files:**
- Modify: `src-tauri/src/drift.rs`

- [ ] **Step 1: Record the foreground app (on change)**

Add a field to `DriftRuntime`: after `last_token_total: i64,` add `last_app_name: String,` and initialize `last_app_name: String::new(),` in `new`.
In `tick`, right after `let snap = watcher::snapshot();` (line 155), add:
```rust
        if !snap.app_name.is_empty() && snap.app_name != self.last_app_name {
            self.last_app_name = snap.app_name.clone();
            if let Ok(c) = db::open(&self.db_path) {
                db::record_known_app(&c, &snap.app_name);
            }
        }
```

- [ ] **Step 2: Build + commit**

Run: `cd /Users/bytedance/nubenube/src-tauri && cargo build`
Expected: compiles.
```bash
cd /Users/bytedance/nubenube
git add src-tauri/src/drift.rs
git commit -m "feat(watcher): auto-discover foreground apps into known_apps"
```

### Task 2.5: `KnownApp` DTO + `get_known_apps`/`list_running_apps` commands

**Files:**
- Modify: `src-tauri/src/dto.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `KnownApp` to `dto.rs`**

Append:
```rust
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnownApp {
    pub name: String,
    pub last_seen: String,
}
```
And add `use crate::dto::KnownApp;` where db.rs needs it — `db.rs` already has `use crate::dto::*;` (line 20), so no change.

- [ ] **Step 2: Add commands in `commands.rs`**

Append:
```rust
#[tauri::command]
pub fn get_known_apps(state: State<AppState>) -> Vec<KnownApp> {
    db::open(&state.db_path).map(|c| db::get_known_apps(&c)).unwrap_or_default()
}

/// Best-effort list of currently-running GUI apps (to pre-populate the picker).
/// Auto-discovery (known_apps) is the primary source; this is a bonus.
#[tauri::command]
pub fn list_running_apps() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("osascript")
            .args(["-e", "tell application \"System Events\" to get name of (every process whose background only is false)"])
            .output();
        if let Ok(o) = out {
            let s = String::from_utf8_lossy(&o.stdout);
            let mut v: Vec<String> = s.split(", ").map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect();
            v.sort();
            v.dedup();
            return v;
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(o) = std::process::Command::new("wmctrl").arg("-lx").output() {
            let s = String::from_utf8_lossy(&o.stdout);
            let mut v: Vec<String> = s
                .lines()
                .filter_map(|l| l.split_whitespace().nth(2)) // WM_CLASS col
                .filter_map(|c| c.split('.').last())
                .map(|x| x.to_string())
                .collect();
            v.sort();
            v.dedup();
            return v;
        }
    }
    Vec::new()
}
```

- [ ] **Step 3: Register commands in `lib.rs`**

In the `tauri::generate_handler![...]` list, add (before the closing `]`):
```rust
            commands::get_known_apps,
            commands::list_running_apps,
```

- [ ] **Step 4: Build + commit**

Run: `cd /Users/bytedance/nubenube/src-tauri && cargo build`
Expected: compiles.
```bash
cd /Users/bytedance/nubenube
git add src-tauri/src/dto.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(api): get_known_apps + list_running_apps commands"
```

---

## Phase 3 — Frontend types + distraction-app picker

End state: `npm run build` passes with cleaned types; Settings lets the user tag any discovered/running app as a distraction.

### Task 3.1: Update shared types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Tighten `AppClass` + `FocusState`**

Change `AppClass` (line 11) to:
```ts
export type AppClass = 'distraction' | 'neutral'
```
Add `'waiting'` to `FocusState` (lines 13-19):
```ts
export type FocusState =
  | 'growing' // Claude actively working for you (tokens flowing)
  | 'waiting' // a session finished; you're attending (not distracted)
  | 'drifting' // on a distraction app while a session waits
  | 'idle' // away / nothing happening — health frozen
  | 'paused' // user enabled break/pause mode
  | 'unknown'
```

- [ ] **Step 2: `FocusTick` gains counts + countdown**

In `FocusTick` (lines 78-91), after `waitingSessions: number` add:
```ts
  runningSessions: number // # sessions currently running (Claude working)
  secondsToDeath?: number // health/decay countdown; absent when meter holds
```

- [ ] **Step 3: `Sensitivity` — replace `recoveryPerMin`**

In `Sensitivity` (lines 93-99), replace `recoveryPerMin` line with:
```ts
  recoveryPerToken: number // health regained per token consumed (0..1)
```

- [ ] **Step 4: Drop `workApps`/`neutralApps` from `Settings`**

In `Settings` (lines 103-113) remove the `workApps:` and `neutralApps:` lines (keep `distractionApps: string[]`).

- [ ] **Step 5: `Insights` gains the distraction breakdown**

In `Insights` (lines 66-76), before the closing `}` add:
```ts
  distractionBreakdown: { name: string; secs: number }[]
```

- [ ] **Step 6: Add a `KnownApp` type**

Append:
```ts
export type KnownApp = { name: string; lastSeen: string }
```

(Build is deferred to Task 3.3 once consumers are fixed.)

### Task 3.2: Fix mock data to match types

**Files:**
- Modify: `src/lib/mockData.ts`

- [ ] **Step 1: `mockSettings`**

Replace the `mockSettings` object (lines 209-225) with:
```ts
export const mockSettings: Settings = {
  distractionApps: ['TikTok', 'Netflix', 'Steam', 'Discord', 'Twitch'],
  sensitivity: {
    graceSecs: 10,
    decayPerMin: 0.06,
    recoveryPerToken: 0.000004,
    idleThresholdSecs: 120,
    windowGranularity: 'app',
  },
  resetTimeLocal: '05:00',
  pauseUntil: null,
  driftMomentIntensity: 'gentle-notification',
  waterRates: { ...DEFAULT_WATER_RATES },
  logRoots: ['/Users/bytedance/.claude/projects'],
}
```

- [ ] **Step 2: `mockFocusTick`**

Replace `mockFocusTick` (lines 238-251) with:
```ts
export const mockFocusTick: FocusTick = {
  ts: new Date().toISOString(),
  appId: 'com.microsoft.VSCode',
  appName: 'Code',
  appClass: 'neutral',
  title: 'lib.rs — nubenube',
  idleSecs: 4,
  state: 'growing',
  activeProjectId: 'proj_nubenube',
  activeProjectName: 'nubenube',
  cloudHealth: 0.82,
  secondsSinceClaudeFinished: 42,
  waitingSessions: 0,
  runningSessions: 1,
  secondsToDeath: undefined,
}
```

- [ ] **Step 3: `mockInsights` — add `distractionBreakdown`**

In the returned object of `mockInsights` (lines 192-202), before the closing `}` add:
```ts
    distractionBreakdown: [
      { name: 'YouTube', secs: 720 },
      { name: 'Reddit', secs: 360 },
      { name: 'TikTok', secs: 180 },
    ],
```

### Task 3.3: API wrappers + verify build

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Add `getKnownApps` + `listRunningApps`**

Add `KnownApp` to the type import (line 7-16) and add to the `api` object (after `resetToday`):
```ts
  getKnownApps: () => call<KnownApp[]>('get_known_apps', {}, () => []),
  listRunningApps: () => call<string[]>('list_running_apps', {}, () => []),
```

- [ ] **Step 2: Build (still fails — Settings.tsx uses neutralApps; fixed in 3.4)**

Run: `cd /Users/bytedance/nubenube && npm run build`
Expected: FAIL in `Settings.tsx` (references `neutralApps`). Fixed next.

### Task 3.4: Rewrite the distraction picker in Settings

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Imports + discovered/running apps state**

Replace the import block (lines 5-11) and add api/known-apps wiring. After `import { api } from '../lib/api'` add:
```ts
import type { KnownApp } from '../types'
```
Inside `Settings()`, after `const [busy, setBusy] = useState(false)` (line 45), add:
```ts
  const [known, setKnown] = useState<KnownApp[]>([])
  const [running, setRunning] = useState<string[]>([])
  const refreshApps = async () => {
    const [k, r] = await Promise.all([api.getKnownApps(), api.listRunningApps()])
    setKnown(k.data)
    setRunning(r.data)
  }
  useEffect(() => { void refreshApps() }, [])
```

- [ ] **Step 2: Build the app list from discovery + running + current distractions**

Replace the `distraction`/`neutral`/`apps`/`toggleApp`/`addApp` block (lines 53-72) with:
```ts
  const distraction = settings.distractionApps
  const distractSet = new Set(distraction.map((d) => d.toLowerCase()))
  const names = Array.from(
    new Set<string>([...distraction, ...known.map((k) => k.name), ...running])
  ).sort((a, b) => a.localeCompare(b))
  const apps = names.map((name) => ({ name, on: distractSet.has(name.toLowerCase()) }))

  const toggleApp = (name: string, on: boolean) => {
    if (on) {
      save({ distractionApps: distraction.filter((n) => n.toLowerCase() !== name.toLowerCase()) })
    } else {
      save({ distractionApps: [...distraction, name] })
    }
  }
  const addApp = () => {
    const n = adding.trim()
    if (!n || distractSet.has(n.toLowerCase())) return setAdding('')
    save({ distractionApps: [...distraction, n] })
    setAdding('')
  }
```

- [ ] **Step 3: Add a "scan apps" button to the distraction card header**

In the distraction `<Card>` header row (lines 111-114), replace the `<Pill ...>` with:
```tsx
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Pill hue={ACCENT} tone="soft" style={{ fontSize: 11 }}>{distraction.length} drain</Pill>
                <Btn hue={268} kind="soft" size="sm" onClick={() => void refreshApps()}>↻ scan apps</Btn>
              </div>
```
And update the helper line (line 115) to:
```tsx
            <div style={{ fontWeight: 600, fontSize: 12, color: SUB, marginBottom: 4 }}>tag the apps that pull you away. while Claude waits, only these drain Nube — research &amp; editors never do.</div>
```

- [ ] **Step 4: Build**

Run: `cd /Users/bytedance/nubenube && npm run build`
Expected: PASS (Phase-4 will remove the rescue card; for now it still compiles since `prefs.takeover*` still exist).

- [ ] **Step 5: Commit**

```bash
cd /Users/bytedance/nubenube
git add src/types.ts src/lib/mockData.ts src/lib/api.ts src/pages/Settings.tsx
git commit -m "feat(settings): curate distractions from discovered + running apps"
```

---

## Phase 4 — Overlay indicator + window behavior; remove takeover

End state: companion is always visible, floats across Spaces/window-switches, is draggable, and shows running/waiting counts + countdown with the on-finish pulse/warning. Full-screen takeover is gone. Main window moves via its existing drag region. `npm run build` + `cargo build` pass.

### Task 4.1: Companion window — visible, all-workspaces, no reposition-on-show

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Build the companion visible + on all workspaces; remove the takeover window**

Replace the companion builder (lines 107-116) with:
```rust
            // Always-on-top desktop companion = the live indicator (floats across
            // Spaces and window switches).
            if let Ok(w) = WebviewWindowBuilder::new(app.handle(), "companion", WebviewUrl::App("index.html#/companion".into()))
                .title("Nube")
                .inner_size(184.0, 170.0)
                .resizable(false)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .visible_on_all_workspaces(true)
                .skip_taskbar(true)
                .visible(true)
                .build()
            {
                commands::position_companion(&w);
            }
```
Delete the entire `takeover` window builder block (lines 119-128).

- [ ] **Step 2: Remove takeover commands + don't reposition companion on show**

In `commands.rs`: make `position_companion` `pub` (change `fn position_companion` → `pub fn position_companion`). Replace `nube_set_companion` (lines 156-166) so it no longer repositions on every show (which would fight the user's drag):
```rust
#[tauri::command]
pub fn nube_set_companion(app: AppHandle, visible: bool) {
    if let Some(w) = app.get_webview_window("companion") {
        if visible {
            let _ = w.set_always_on_top(true);
            let _ = w.set_visible_on_all_workspaces(true);
            let _ = w.show();
        } else {
            let _ = w.hide();
        }
    }
}
```
Delete `nube_show_takeover` (lines 168-186) and `nube_hide_takeover` (lines 188-193).

- [ ] **Step 3: Drop takeover commands from the handler list in `lib.rs`**

In `generate_handler![...]`, remove the `commands::nube_show_takeover,` and `commands::nube_hide_takeover,` lines.

- [ ] **Step 4: Build**

Run: `cd /Users/bytedance/nubenube/src-tauri && cargo build`
Expected: compiles.

- [ ] **Step 5: Commit**

```bash
cd /Users/bytedance/nubenube
git add src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "feat(overlay): persistent all-workspaces companion; remove takeover window"
```

### Task 4.2: Remove takeover from the frontend

**Files:**
- Modify: `src/lib/rescue.ts`
- Modify: `src/store/prefs.ts`
- Modify: `src/store/demo.ts`
- Modify: `src/App.tsx`
- Delete: `src/components/Takeover.tsx`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: `rescue.ts` — drop takeover wrappers**

Remove the `showTakeover`/`hideTakeover` lines from the `rescue` object (lines 19-20). Keep `setCompanion`, `openMain`, `setPaused`, and the `RescueAction`/`emitRescue`/`onRescue` exports (still used? — `onRescue` is only used by AppShell's removed supervisor; once AppShell no longer imports it this is dead but harmless. Leave it.)

- [ ] **Step 2: `prefs.ts` — drop takeover flags**

Remove `takeoverFinish`, `takeover2`, `takeover5` from the `Prefs` type (lines 9-11) and from `DEFAULTS` (lines 18-20).

- [ ] **Step 3: `demo.ts` — drop takeover**

Remove `TakeoverLevel` export (line 9), the `takeover` field + `setTakeover` from `DemoStore` (lines 13-17) and the store impl (lines 23, 26).

- [ ] **Step 4: `App.tsx` — remove the takeover route**

Remove the `import { TakeoverWindow } from './components/Takeover'` line (line 4) and the `<Route path="takeover" element={<TakeoverWindow />} />` line (line 16).

- [ ] **Step 5: Delete the Takeover component**

Run: `rm /Users/bytedance/nubenube/src/components/Takeover.tsx`

- [ ] **Step 6: `AppShell.tsx` — remove the supervisor, in-app overlay, rescue demo row**

- Remove imports: `TakeoverView` (line 15), `useDemo`'s `TakeoverLevel` type (line 11 → keep `useDemo`, drop the type), `onRescue` (line 18), `playChime` may stay (used by demo? it's used in removed code — remove if unused).
- Remove `const RANK` (line 22) and `REMIND_MIN` (line 23).
- Remove the three refs `shownLevel`/`snoozedLevel`/`snoozeUntil` (lines 64-66).
- Remove the `onRescue` effect (lines 80-91) and the supervisor effect (lines 95-120).
- Remove the in-app takeover overlay JSX block (lines 173-176).
- In the demo dock, remove the "rescue" label + row (lines 185-189) and the trailing separator (line 190) that referenced it; keep the phase buttons and the "↻ intro" button.

Concretely, the demo dock inner content becomes:
```tsx
          <span style={{ fontWeight: 700, fontSize: 9.5, color: 'rgba(255,255,255,.5)', letterSpacing: '.08em', textTransform: 'uppercase' }}>demo</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {DEMO_PHASES.map((p) => <DockBtn key={p} on={demo.phase === p} onClick={() => demo.setPhase(demo.phase === p ? null : p)}>{p}</DockBtn>)}
          </div>
          <span style={{ width: 1, height: 19, background: 'rgba(255,255,255,.18)' }} />
          <DockBtn on={false} onClick={() => demo.replayIntro()}>↻ intro</DockBtn>
```

- [ ] **Step 7: `Settings.tsx` — remove the "full-screen rescues" card + `toggleRescue`**

- Remove the `toggleRescue` function (lines 81-86).
- Remove the entire "full-screen rescues" `<Card>` (lines 162-171).
- `prefs` is still used for `sound`/`companion`; keep the import.

- [ ] **Step 8: Build**

Run: `cd /Users/bytedance/nubenube && npm run build`
Expected: PASS. (If `playChime`/`onRescue`/`emitRescue` become unused imports, remove them to satisfy `tsc`'s `noUnusedLocals` if enabled — check the error output and delete offending imports.)

- [ ] **Step 9: Commit**

```bash
cd /Users/bytedance/nubenube
git add -A
git commit -m "refactor: remove full-screen takeover across frontend"
```

### Task 4.3: Companion = draggable indicator with counts + countdown

**Files:**
- Modify: `src/lib/derive.ts`
- Modify: `src/components/Companion.tsx`

- [ ] **Step 1: `derive.ts` — map `state==='waiting'`**

In `phaseFromTick` (lines 81-104), replace the `switch` with:
```ts
  switch (t.state) {
    case 'drifting':
      if (ss != null && ss >= 300) return 'fading'
      if (ss != null && ss >= 120) return 'critical'
      return 'draining'
    case 'waiting':
      return 'waiting'
    case 'paused':
    case 'idle':
      return 'idle'
    case 'growing':
      return 'working'
    default:
      return 'idle'
  }
```
(`distracted` local is now unused — remove the `const distracted = ...` line 85 to satisfy tsc.)

- [ ] **Step 2: Rewrite `Companion.tsx` — drag handle, counts, countdown, on-finish pulse**

Replace the file body with:
```tsx
// Companion — the always-on-top desktop indicator (its own transparent window).
// Shows live Claude session counts + a countdown to "death". Drag it by the
// top handle; a clean click opens the main window.

import { useEffect, useRef, type MouseEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useFocus } from '../store/focus'
import { useUsage } from '../store/usage'
import { NubeCreature } from './NubeCreature'
import { Dot, INK, SUB } from './ui'
import { PHASE_META, phaseFromTick, mmss, type Phase } from '../lib/derive'
import { isTauri } from '../lib/api'
import { rescue } from '../lib/rescue'

const TEXT: Record<Phase, string> = { working: 'thriving', idle: 'napping', waiting: 'Claude finished working', draining: 'come back', critical: 'gasping!', fading: 'fading…', faint: 'fainted' }

export function Companion() {
  const tick = useFocus((s) => s.tick)
  const subscribe = useFocus((s) => s.subscribe)
  const projects = useUsage((s) => s.projects)
  const loadAll = useUsage((s) => s.loadAll)
  const dragging = useRef(false)

  useEffect(() => {
    document.documentElement.classList.add('nn-transparent')
    void subscribe()
    void loadAll()
    return () => document.documentElement.classList.remove('nn-transparent')
  }, [subscribe, loadAll])

  const paused = tick.state === 'paused'
  const phase = phaseFromTick(tick)
  const meta = PHASE_META[phase]
  const project = projects.find((p) => p.id === tick.activeProjectId)
  const hue = project?.colorHue ?? 268
  const waiting = tick.waitingSessions ?? 0
  const running = tick.runningSessions ?? 0
  const urgent = !paused && (phase === 'waiting' || phase === 'draining' || phase === 'critical' || phase === 'fading')
  const countdown = tick.secondsToDeath ?? null

  const open = () => { if (!dragging.current && isTauri) void invoke('nube_open_main').catch(() => {}) }
  const startDrag = (e: MouseEvent) => {
    e.stopPropagation()
    dragging.current = true
    if (isTauri) void getCurrentWindow().startDragging().catch(() => {})
    // reset the drag guard shortly after so a later click opens the app
    setTimeout(() => { dragging.current = false }, 150)
  }
  const togglePause = (e: MouseEvent) => { e.stopPropagation(); void rescue.setPaused(!paused) }

  return (
    <div className="nn-ui" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'transparent' }}>
      <div
        onClick={open}
        role="button"
        tabIndex={0}
        aria-label="open NubeNube"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}
        title="drag the handle to move · click to open"
        style={{
          width: 160, borderRadius: 22, padding: '8px 12px 11px', cursor: 'pointer',
          background: 'rgba(255,255,255,.84)', backdropFilter: 'blur(14px)',
          boxShadow: urgent ? '0 18px 40px -14px rgba(210,100,60,.6), 0 0 0 2px rgba(236,122,74,.55)' : '0 18px 40px -16px rgba(90,70,150,.55), 0 0 0 1px rgba(255,255,255,.6)',
          border: '1px solid rgba(255,255,255,.7)',
          filter: paused ? 'saturate(.7)' : 'none',
          animation: urgent && phase === 'waiting' ? 'nn-pulse 1.1s ease-in-out 3' : 'none',
        }}
      >
        {/* drag handle */}
        <div onMouseDown={startDrag} title="drag to move" style={{ display: 'flex', justifyContent: 'center', gap: 3, padding: '2px 0 4px', cursor: 'grab' }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 5, height: 5, borderRadius: 99, background: 'rgba(120,100,170,.34)' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', height: 80, alignItems: 'center' }}>
          <NubeCreature mood={paused ? 'content' : meta.mood} hue={hue} size={92} scale={1} />
        </div>
        {paused ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span className="nn-disp" style={{ fontWeight: 700, fontSize: 13, color: SUB }}>paused · resting</span>
            <button onClick={togglePause} aria-label="resume drift tracking" style={{ border: 'none', cursor: 'pointer', borderRadius: 99, padding: '5px 14px', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 11.5, background: 'linear-gradient(165deg, hsl(158 50% 60%), hsl(158 55% 50%))', color: '#fff' }}>▶ resume</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 2 }}>
              <Dot color={meta.dot} pulse={urgent} size={7} />
              <span className="nn-disp" style={{ fontWeight: 700, fontSize: urgent ? 11.5 : 13, color: urgent ? 'var(--danger)' : INK }}>{TEXT[phase]}</span>
              <button onClick={togglePause} aria-label="pause drift tracking" title="pause (lunch / meeting)" style={{ border: 'none', cursor: 'pointer', borderRadius: 99, padding: '3px 8px', marginLeft: 2, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 11, background: 'rgba(120,100,170,.12)', color: SUB }}>⏸</button>
            </div>
            {/* session counts */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 5, fontWeight: 700, fontSize: 11, color: SUB }}>
              <span title="running">▶ {running} working</span>
              <span title="waiting" style={{ color: waiting > 0 ? 'var(--danger)' : SUB }}>⏸ {waiting} waiting</span>
            </div>
            {/* countdown to death (only when a session waits) */}
            {waiting > 0 && countdown != null && (
              <div style={{ textAlign: 'center', marginTop: 4, fontWeight: 800, fontSize: 12, color: 'var(--danger)' }} title="time until Nube dies if you stay on a distraction">
                ⏳ {mmss(countdown)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add the `nn-pulse` keyframe**

Append to `src/theme/tokens.css` (or whichever global CSS the windows load — confirm by checking `main.tsx` imports; default `src/theme/tokens.css`):
```css
@keyframes nn-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
```

- [ ] **Step 4: Build**

Run: `cd /Users/bytedance/nubenube && npm run build`
Expected: PASS.

- [ ] **Step 5: Manual verification (Tauri)**

Run: `cd /Users/bytedance/nubenube && npm run tauri dev`
Confirm: (a) buddy is visible on launch and stays on top when you switch to other apps and across Spaces; (b) dragging the top "···" handle moves it and it stays where dropped; (c) a clean click opens the main window; (d) when a Claude session finishes (Stop), the buddy pulses, turns warning color, shows "Claude finished working", counts update, and a countdown appears; switching to a tagged distraction makes the countdown actually tick down.

- [ ] **Step 6: Commit**

```bash
cd /Users/bytedance/nubenube
git add -A
git commit -m "feat(overlay): buddy indicator — drag, session counts, countdown, finish pulse"
```

### Task 4.4: Verify main-window move/resize

**Files:**
- Inspect: `src-tauri/tauri.conf.json` (no change expected)
- Inspect: `src/components/AppShell.tsx:136` (drag region already present)

- [ ] **Step 1: Confirm resizable + drag region**

`tauri.conf.json` already has `"resizable": true`. `AppShell.tsx:136` already has `data-tauri-drag-region` on the 42px titlebar. Verify in `npm run tauri dev`: drag the top bar to move the window; drag any edge/corner to resize (min 920×640).

- [ ] **Step 2: If move fails on the drag bar**, ensure no descendant sets `pointer-events` over the whole bar; the centered title already has `pointerEvents:'none'`. (No code change unless the manual test fails — if it does, add `data-tauri-drag-region` to the body container `div` at line 134 as well.)

- [ ] **Step 3: Commit (only if a change was needed)**

```bash
cd /Users/bytedance/nubenube
git add -A
git commit -m "fix(window): ensure main window is movable + resizable"
```

---

## Phase 5 — Insights: distraction time + transparent calculation

End state: Insights shows per-app distraction time and honest labels tied to the new model. `npm run build` + `cargo test`/`build` pass.

> Scope note: the spec's "meter why-trail" is implemented here as the **per-app distraction breakdown** (the concrete "time lost") plus honest focus/drift labels derived from the new accounting. A full append-only `meter_events` log is deferred as a future enhancement; the breakdown already makes the calculation legible.

### Task 5.1: `drift_by_app` table + breakdown query

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Create the table**

In `migrate`, add after `known_apps`:
```sql
        CREATE TABLE IF NOT EXISTS drift_by_app (
            local_day TEXT NOT NULL,
            app_name  TEXT NOT NULL,
            secs      INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (local_day, app_name)
        );
```

- [ ] **Step 2: Add `add_drift_by_app` + `drift_app_breakdown`**

```rust
pub fn add_drift_by_app(conn: &Connection, day: &str, app_name: &str, secs: i64) {
    if app_name.is_empty() || secs <= 0 {
        return;
    }
    let _ = conn.execute(
        "INSERT INTO drift_by_app(local_day,app_name,secs) VALUES(?1,?2,?3)
         ON CONFLICT(local_day,app_name) DO UPDATE SET secs = secs + ?3",
        params![day, app_name, secs],
    );
}

/// First local_day to include for an insights range ("" = no lower bound).
fn range_start_day(range: &str) -> String {
    match range {
        "today" => today_str(),
        "week" => (Local::now() - Duration::days(6)).format("%Y-%m-%d").to_string(),
        "month" => Local::now().format("%Y-%m-01").to_string(),
        _ => String::new(),
    }
}

/// Per-app distracted seconds within a range, biggest first.
pub fn drift_app_breakdown(conn: &Connection, range: &str) -> Vec<(String, i64)> {
    let start = range_start_day(range);
    let mut out = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT app_name, SUM(secs) FROM drift_by_app WHERE local_day >= ?1 GROUP BY app_name ORDER BY 2 DESC",
    ) {
        let rows = stmt
            .query_map([&start], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .into_iter()
            .flatten()
            .flatten();
        out.extend(rows);
    }
    out
}
```
(`Duration` and `Local` are already imported at the top of db.rs.)

- [ ] **Step 3: Build**

Run: `cd /Users/bytedance/nubenube/src-tauri && cargo build`
Expected: compiles. (`drift.rs` already calls `add_drift_by_app` from Phase 2 Task 2.3.)

### Task 5.2: Surface the breakdown in `get_insights`

**Files:**
- Modify: `src-tauri/src/dto.rs`
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Extend `Insights` DTO**

In `dto.rs` `Insights` (lines 75-87), before the closing `}` add:
```rust
    pub distraction_breakdown: Vec<DistractionSlice>,
```
And add the slice struct:
```rust
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DistractionSlice {
    pub name: String,
    pub secs: i64,
}
```

- [ ] **Step 2: Populate it in `get_insights`**

In `db.rs` `get_insights`, replace the final `Insights { ... }` return (lines 587-597) with this block, which computes the breakdown and honest focus/drift totals (so the stat cards aren't hard-zeros), then returns:
```rust
    let distraction_breakdown = drift_app_breakdown(conn, range)
        .into_iter()
        .map(|(name, secs)| DistractionSlice { name, secs })
        .collect();

    // honest range-scoped focus/drift from drift_daily (range_start_day added in 5.1)
    let start = range_start_day(range);
    let (active_total, drift_total) = conn
        .query_row(
            "SELECT COALESCE(SUM(claude_active_secs),0), COALESCE(SUM(drift_secs),0)
             FROM drift_daily WHERE local_day >= ?1",
            [&start],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        )
        .unwrap_or((0, 0));

    Insights {
        range: range.to_string(),
        water_ml: total_water,
        tokens,
        by_day,
        by_hour,
        top_projects: tops,
        claude_active_secs: active_total,
        drift_secs: drift_total,
        longest_focus_streak_secs: 0,
        distraction_breakdown,
    }
```
Note: `range_start_day` is `fn` (not `pub`) and lives in db.rs (added in Task 5.1), so it's in scope here.

- [ ] **Step 3: Build + commit**

Run: `cd /Users/bytedance/nubenube/src-tauri && cargo test -- --nocapture && cargo build`
Expected: PASS + compiles.
```bash
cd /Users/bytedance/nubenube
git add src-tauri/src/db.rs src-tauri/src/dto.rs
git commit -m "feat(insights): per-app distraction breakdown + honest focus/drift totals"
```

### Task 5.3: Insights UI — distraction breakdown + honest labels

**Files:**
- Modify: `src/pages/Insights.tsx`

- [ ] **Step 1: Read the breakdown**

After `const driftSecs = insights?.driftSecs ?? 0` (line 49) add:
```ts
  const breakdown = insights?.distractionBreakdown ?? []
```

- [ ] **Step 2: Add a "time lost to distractions" card**

After the "honest stat cards" row (closes at line 93), insert:
```tsx
        {/* time lost to distractions (per app, range-scoped) */}
        <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 18, border: elev.border, boxShadow: shadow.md, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: SUB, letterSpacing: '.02em' }}>TIME LOST TO DISTRACTIONS · this {range}</div>
            <span className="nn-num" style={{ fontWeight: 800, fontSize: 14, color: 'var(--danger)' }}>{formatDuration(driftSecs)}</span>
          </div>
          <div style={{ fontWeight: 600, fontSize: 11.5, color: FAINT, marginBottom: 10 }}>only counts time on apps you tagged as distractions while Claude was waiting</div>
          {breakdown.length === 0 ? (
            <div style={{ fontWeight: 600, fontSize: 12.5, color: FAINT, padding: '6px 0' }}>no drift yet — nice 💚</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {breakdown.map((b, i) => {
                const max = breakdown[0]?.secs || 1
                return (
                  <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 2px', borderTop: i === 0 ? 'none' : '1px solid rgba(120,100,170,.1)' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: INK, width: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 99, background: 'rgba(120,100,170,.12)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.max(4, (b.secs / max) * 100)}%`, background: 'linear-gradient(90deg, hsl(28 80% 62%), hsl(8 78% 60%))' }} />
                    </div>
                    <span className="nn-num" style={{ fontWeight: 800, fontSize: 12.5, color: 'var(--danger)', width: 64, textAlign: 'right' }}>{formatDuration(b.secs)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
```

- [ ] **Step 3: Fix the honest stat-card labels**

Update the three `StatCard`s (lines 90-92) so the labels reflect the new model:
```tsx
          <StatCard label="time Claude worked" value={formatDuration(focusSecs)} sub={`tokens flowing · this ${range}`} color="#2f8a76" />
          <StatCard label="time drifted" value={formatDuration(driftSecs)} sub="distraction while Claude waited" color="var(--danger)" />
          <StatCard label="longest focus" value={formatDuration(streak)} sub="best unbroken stretch" color="#6a4aa8" />
```

- [ ] **Step 4: Build**

Run: `cd /Users/bytedance/nubenube && npm run build`
Expected: PASS.

- [ ] **Step 5: Manual verification**

`npm run tauri dev` → drift on a tagged distraction while a session waits for ~30s, then open Insights → the app appears under "time lost to distractions" with its duration; "time drifted" is non-zero; "time Claude worked" reflects token activity.

- [ ] **Step 6: Commit**

```bash
cd /Users/bytedance/nubenube
git add src/pages/Insights.tsx
git commit -m "feat(insights): show per-app distraction time + honest labels"
```

---

## Final verification

- [ ] `cd /Users/bytedance/nubenube/src-tauri && cargo test` — all Rust tests pass.
- [ ] `cd /Users/bytedance/nubenube/src-tauri && cargo build` — compiles.
- [ ] `cd /Users/bytedance/nubenube && npm run build` — `tsc -b && vite build` succeed.
- [ ] `npm run tauri dev` end-to-end: hooks self-heal (check `~/.claude/settings.json` shows nube entries in all 4 events after launch); start a Claude session and watch counts; meter holds when idle/researching, decays only on a tagged distraction while waiting, recovers as tokens flow; buddy drags + floats across Spaces; Insights shows distraction breakdown.

---

## Self-review notes (author)

- **Spec coverage:** §1 hook → Tasks 1.1–1.2; §3 session lifecycle → 1.3–1.4; §2 focus model → 2.1–2.3; §4 distraction curation → 2.2, 2.4–2.5, 3.x; §5 overlay/window → 4.x; §7 main window → 4.4; §8 insights/transparency → 5.x (with the documented scope note on `meter_events`).
- **Type consistency:** `running_sessions`/`seconds_to_death` (Rust) ↔ `runningSessions`/`secondsToDeath` (TS); `recovery_per_token`/`recoveryPerToken`; `distraction_breakdown`/`distractionBreakdown`; `KnownApp{name,lastSeen}`; `AppClass` reduced to `distraction|neutral` in both. `state` adds `'waiting'`.
- **Ordering for buildability:** Rust DTO field additions (Phase 1) are filled in the same phase; frontend type removals (Phase 3) are paired with their consumers (mockData, Settings) before the build step; takeover removal (Phase 4) deletes route+component+store fields together.
- **Cross-phase helper dependency:** `db::project_token_total` (Phase 1) and `db::add_drift_by_app` (Phase 5) are referenced by `drift.rs` in Phases 1–2; the plan instructs adding those helpers when first needed so each phase compiles independently.
