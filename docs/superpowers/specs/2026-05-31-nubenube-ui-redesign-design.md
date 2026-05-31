# NubeNube — UI redesign + per-session drift (follow-up rework)

_2026-05-31. Status: approved, ready for implementation plan._

Builds on `2026-05-31-nubenube-rework-design.md` (the candy-pastel foundation that
exists today). That foundation stays; this pass simplifies the surface and corrects the
core drift metric. Tone stays gentle/celebratory — a companion, not a dashboard.

## Goal

Calm the UI down and make the drift metric honest and multi-session aware:

1. **Remove the Projects "Nube garden" page** and fold a project list into **Insights**.
2. **Project detail** becomes pure tokenomics — no creature.
3. **Settings**: drop "remind me every X min" and the "aggression" preset; pause becomes a
   plain indefinite **pause / resume**.
4. **The floating companion can pause drift tracking** (lunch, meetings) and resume.
5. **Drift is corrected to a per-session, additive model**: it only accrues while a Claude
   session is *stopped and waiting for you* AND you're on a distracting app — and it stacks
   across concurrently-waiting sessions (1 waiting → 1×, 4 waiting → 4×).

## Decisions (all confirmed)

| # | Decision |
|---|---|
| Drift window | Drift accrues **only** between a session's `Stop` and its next `UserPromptSubmit` (per-session waiting window). Distraction while Claude is actively working does **not** count. |
| Per-session | Multiplier = number of **past-grace waiting sessions**; recorded drift = Σ across those sessions, attributed to **each session's own project**. |
| Health decay | **Scales with the waiting-session count per project** — 4 sessions waiting on project X wilt X's Nube ~4× faster. |
| Detail page | **Drop** the per-project `NubeCreature`; pure tokenomics. |
| Insights merge | **Replace** the passive "water by project" bars with a clickable `name · 207 L / 10M · {info}` list; keep the aggregate hero + token donut + focus stats. |
| Settings | Remove reminder dial + aggression preset; **keep** the three full-screen-rescue toggles; pause → indefinite toggle. |
| Page name | Surviving aggregate page stays **"insights"**. |
| Pause model | Indefinite pause = `pauseUntil` sentinel `"9999-12-31T23:59:59Z"`; resume = `null` (keeps existing `is_paused` parser). |

---

## A. Navigation & routes

- **Sidebar nav** (`AppShell.tsx`): `Home · Insights · Settings`. Remove the `Projects` entry
  (and its 4-square icon) from `NAV`.
- **Routes** (`App.tsx`): remove `path="projects"`. Keep `path="project/:id"` (reached from the
  Insights `{info}` button). `index` = Home; unknown → Home.
- **Delete** `src/pages/Projects.tsx` (the garden). `NubeCreature` stays — still used by Home,
  Companion, and the sidebar mini-bloop.

## B. Insights = aggregates + clickable project list (the merge)

`src/pages/Insights.tsx`:
- **Keep:** range selector (today/week/month/all), total-water hero, focus stat cards
  (focused / Claude waited / longest streak), the global token-composition donut + focus panel.
- **Replace** the "WATER BY PROJECT" bar block with a **project list**. Each row:
  - left: a small project-hue dot (`radial-gradient(...)`, **no creature**), the **name**, and a
    faint `rootPath` (via `shortPath`).
  - right: `**207 L** / 10M` — `fmt(litres(p.waterMl),0) L` + `formatCount(tokenTotal(p))` — then
    an **`{info}` action button**.
  - the whole row is clickable; `{info}` is the explicit affordance. Both
    `navigate('/project/' + encodeURIComponent(p.id))`.
  - sorted by `waterMl` desc; uses the existing `useUsage(s => s.projects)`.
- `tokenTotal(p) = input + output + cacheCreate + cacheRead` (same helper Projects.tsx used).
- The list scrolls within the page; aggregates sit above it. No new backend call —
  `projects` already carries `tokens` + `waterMl`.

## C. Project detail — pure tokenomics

`src/pages/ProjectDetail.tsx`:
- **Remove** the `NubeCreature` hero and its import. Header = project **name** + the summary line
  (`X L evaporated · N tokens · M messages`) + `rootPath`.
- **Keep:** metric tiles, token-composition donut + legend, focus & distraction panel, last-7-days bars.
- **Back button → `/insights`** (was `/projects`); the not-found CTA also returns to `/insights`
  with copy like "back to insights".
