# NubeNube — frontend rework around the Claude Design prototype

_2026-05-31. Status: approved, implementing._

## Goal
Rework the existing Tauri + React + TS app so its UI matches the final Claude Design
prototype (a candy-pastel desktop Tamagotchi focus companion called **Nube**), wired to
the **real existing Rust backend** so every component shows live data. Keep the backend's
domain logic; replace the neutral wireframe frontend.

Approved decisions:
- **Real OS windows** for the companion pet and the full-screen rescue takeover.
- **Full prototype scope**: Home, Projects, Project detail, Insights, Settings, first-launch intro.
- **Single light candy-pastel theme** (remove dark-mode plumbing).

## Source of truth
- Prototype JSX (read-only reference): the design bundle `nube.jsx, ui.jsx, biome.jsx,
  data.jsx, screens-home.jsx, screens-projects.jsx, screens-detail.jsx,
  screens-settings.jsx, intro.jsx, overlays.jsx, app.jsx`.
- Real data contract: `src/types.ts` ↔ `src-tauri/src/dto.rs` (camelCase), `src/lib/api.ts`,
  events `focus-tick` / `usage-updated` / `drift-moment`.

## Real-data bridge (`src/lib/derive.ts` + `src/lib/clay.ts`)
The prototype's hardcoded states become live:

| Prototype | Real source |
|---|---|
| life %, base 70, earned up to +30 | `cloudHealth` 0..1 (resets daily → 0.7); `life=round(health*100)` |
| 7 phases working/idle/waiting/draining/critical/fading/faint | `FocusTick.state` + `secondsSinceClaudeFinished` + `cloudHealth` |
| bloop size/scale | `waterMl` via sqrt curve vs max project water |
| token donut: cache read / input / output / cache write | `tokens.cacheRead / input / output / cacheCreate` |
| away-from-Claude timer | `secondsSinceClaudeFinished` |
| project status dot | `cloudHealth` + recency (`lastSeenUtc`) |
| insights aggregates | `get_totals` + `get_insights(range)` |

`hueClay(hue)` (ported from `ui.jsx`) computes per-project clay shades from `colorHue`.

`phaseFromTick(tick)`:
- `cloudHealth <= 0` → **faint**
- `state==='drifting'`: `secs>=300` → **fading**, `secs>=120` → **critical**, else **draining**
- `state==='grace'` (Claude finished, not yet drifted) → **waiting**
- `state==='growing'` and Claude recently active → **working**, else **idle**
- `idle`/`paused`/`unknown` → **idle**

## Files
**New/rewrite (foundation, authored together for cohesion):**
- `index.html` — Baloo 2 + Plus Jakarta Sans fonts.
- `src/theme/tokens.css` — light candy palette + keyframes; remove dark theme.
- `src/lib/clay.ts` — `hueClay`, `PAL`, project-hue helpers.
- `src/lib/derive.ts` — phase/mood/size/tokenSegs/status derivations.
- `src/components/NubeCreature.tsx` — port `nube.jsx` (7 moods, curl, tadpole, tear/sweat/sparkle/heartbeat).
- `src/components/Biome.tsx` — `Sky/Cloud/Sun/Rain/Twinkles/Zzz`.
- `src/components/ui.tsx` — `Card, Pill, Btn, Meter, LifeBar, Dot, Soft, Spark, Donut, DragBar, Toggle`.

**Screens (parallelizable against frozen foundation):**
- `src/components/AppShell.tsx` — window chrome (traffic lights + Claude Code dot) + sidebar nav + home-bloop LifeBar widget.
- `src/pages/Home.tsx`, `Projects.tsx`, `ProjectDetail.tsx`, `Insights.tsx`, `Settings.tsx`.
- `src/components/IntroStory.tsx` (first-launch overlay), `Companion.tsx`, `Takeover.tsx`.

**Removed:** `pages/Onboarding.tsx, NubeCloseup.tsx, DriftMoment.tsx, MorningReset.tsx`;
old `charts.tsx` + old css consolidated.

**Routing (`App.tsx`):** main = AppShell(Home/Projects/Insights/Settings) + intro overlay;
`#/companion` and `#/takeover` standalone routes for the extra windows.

**Settings mapping:** "Nube dies after N min" → `sensitivity.decayPerMin = 0.7 / (N*?)`
(drain base→0 over N min of drift); grace → `graceSecs`; rescue toggles + aggression →
`driftMomentIntensity`; distraction list → `settings.distractionApps`. Connect = install/uninstall hooks + connection status.

## Tauri (real windows)
- `tauri.conf.json`: add `companion` (small, transparent, alwaysOnTop, decorations:false,
  skipTaskbar, visible:false) and `takeover` (fullscreen, alwaysOnTop, transparent,
  decorations:false, visible:false) windows.
- `capabilities/default.json`: include the new window labels + window show/hide/position perms.
- `lib.rs`: create windows; ensure `focus-tick`/`usage-updated`/`drift-moment` emit to ALL
  windows (`app.emit`); commands `show_takeover(level)`, `hide_takeover`, `set_companion_visible`.
- A frontend supervisor (in main window) listens to `focus-tick`, and when phase escalates to
  an enabled rescue level shows the takeover window; "I'm back" closes it and is reported back.

## Verification
- `npm run build` (tsc -b && vite) clean; `cargo build` clean.
- `npm run dev` renders all screens on mock data.
- Final adversarial multi-agent review workflow; fix findings.
- User runs `npm run tauri dev` for live windows/drift.

## Non-goals
Site blocking, mobile companion, browser-URL drift granularity, sound assets (toggle only).
