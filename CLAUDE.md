# CLAUDE.md

Guidance for working in this repo.

## What this is

NubeNube — a Tauri 2 desktop focus companion. Productive Claude Code usage
"evaporates water" (tokens) that grows a per-project cloud creature (a *Nube*);
when Claude finishes a turn and waits while you drift to a distraction app, the
Nube's life drains. Local-first, no accounts, no network calls for tracking.

- **Frontend:** React 19 + TypeScript, Vite 8, react-router 7 (HashRouter), zustand 5.
- **Backend:** Rust (Tauri), in `src-tauri/` — usage connector, drift watcher, hook bridge.

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
  else renders inside `AppShell` (`/` Home, `/insights`, `/settings`, `/project/:id`).
- `components/`
  - `AppShell.tsx` — main-window chrome (titlebar, sidebar nav + status chip, header, `<Outlet>`).
  - `Companion.tsx` — always-on-top transparent window; content-sized via a
    ResizeObserver that reports its size to Rust (`nube_resize_companion`).
  - `NubeCreature.tsx` — `Sky` (status-tinted panel) + `Nube` (the creature).
  - `ui.tsx` — primitives: `Eyebrow, Card, Pill, Btn, Dot, LifeBar, Donut, Toggle, SegTabs`.
- `pages/` — `Home`, `Insights`, `ProjectDetail`, `Settings`.
- `lib/`
  - `api.ts` — the only bridge to Rust (`invoke`). Every call falls back to mock
    data when a command is missing or running outside Tauri (`isTauri`).
  - `derive.ts` — `useNube()` composes the live `FocusTick` + theme into the
    `NubeState` view-model components read (life→mood/sky, drift→countdown, live timers).
  - `clay.ts` — maps a project hue to the creature's clay fills + accent CSS vars (`themeVars`).
  - `rescue.ts` — wrappers over the Rust window-control commands.
  - `format.ts` (`formatCount`), `useCountdown.ts` (`useCountdown`/`useCountUp`), `updater.ts`.
- `store/` (zustand) — `focus` (subscribes to the `focus-tick` event), `usage`
  (projects/totals/insights/connection), `settings` (Rust-backed), `prefs`
  (localStorage UI prefs, synced across windows via the `storage` event).
- `theme/tokens.css` — design tokens (dark is default, light theme), type
  utilities (`nn-disp/nn-num/nn-ui/nn-mono/nn-eyebrow`), keyframes (`nn-bob/nn-blink/nn-pulse`).
- `types.ts` — DTOs mirroring the Rust side (serde camelCase).

## Conventions

- **Styling:** inline `style` props referencing CSS custom properties
  (`var(--surface)`, `var(--accent)`, …) defined in `theme/tokens.css`. No
  Tailwind, no CSS-in-JS. Accent + per-project clay vars are injected on each
  window root via `themeVars()`. Use existing tokens; add a token rather than a hard-coded color.
- **Responsive grids:** multi-column layouts use
  `repeat(auto-fit, minmax(min(100%, Npx), 1fr))` so they collapse to one column
  on narrow widths without media queries (inline styles can't carry media queries).
- **Data is always available:** because of the mock fallback, every page renders
  in a plain browser. Keep that property — guard live-only behavior behind `isTauri`.
- **Comments are technical:** state a non-obvious mechanism or constraint. Do not
  narrate what a function does or restate the code.
- **Commits:** Conventional Commits (`feat(scope): …`, `fix(ci): …`). Do not add
  `Co-Authored-By` lines.

## Backend bridge (`src-tauri/`)

Tauri commands the frontend invokes (see `commands.rs`): `get_projects`,
`get_totals`, `get_insights`, `get_project_detail`, `get_connection_status`,
`rescan_logs`, `get_settings`, `save_settings`, `install_hooks`,
`uninstall_hooks`, `get_known_apps`, `list_running_apps`, and the window
controls `nube_open_main` / `nube_set_companion` / `nube_resize_companion` /
`nube_set_paused`. The backend emits `focus-tick` (consumed by the `focus`
store), plus `drift-moment` and `usage-updated`.

The water model (mL per token) lives in `src-tauri/src/water.rs` and is mirrored
in `lib/mockData.ts` (`READ_ML_PER_TOKEN` / `WRITE_ML_PER_TOKEN`) so dev litres
match the real connector — keep the two in sync.
