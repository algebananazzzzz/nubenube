# CLAUDE.md

Guidance for working in this repo.

## What this is

NubeNube: a Tauri 2 desktop focus companion. Time inside a running focus timer
earns rest at a work:rest ratio; time on a Rest-class app or site spends it
1:1 and ends a running timer, and the bank may go negative. Rest banks weekly (resets Monday). A daily
target pays a bonus when hit; a per-timer finish multiplier pays when the timer
runs out. A cloud creature (the *Nube*) reflects today's pace. Local-first, no
accounts, no network calls for tracking.

- **Frontend:** React 19 + TypeScript, Vite 8, react-router 7 (HashRouter), zustand 5.
- **Backend:** Rust (Tauri), in `src-tauri/`: economy, 1 s engine tick, SQLite, foreground-app watcher.

Websites are tracked and blocked by a bundled Chromium extension
(`src-tauri/browser-extension/`, loaded unpacked) that talks to the app over a
localhost WebSocket. Rest sites are hard-blocked only while a timer runs.

## Commands

```bash
npm run dev            # frontend only in a browser (mock data) — fastest UI loop
npm run tauri dev      # full desktop app (Vite + Rust)
npm run build          # tsc -b && vite build
npm run tauri build    # package the desktop app
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
```

**Verify changes with `npm run build`** — it type-checks (`tsc -b`) and bundles.
Do NOT rely on `npm run lint`; the lint config is pre-broken and not a signal.

## Frontend architecture (`src/`)

- `main.tsx` — mounts the app; applies the persisted theme to `<html>` before
  first paint to avoid a light flash.
- `App.tsx` — HashRouter. The `companion` route is its own OS window; everything
  else renders inside `AppShell` (`/` Home, `/insights`, `/rules`, `/sources`, `/settings`).
- `components/`
  - `AppShell.tsx`: main-window chrome (titlebar, sidebar nav + status chip, header, toast, `<Outlet>`).
  - `Companion.tsx` — always-on-top transparent window; content-sized via a
    ResizeObserver that reports its size to Rust (`nube_resize_companion`). Sole chime owner.
  - `NubeCreature.tsx` — `Sky` (status-tinted panel) + `Nube` (the creature).
  - `ui.tsx`: primitives (`Card, Pill, Btn, Toggle, SegTabs, Section, PrefRow, Slider, Ring, Bar, Tile, Stat, Avatar, ClassSwitch`, …).
- `pages/`: `Home`, `Insights`, `Rules`, `Sources` (Apps & Sites), `Settings`.
- `lib/`
  - `api.ts`: the only bridge to Rust (`invoke`). Inside Tauri, errors propagate
    to the caller (pages toast them); outside Tauri the mock engine answers.
  - `mockData.ts`: browser-only mock engine (ticks a timer each second) + mock insights/settings.
  - `economy.ts`: client mirror of `FINISH`/`finishTier` (keep in sync with
    `economy.rs`), `projectBonus`, `todayPace` phases.
  - `derive.ts`: `useFocusView()` composes the live `FocusTick` + settings + theme
    into the view-model (health, pace, mood/sky/clay, timer projections); `useRules()`.
  - `clay.ts`: maps a hue to the creature's clay fills + accent CSS vars (`themeVars`).
  - `format.ts` (`fmtHM`, `fmtCountdown`, `DAYS`), `chime.ts`, `rescue.ts`, `updater.ts`.
- `store/` (zustand): `focus` (subscribes to `focus-tick`), `settings`
  (Rust-backed), `prefs` (localStorage UI prefs, synced across windows via the
  `storage` event), `toast`, `updater`.
- `theme/tokens.css` — design tokens (dark is default, light theme), type
  utilities (`nn-disp/nn-num/nn-ui/nn-mono/nn-eyebrow`), keyframes (`nn-bob/nn-blink/nn-pulse`).
- `types.ts` — DTOs mirroring the Rust side (serde camelCase).

## Conventions

- **Styling:** inline `style` props referencing CSS custom properties
  (`var(--surface)`, `var(--accent)`, …) defined in `theme/tokens.css`. No
  Tailwind, no CSS-in-JS. Accent + clay vars are injected on each window root via
  `themeVars()`. Use existing tokens; add a token rather than a hard-coded color.
- **Responsive grids:** multi-column layouts use
  `repeat(auto-fit, minmax(min(100%, Npx), 1fr))` so they collapse to one column
  on narrow widths without media queries (inline styles can't carry media queries).
- **Data is always available:** every page renders in a plain browser against
  the mock engine. Keep that property: guard live-only behavior behind `isTauri`.
- **Comments are technical:** state a non-obvious mechanism or constraint. Do not
  narrate what a function does or restate the code.
- **Commits:** Conventional Commits (`feat(scope): …`, `fix(ci): …`). Do not add
  `Co-Authored-By` lines.

## Backend (`src-tauri/src/`)

- `economy.rs`: the rules, pure and unit-tested: `step()` advances a timer +
  today's `Day` by `dt` for a foreground (`Focus` = any non-Rest app, `Rest`,
  `Away`), `apply_target`, `bank`, `state` names (`idle|timer|drift`). A Rest
  foreground ends a running timer (bonus forfeited).
- `engine.rs`: `Engine` behind `Arc<Mutex<>>`: 1 s tick (watcher → economy →
  DB → `focus-tick` + `focus-event`), timer/target/plan commands, running timer
  persisted in `meta` so it survives restarts. Idle ≥ 120 s = Away.
- `db.rs`: `focus.db` (the pre-redesign `nube.db` is ignored): `days`,
  15-minute `slots`, `app_time`, `known_apps`, `meta`; `insights()` buckets.
- `settings.rs`: `settings.json`; apps map name → `work|neutral|rest`
  (exact, case-insensitive match); folds the old `distractionApps`/`workApps` on load.
- `watcher.rs`: frontmost app + idle seconds; NubeNube's own windows (matched
  by pid) read as no app. `notify.rs`: OS notifications.
- `gnome.rs` + `gnome-extension/`: GNOME on Wayland hides the focused window,
  so a bundled Shell extension reports it over D-Bus. Installed from Apps &
  Sites; loads only after the user logs out and back in.
- `browser.rs` + `browser-extension/`: WebSocket on `127.0.0.1:47615`
  (`make dev`: 47616), accepting only the extension's pinned origin (the
  manifest `key` fixes its id). The extension reports the focused window's
  site, which overrides the app's class when listed (longest suffix match); the
  engine sends back the Rest domains to block while a timer runs.
  `install_browser_extension` writes the files to the app data dir.
- `installed.rs`: installed apps (.desktop files / .app bundles) for the Apps &
  Sites search, named as the watcher reports them.

Commands (see `commands.rs`): `get_focus`, `start_timer`, `stop_timer`,
`set_target` (raise-only), `set_day_target`, `set_day_rest`, `get_insights`,
`get_settings`, `save_settings`, `list_apps`,
`tracking_helper`, `install_tracking_helper`, `install_browser_extension`, the
window controls `nube_open_main` / `nube_set_companion` / `nube_resize_companion`,
and `check_update` / `install_update`. Events: `focus-tick` (every second) and
`focus-event` (`timerFinished`, `targetHit`).