- **Faint state:** drop the big creature-driven "Revive Nube" panel + the `navigate('/')` Revive
  button. If `cloudHealth` is very low, show a single quiet inline line (e.g. "low on life —
  get back to work to revive") with the existing `Meter`; no creature, no takeover theatrics.

## D. Settings — trimmed

`src/pages/Settings.tsx`:
- **Remove** the `DragBar` "remind me every" (the `prefs.remindMin` control).
- **Remove** the entire **aggression** block (the gentle/escalating/ruthless buttons) and the
  `setAggression` helper.
- **Keep** "how Nube reacts" with the two dials that remain: **"Nube dies after N min"**
  (`decayPerMin`) and **"grace before draining"** (`graceSecs`). Relabel the first to make the
  per-session scaling honest, e.g. **"Nube dies after N min (per waiting session)"**.
- **Keep** the "full-screen rescues" card with its three independent toggles
  (`takeoverFinish` / `takeover2` / `takeover5`) and the existing `toggleRescue` (which keeps the
  Rust `driftMomentIntensity` in sync).
- **Pause:** the "break / pause" row's button toggles indefinite pause. Replace
  `togglePause` so pausing sets `pauseUntil = PAUSE_SENTINEL` and resuming sets `null`. Button
  label: `pause` ⇄ `resume`; sub-copy: "paused — Nube is resting" / "lunch & meetings won't drain Nube".

`src/store/prefs.ts`: remove `remindMin` from the `Prefs` type + `DEFAULTS`.

## E. Floating companion — pause from the pet

`src/components/Companion.tsx`:
- Add a small **pause / resume** affordance to the companion card (e.g. a pill/icon button in
  the footer row, not stealing the click that opens the main window).
- **Paused look:** when `tick.state === 'paused'`, the card goes calm — muted/desaturated,
  the urgent glow + away-timer hidden, a `paused` label and a **resume** button. The Nube can
  show its `content`/napping mood. Clicking the body still calls `nube_open_main`.
- **Running look:** the live Nube + status as today, plus the pause control. When sessions are
  waiting, optionally show a tiny `N waiting` count (see F).
- **Wiring:** call a new `setPaused(boolean)` helper (below) on click.

`src/lib/rescue.ts`: add `setPaused: (paused: boolean) => safe('nube_set_paused', { paused })`
(no-op outside Tauri, like the other wrappers). Used by the companion. The Settings page keeps
its own optimistic `save({ pauseUntil })` path so its toggle is instant; both write the same
`pauseUntil` field, and the live `state: "paused"` tick reconciles every window within ~2s.

Export `PAUSE_SENTINEL = "9999-12-31T23:59:59Z"` from a shared spot (e.g. `lib/derive.ts` or a
tiny constant in `store/settings.ts`) for the Settings toggle.

## F. Drift metric — per-session, additive, scaled health (backend)

### Data already available
The installed hook writes `{"event","ts","cwd","sessionId"}` per line. `events_tail.rs` currently
parses only `event` + `cwd`.

### `events_tail.rs`
- Add `session_id: Option<String>` (serde rename `sessionId`) to `Ev`.
- Pass it through: `handle_stop(&session_id, &cwd)`, `handle_reengage(&session_id, &cwd)`.

### `drift.rs` — replace single `last_stop` with a session map

```rust
struct Waiting { since: Instant, project_id: Option<String>, notified: bool }
// field on DriftRuntime:
waiting: HashMap<String /* sessionId */, Waiting>,   // empty sessionId → key "_" fallback
```

- `handle_stop(session_id, cwd)`: resolve project via `db::resolve_project_by_cwd`; insert/refresh
  `waiting[session_id] = Waiting { since: now, project_id, notified: false }`; also `adopt_project`
  the stopped project so Home/active reflects the most recent stop.
- `handle_reengage(session_id, cwd)`: `waiting.remove(session_id)`; `adopt_project` the cwd's
  project (you just engaged it).

**`tick()` algorithm** (per ~2s, `dt` seconds elapsed):
1. Load settings, snapshot, classify active app, compute `today`; do the daily health reset.
2. `grace = sensitivity.grace_secs`, `ABANDON = 1800` (30 min).
3. **Prune** abandoned sessions: drop any `waiting` whose `now - since > ABANDON`.
4. Compute the past-grace set: `{ s ∈ waiting | grace ≤ (now - since) }`. `waiting_count = |set|`.
   `longest = max(now - since)` over the **whole** waiting map (for the away timer).
5. Branch:
   - **paused** (`is_paused`) → `state = "paused"`. **Freeze**: for every waiting session,
     `since += dt` (the waiting clock does not age during a break). No decay, no drift.
   - **idle** (`idle_secs > threshold`) → `state = "idle"`, record `idle` secs. **Freeze** the
     waiting clocks the same way (away-from-keyboard ≠ ignoring Claude).
   - **Work app** → `state = "growing"`; recover the active project's health
     (`+recovery_per_min·dt/60`). Leave the waiting map intact (re-engagement is per-session via
     the hook, not implied by opening your editor).
   - **Distraction app**:
     - if `waiting_count == 0` → hold (no decay, no drift); `state = "growing"` (Claude's busy).
     - else → `state = "drifting"`. Group the past-grace set by `project_id`; for each group of
       size `k`:
       - `db::add_drift(project, today, active=0, drift = round(dt)·k, idle=0)` — Σ over groups
         yields the full multiplier in the recorded number.
       - **health decay scaled**: `health_project -= decay_per_min · (dt/60) · k`, clamped ≥ 0,
         then `db::save_health`. Keep `self.health` in sync when the active project is in a group.
       - sessions with no resolved project accrue against the active/home project so nothing is lost.
   - **Neutral app** → hold (`state = "growing"`), as today.
6. Save the active project's health; emit the tick.

**Per-session drift-moment notification:** when `state == "drifting"`, for each past-grace
session whose `(now - since) ≥ grace + 60` and `!notified`, mark `notified = true` and fire the
gentle `drift-moment` event / native notification once. (Replaces the single `drift_notified`.)

### DTO + types
- `dto.rs FocusTickDto`: add `waiting_sessions: i64` (→ camelCase `waitingSessions`);
  `seconds_since_claude_finished` = `longest` (the max waiting session), or `None` if none.
- `src/types.ts FocusTick`: add `waitingSessions: number`.
- `src/lib/mockData.ts`: add `waitingSessions` to `mockFocusTick` (e.g. `0`), so browser mode compiles.
- `derive.ts`: `phaseFromTick` logic is unchanged in shape (still keyed on `state` +
  `secondsSinceClaudeFinished` + `cloudHealth`); it now simply receives correctly-scoped values.

### `nube_set_paused` command (companion pause)
`commands.rs`:
```rust
#[tauri::command]
pub fn nube_set_paused(state: State<AppState>, paused: bool) {
    let mut s = crate::settings::load(&state.config_dir);
    s.pause_until = if paused { Some("9999-12-31T23:59:59Z".into()) } else { None };
    crate::settings::save(&state.config_dir, &s);
}
```
Register it in `lib.rs` `generate_handler!`. **No capabilities change needed** — app-defined
commands aren't gated by the Tauri v2 permission system (only plugin/core commands are; that's
why `nube_open_main` already works from the companion).

### Optional UI surfacing of the multiplier
- Home (`Home.tsx`) and Companion may show a small `N sessions waiting` chip when
  `tick.waitingSessions > 1`; the away-timer already shows the longest wait. Low-risk polish;
  not required for correctness.

---

## Files touched

**Frontend**
- delete `src/pages/Projects.tsx`
- `src/App.tsx` — drop `/projects` route
- `src/components/AppShell.tsx` — remove Projects nav item; replace `prefs.remindMin` snooze with a
  `const REMIND_MIN = 2`
- `src/pages/Insights.tsx` — clickable project list replaces the bar block
- `src/pages/ProjectDetail.tsx` — remove creature; back → `/insights`; quiet faint line
- `src/pages/Settings.tsx` — remove reminder + aggression; indefinite pause toggle; relabel decay dial
- `src/store/prefs.ts` — remove `remindMin`
- `src/lib/rescue.ts` — add `setPaused`
- `src/components/Companion.tsx` — pause/resume control + paused visual state
- `src/types.ts` — `FocusTick.waitingSessions`
- `src/lib/mockData.ts` — `mockFocusTick.waitingSessions`
- (optional) `src/pages/Home.tsx` — "N sessions waiting" chip
- shared `PAUSE_SENTINEL` constant

**Backend**
- `src-tauri/src/events_tail.rs` — parse + pass `sessionId`
- `src-tauri/src/drift.rs` — session map, per-session grace, additive drift, scaled per-project
  decay, freeze-on-pause/idle, abandon TTL, `waitingSessions` + longest-wait in the tick
- `src-tauri/src/dto.rs` — `FocusTickDto.waiting_sessions`
- `src-tauri/src/commands.rs` — `nube_set_paused`
- `src-tauri/src/lib.rs` — register `nube_set_paused`
- (`src-tauri/src/db.rs` — reuse `load_health` / `save_health` / `add_drift` / `resolve_project_by_cwd`; no schema change)

## Edge cases / robustness

- **Abandoned sessions** (terminal closed, no `UserPromptSubmit`): pruned after `ABANDON` (30 min);
  in-memory map also resets on app restart, so nothing carries across runs.
- **Pause/idle freeze**: waiting clocks advance with `dt` so a lunch break doesn't age a wait into
  `critical`/`fading` on resume.
- **Multiple projects in one tick**: drift + decay applied per project group via the existing db
  helpers; the active project's `self.health` is kept consistent.
- **Empty `sessionId`** (no `jq`, old lines): bucket under a single fallback key so the runtime still
  works (degrades to single-session behavior).
- **Settings vs. companion pause race**: both write the same `pauseUntil`; the drift loop reads
  fresh each tick; live `state:"paused"` reconciles all windows. Acceptable; writes are last-writer-wins.

## Verification

- `npm run build` (tsc -b && vite) clean; `cargo build --manifest-path src-tauri/Cargo.toml` clean.
- `cargo test --manifest-path src-tauri/Cargo.toml` (hook installer test still passes; add a
  `drift.rs` unit test for the multiplier: 1 vs 4 waiting sessions → 1× vs 4× recorded drift).
- `npm run dev` renders Home / Insights (with project list) / detail / Settings on mock data; nav
  shows three items; no dead `/projects` link.
- Manual (`npm run tauri dev`): pause from the companion flips `state:"paused"` within ~2s and
  stops drift; resume continues; 2 concurrent waiting sessions on distraction double the recorded
  "Claude waited".

## Non-goals

- Site blocking, mobile companion, browser-URL/window-title drift granularity, sound assets.
- No DB schema change; no change to the token/water connector or the water model.
- Dark mode (already removed by the foundation).
