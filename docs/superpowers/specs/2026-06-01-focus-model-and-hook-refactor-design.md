# NubeNube — Hook, Focus Model & Overlay Refactor

**Date:** 2026-06-01
**Status:** Design — awaiting user review
**Scope:** One implementation cycle (hook installer, drift/focus engine, watcher classification, overlay/companion window, insights, settings UI).

---

## 1. Problem statement (user-reported, root-caused)

| # | Symptom | Root cause (verified in code) |
|---|---|---|
| 1 | "The hook does not work properly." | `~/.claude/settings.json` has `"Stop": []` / `"UserPromptSubmit": []` — empty arrays. The installer's entries are gone, so Claude Code invokes nothing. `events.jsonl` only holds the two install-time test events. |
| 2 | "Why is the meter rising even when I didn't work on Claude?" | `drift.rs:201-206` raises `health` by `recovery_per_min` whenever the active app is any "work app" (terminal/editor), independent of Claude. It also logs that as `claude_active_secs`, so "Claude focus" in Insights is really "time in an IDE." |
| 3 | "What counts as distraction doesn't even work." | `watcher::classify` (`watcher.rs:50-62`) substring-matches `app_name` against a list of **website** names (`YouTube`, `Reddit`, `Twitter`). macOS reports the **browser** app name (`Safari`/`Chrome`), which is in the *neutral* list — so browser distraction never registers. The entry `"X"` → `"x"` substring-matches `Xcode`/`Excel`, flagging real work as distraction. |
| 4 | "Include time I spent on distractions in insights." | `drift_daily` only stores `claude_active_secs`/`drift_secs`/`idle_secs` with no per-app attribution, and `claude_active_secs` is mis-measured (see #2). |
| 5 | Full-screen takeover instead of a status indicator; buddy can't be moved; buddy disappears when switching windows. | `takeover` window is sized to the full monitor on show (`commands.rs:169-186`). Companion has no drag handler and is built `visible:false`, shown only in some phases. |
| 6 | "The calculation is not transparent." | No record of *why* health changed; the model conflates "in an editor" with "working with Claude." |
| 7 | "I should be able to resize and move the window as I want." | Main window is `resizable:true` but `titleBarStyle:"Overlay"` + `hiddenTitle` leaves only a thin native strip to drag; app shell has no `data-tauri-drag-region`. |

---

## 2. Confirmed design decisions

- **Meter is fully session-attended.** Every change traces to a Claude session.
- **(a) Recovery is token-driven**, proportional to tokens Claude consumes for the user, **calibrated 10× gentler than drift decay**.
- **(b) Grace = 10 seconds** before decay begins; countdown is shown immediately on finish.
- **(c) Single tag — Distraction.** Only user-tagged distraction apps cause decay while a session waits; everything else (research, editor, neutral apps, idle) holds.
- **App list is user-curated** via auto-discovery + a per-OS "scan running apps" refresh.
- **Buddy IS the indicator.** Draggable, always-on-top across Spaces, always visible. On Stop: pulse → warning color → "Claude finished working" → countdown. Full-screen takeover removed.
- **Session lifecycle via 4 hooks:** `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd`.

### The focus model (canonical)

Per active project, on each ~2s tick (`dt` seconds):

```
k        = # sessions waiting past the 10s grace (non-abandoned)
drifting = (k > 0) AND (active app ∈ distraction set) AND (not idle) AND (not paused)
dTok     = tokens consumed for the active project since last tick (from connector)

if drifting:           health -= decay_per_min * k * (dt/60)        # countdown active
health += recovery_per_token * dTok                                  # token-driven recovery
health  = clamp(health, 0, 1)
```

- **Recovery only happens when tokens flow** = Claude is actively working = a running session. No tokens → no rise. This is what makes "the meter rises because of Claude" literally true and fixes complaint #2.
- **Decay only happens on a tagged distraction while a session waits.** Research/editor/neutral/idle all hold (complaint #3, decision c).
- **10× calibration:** `recovery_per_token` is set so that, at a representative consumption rate, recovery accrues at `decay_per_min / 10`. Default constant chosen so a substantial work burst (~100k tokens) restores ≈0.30 health; exact value lives in `Sensitivity` and is tunable. *(See §9 open item — confirm the constant during implementation against real token volumes.)*

### Countdown ("time to death")

```
time_to_death = health / (decay_per_min * max(k,1))   # minutes
```

- Shown the instant a session enters `waiting` (Stop). With defaults (`decay_per_min=0.06`): 1 waiting session from full ≈ **16 min**; 4 waiting ≈ **4 min** — visibly faster with more neglected sessions.
- **Decrements in real time only while `drifting`.** When you're not on a distraction the buddy shows a calm "waiting" state and the countdown is paused (it only *threatens* when you're genuinely distracted). Token recovery extends it.

---

## 3. Hook installer (`hooks_installer.rs`, `events_tail.rs`)

**Register 4 events**, all invoking `nube-hook.sh <event>`:

| Claude Code hook | Arg passed | Meaning |
|---|---|---|
| `SessionStart` | `start` | session exists (idle, not yet prompted) |
| `UserPromptSubmit` | `reengage` | session is **running** (Claude working) |
| `Stop` | `stop` | session is **waiting** (finished, needs user) |
| `SessionEnd` | `end` | session removed |

- **Idempotent + self-healing:** on every app launch, `ensure_installed()` checks each of the 4 hook arrays for an entry whose `command` contains `nube-hook.sh`; if missing (including the empty-array regression), re-inject. Never duplicate.
- **Non-destructive merge** preserved: keep the user's existing `Notification`/`terminal-notifier` hook; one-time `.bak` backup retained.
- **Hook script** keeps emitting `{event, ts, cwd, sessionId}` to `~/.claude/hooks/nube/events.jsonl`; only the event-name arg set grows. No new dependencies (`jq` already present; keep the no-`jq` fallback).
- `events_tail.rs` `Ev` handling extends to `start` / `end`.

---

## 4. Session tracking (`drift.rs`)

Replace the `Waiting` map with a `Session` map keyed by `sessionId`:

```rust
struct Session {
    project_id: Option<String>,
    phase: SessionPhase,          // Idle | Running | Waiting
    since: Instant,               // when it entered current phase (drives countdown/grace)
    notified: bool,
}
enum SessionPhase { Idle, Running, Waiting }
```

Transitions: `start`→Idle, `reengage`→Running, `stop`→Waiting (reset `since`), `end`→remove. Abandon backstop (30 min in Waiting) unchanged. Idle/paused **freezes** each waiting session's `since` (existing behavior, kept).

Tick emits counts in `FocusTickDto`: `running`, `waiting`, plus per-project `waiting`. `waiting_load` stays (pure, unit-tested) but now reads from `Session`s in `Waiting` phase.

---

## 5. Distraction classification (`watcher.rs`, `settings.rs`, new `known_apps`)

- **Drop** `work_apps` / `distraction_apps` / `neutral_apps` substring lists. Replace with a single user-curated **distraction set**, matched by **exact app identity** (macOS bundle id when available, else exact app name — case-insensitive, no substring) — kills the `"X"`→`Xcode` bug.
- **`classify`** returns `Distraction` iff the active app's identity ∈ distraction set; otherwise `Neutral`. (No `Work` class needed; "work" no longer drives the meter — tokens do.)
- **Auto-discovery backbone:** the watcher records every distinct foreground app it sees into a `known_apps` table `(app_id, app_name, first_seen, last_seen, tag)` with `tag` defaulting to `neutral`. Works identically on macOS and Linux, no permissions.
- **"Scan running apps" refresh** (Tauri command `list_running_apps`) to pre-populate before an app has been seen foreground:
  - **macOS:** `NSWorkspace.runningApplications`, filtered to `.regular` activation policy → `localizedName` + `bundleIdentifier`. No permission. Fallback: `osascript` → System Events `processes where background only is false`.
  - **Linux:** `wmctrl -lx` (X11) or `/proc/*/comm` + `.desktop` lookup; best-effort. Auto-discovery covers gaps on Wayland.
- **Settings UI** (`Settings.tsx`): a searchable list of known + running apps, each with a Distraction toggle. Persisted to `settings.json` (`distraction_app_ids: Vec<String>`) and `known_apps`.

---

## 6. Overlay / companion (`Companion.tsx`, `lib.rs`, `commands.rs`)

- **Always visible** (built `visible:true`; hidden only when paused or when the user hides it). This fixes "disappears when I switch windows."
- **Overlays everywhere:** `always_on_top(true)` + `set_visible_on_all_workspaces(true)` + raised window level so it floats above other apps and Spaces.
- **Draggable:** the top "···" handle calls `getCurrentWindow().startDragging()` on pointer-down; a clean click (no drag past a few px) still triggers `nube_open_main`. Position persisted so it reopens where you left it.
- **Indicator content:**
  - Calm/idle: the Nube + `▶ {running} working` (or napping if none).
  - On **Stop** → immediate **pulse**, badge → **warning color**, label **"Claude finished working"**, countdown ring appears.
  - Waiting: `⏸ {waiting} waiting` + **countdown** (`mm:ss` to death). Escalates visually (shake/dim) as `time_to_death` shrinks — no full-screen alarm.
  - Multiple: `▶ 3 working · ⏸ 2 waiting`.
- **Remove** the `takeover` window and `AppShell.tsx` takeover trigger logic, `Takeover.tsx`, and `nube_show_takeover`. Keep the gentle `drift-moment` notification (now gated on real drift).

---

## 7. Main window move/resize (`tauri.conf.json`, app shell)

- Keep `resizable:true`; verify resize from all edges (min 920×640 retained).
- Add a `data-tauri-drag-region` to the app's top header bar so the whole top strip moves the window (works with `titleBarStyle:"Overlay"`). Ensure interactive header controls `stopPropagation` so buttons still click.

---

## 8. Insights & transparency (`db.rs`, `commands.rs`, `Insights.tsx`)

**New accounting in the tick**, all session-attributable:

- `drift_daily` columns become: `waiting_secs` (≥1 session waiting), `drift_secs` (distracted while waiting), `attending_token_secs`/`recovered` (token-driven recovery time), `idle_secs`. Remove the mis-measured `claude_active_secs` meaning (repurpose/migrate).
- **New table `drift_by_app(local_day, app_id, app_name, secs)`** — per-app distracted time while a session waited. Powers **"Time lost to distractions: 22m — YouTube 12m · Reddit 6m · …"** in Insights (complaint #4).
- **Meter "why" trail:** a small ring buffer / `meter_events(ts, project_id, delta, reason)` (e.g. `-3% · 2 waiting · Twitter 1m`, `+5% · 80k tokens in project X`). Surfaced in the buddy tooltip and an Insights "what moved your meter today" panel (complaint #6).
- Migration: additive `ALTER TABLE` / new table with `CREATE TABLE IF NOT EXISTS`; existing rows keep working.

---

## 9. Open items to confirm during implementation

1. **`recovery_per_token` constant** — pick against real token volumes so a meaningful work session restores a satisfying amount of health while staying 10× gentler than decay. Default target: ~100k tokens ⇒ ≈0.30 health. Expose in `Sensitivity`.
2. **Countdown-while-not-distracted** — **Resolved (2026-06-01): pause when not distracted.** The countdown appears on Stop but only ticks down while the active app is a tagged distraction; research/docs/editor keep the buddy in a calm "waiting" state with no draining. (Not a hard always-on timer.)

---

## 10. Out of scope

- Window-title / URL reading (Screen Recording permission) — not needed; classification is app-identity + user-curated.
- Changing the water/token→size model.
- Cross-machine sync.

---

## 11. Test strategy

- **Rust units:** `waiting_load` (kept), session phase transitions, `classify` exact-match (incl. the `Xcode` non-match regression), focus-model math (decay/recovery/clamp), countdown formula, installer idempotency + empty-array self-heal (against a temp settings.json).
- **Manual:** verify hooks repopulate in real `~/.claude/settings.json`; run a Claude session and watch `events.jsonl` + buddy counts; tag an app as distraction and confirm decay only then; drag buddy + confirm it floats across Spaces and window switches; resize/move main window; check Insights distraction breakdown + why-trail.

---

## 12. Coverage check vs. original request

| User ask | Addressed in |
|---|---|
| Resize & move the window freely | §7 |
| Move the buddy; overlay across window switches | §6 |
| Compact indicator (N active / N waiting + countdown), not full-screen | §6 |
| Fix what counts as distraction | §5 |
| Distraction time in Insights | §8 |
| Transparent calculation; stop rising without Claude work | §2 model + §8 why-trail |
