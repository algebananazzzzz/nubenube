# NubeNube UI Redesign + Per-Session Drift — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calm the NubeNube UI (drop the Projects "Nube garden" into Insights, strip Settings, creature-free project detail), let the floating companion pause drift tracking, and correct drift to a per-session, additive metric that only accrues while a Claude session is stopped-and-waiting.

**Architecture:** Tauri v2 desktop app — React 19 + TypeScript front end (Vite, HashRouter, Zustand stores) over a Rust backend (SQLite via rusqlite, a ~2 s active-window/idle watcher, and a Claude Code hook bridge). The live `focus-tick` event drives Home + companion + the rescue supervisor. This plan edits existing files; no new architecture.

**Tech Stack:** React 19, react-router-dom 7, Zustand 5, TypeScript ~6; Rust (tauri 2, rusqlite, chrono).

> **No version control in this repo** (`git` is not initialized here). Each task therefore ends with a **Verify** gate (build / lint / test) instead of a commit. If you run `git init` first, replace each Verify gate with a `git add … && git commit` using the suggested message in the task.
>
> **Verification commands** (run from repo root `/Users/bytedance/nubenube`):
> - Frontend typecheck + build: `npm run build`  (runs `tsc -b && vite build`)
> - Frontend lint: `npm run lint`
> - Backend build: `cargo build --manifest-path src-tauri/Cargo.toml`
> - Backend tests: `cargo test --manifest-path src-tauri/Cargo.toml`
> - There is **no JS test runner** in this project; frontend tasks are verified by typecheck/build/lint + the described manual `npm run dev` check. Do **not** scaffold a JS test framework (YAGNI).

---

## File Structure (what changes and why)

**Frontend**
- `src/types.ts` — add `waitingSessions` to the `FocusTick` contract.
- `src/lib/mockData.ts` — keep `mockFocusTick` matching the contract.
- `src/lib/derive.ts` — export the `PAUSE_SENTINEL` constant (indefinite-pause marker).
- `src/lib/rescue.ts` — add the `setPaused` window-command wrapper.
- `src/pages/Insights.tsx` — gains the clickable project list (replaces the passive bar block).
- `src/pages/ProjectDetail.tsx` — creature-free; back → `/insights`.
- `src/pages/Settings.tsx` — remove reminder dial + aggression preset; indefinite pause toggle.
- `src/store/prefs.ts` — drop `remindMin`.
- `src/components/AppShell.tsx` — nav drops "Projects"; snooze uses a constant.
- `src/components/Companion.tsx` — pause/resume control + calm paused state.
- `src/components/Home.tsx` — small "N sessions waiting" chip (optional polish).
- `src/App.tsx` — drop the `/projects` route.
- **delete** `src/pages/Projects.tsx`.

**Backend**
- `src-tauri/src/events_tail.rs` — parse + forward `sessionId`.
- `src-tauri/src/drift.rs` — per-session waiting map, additive drift, scaled per-project decay, freeze-on-pause/idle, abandon TTL, `waitingSessions` in the tick. **Has unit tests.**
- `src-tauri/src/dto.rs` — add `waiting_sessions` to `FocusTickDto`.
- `src-tauri/src/commands.rs` — add `nube_set_paused`.
- `src-tauri/src/lib.rs` — register `nube_set_paused`.

---

## Task 1: Add `waitingSessions` to the FocusTick contract

**Files:**
- Modify: `src/types.ts` (the `FocusTick` type)
- Modify: `src/lib/mockData.ts:238-250` (`mockFocusTick`)

- [ ] **Step 1: Add the field to the type**

In `src/types.ts`, find the `FocusTick` type and add `waitingSessions` after `secondsSinceClaudeFinished`:

```ts
export type FocusTick = {
  ts: string
  appId: string
  appName: string
  appClass: AppClass
  title?: string
  idleSecs: number
  state: FocusState
  activeProjectId?: string
  activeProjectName?: string
  cloudHealth: number
  secondsSinceClaudeFinished?: number
  waitingSessions: number // # of Claude sessions stopped-and-waiting (past grace)
}
```

- [ ] **Step 2: Keep the mock in sync**

In `src/lib/mockData.ts`, add `waitingSessions` to `mockFocusTick` (after `secondsSinceClaudeFinished`):

```ts
export const mockFocusTick: FocusTick = {
  ts: new Date().toISOString(),
  appId: 'com.microsoft.VSCode',
  appName: 'Code',
  appClass: 'work',
  title: 'lib.rs — nubenube',
  idleSecs: 4,
  state: 'growing',
  activeProjectId: 'proj_nubenube',
  activeProjectName: 'nubenube',
  cloudHealth: 0.82,
  secondsSinceClaudeFinished: 42,
  waitingSessions: 0,
}
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: PASS (tsc clean — no "property missing" errors). Gate / commit msg: `feat: add waitingSessions to FocusTick contract`.

---

## Task 2: Insights — clickable project list replacing the bar block

**Files:**
- Modify: `src/pages/Insights.tsx` (imports; remove `byWater`/`maxW`; replace the "water by project" `<div>` block at lines ~139-157)

- [ ] **Step 1: Update imports**

At the top of `src/pages/Insights.tsx`, add `useNavigate`, add `shortPath` to the format import, and add the `Project` type import. Replace the existing import lines:

```ts
import { useNavigate } from 'react-router-dom'
import { useUsage } from '../store/usage'
import { Donut, INK, SUB, FAINT, shadow, elev, fmt } from '../components/ui'
import { hueClay } from '../lib/clay'
import { tokenSegs, sumTokenM } from '../lib/derive'
import { formatCount, formatDuration, shortPath } from '../lib/format'
import { formatWater, funWater } from '../theme/units'
import type { Project, RangeKey } from '../types'
```

- [ ] **Step 2: Add a `tokenTotal` helper and a `navigate` handle; drop the old `byWater`/`maxW`**

Below the existing `const litres = (ml: number) => ml / 1000` near the top of the file, add:

```ts
const tokenTotal = (p: Project) => p.tokens.input + p.tokens.output + p.tokens.cacheCreate + p.tokens.cacheRead
```

Inside `export function Insights()`, add a navigate handle near the other hooks (e.g. after `const setRange = useUsage((s) => s.setRange)`):

```ts
  const navigate = useNavigate()
```

Then **delete** these two now-unused lines (the old bar-list data):

```ts
  const byWater = [...projects].sort((a, b) => b.waterMl - a.waterMl).slice(0, 8)
  const maxW = byWater[0]?.waterMl || 1
```

and add (in their place) the full sorted list:

```ts
  const sorted = [...projects].sort((a, b) => b.waterMl - a.waterMl)
```

- [ ] **Step 3: Replace the "water by project" block**

Find the block that starts with the comment `{/* water by project (all-time) */}` and ends just before the closing of the scroll container. Replace that entire `<div>…</div>` block with the clickable project list:

```tsx
        {/* projects — where the water went (tap for detail) */}
        <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 18, border: elev.border, boxShadow: shadow.md, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: SUB, letterSpacing: '.02em' }}>PROJECTS · where the water went</div>
            <span style={{ fontWeight: 600, fontSize: 11.5, color: FAINT }}>{sorted.length} projects · tap for detail</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sorted.map((p, i) => {
              const c = hueClay(p.colorHue)
              const go = () => navigate(`/project/${encodeURIComponent(p.id)}`)
              return (
                <div
                  key={p.id}
                  onClick={go}
                  role="button"
                  tabIndex={0}
                  aria-label={`open ${p.name}`}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 6px', cursor: 'pointer', borderTop: i === 0 ? 'none' : '1px solid rgba(120,100,170,.1)' }}
                >
                  <span style={{ width: 14, height: 14, borderRadius: 99, background: `radial-gradient(circle at 35% 30%, ${c.light}, ${c.deep})`, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    <div style={{ fontWeight: 600, fontSize: 11, color: FAINT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortPath(p.rootPath)}</div>
                  </div>
                  <span className="nn-num" style={{ fontWeight: 800, fontSize: 13, color: c.ink, whiteSpace: 'nowrap' }}>{fmt(litres(p.waterMl), 0)} L</span>
                  <span style={{ fontWeight: 600, fontSize: 11.5, color: FAINT, whiteSpace: 'nowrap' }}>/ {formatCount(tokenTotal(p))}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); go() }}
                    aria-label={`info about ${p.name}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: elev.border, background: '#fff', cursor: 'pointer', borderRadius: 99, padding: '6px 11px', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 11.5, color: c.deep, boxShadow: shadow.sm, flexShrink: 0 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.deep} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5h.01" /></svg>
                    info
                  </button>
                </div>
              )
            })}
          </div>
        </div>
```

- [ ] **Step 4: Verify**

Run: `npm run build && npm run lint`
Expected: PASS — no unused-variable errors (confirms `byWater`/`maxW` were fully removed).
Manual: `npm run dev`, open Insights → the project list shows `name · path · NNN L / NNNM · info`; clicking a row or its **info** button navigates to that project's detail. Gate / commit msg: `feat: merge project list into Insights with info buttons`.

---

## Task 3: ProjectDetail — creature-free, back to Insights

**Files:**
- Modify: `src/pages/ProjectDetail.tsx` (remove `NubeCreature` + `sizeFor`; back links → `/insights`; replace hero + faint panel)

- [ ] **Step 1: Drop the creature imports**

In `src/pages/ProjectDetail.tsx`:
- Remove the line `import { NubeCreature } from '../components/NubeCreature'`.
- In the derive import, remove `sizeFor` (it's only used by the creature). Change:

```ts
import { projectStatus, tokenSegs, sumTokenM, type TokenSeg } from '../lib/derive'
```

- [ ] **Step 2: Point both back-navigations at `/insights`**

There are two `navigate('/projects')` calls. Replace them:

The not-found CTA (was line ~64):

```tsx
        <Btn hue={268} kind="soft" size="sm" onClick={() => navigate('/insights')}>back to insights</Btn>
```

The top-bar back button (was line ~91) — change its `onClick` and its label text:

```tsx
        <button onClick={() => navigate('/insights')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent', cursor: 'pointer', color: SUB, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={SUB} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
          Insights
        </button>
```

- [ ] **Step 3: Replace the hero header (remove the creature + Revive button)**

Find the `{/* hero header */}` block (the `<div>` containing the `NubeCreature`, the name, and the `faint &&` Revive `<Btn>`). Replace the whole block with this creature-free header:

```tsx
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '6px 0 16px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="nn-disp" style={{ fontWeight: 800, fontSize: 26, color: c.ink, lineHeight: 1, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
            <div style={{ fontWeight: 600, fontSize: 13, color: SUB, marginTop: 6 }}>
              <b className="nn-num" style={{ color: INK }}>{fmt(litres(p.waterMl), 0)} L</b> evaporated · <b className="nn-num" style={{ color: INK }}>{formatCount(totalTok * 1e6)}</b> tokens · <b className="nn-num" style={{ color: INK }}>{formatCount(p.msgCount)}</b> messages
            </div>
            <div style={{ fontWeight: 600, fontSize: 11.5, color: FAINT, marginTop: 3 }}>{p.rootPath}</div>
          </div>
        </div>
```

- [ ] **Step 4: Replace the faint "Revive" panel with a quiet line**

Find the `{faint && ( … reviving … <Meter … /> … )}` block (the warm gradient panel) and replace it with this calmer inline note (no creature theatrics):

```tsx
        {/* low-life note (quiet — no creature) */}
        {faint && (
          <div style={{ marginBottom: 14, padding: '12px 16px', borderRadius: 14, background: 'var(--surface)', border: elev.border, boxShadow: shadow.sm }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 12.5, color: '#c47a3a' }}>low on life · {Math.round(p.cloudHealth * 100)}%</span>
              <span style={{ fontWeight: 600, fontSize: 11.5, color: FAINT }}>get back to work to revive · 1 L ≈ 10 min focus</span>
            </div>
            <Meter value={p.cloudHealth} hue={26} height={10} danger />
          </div>
        )}
```

- [ ] **Step 5: Verify**

Run: `npm run build && npm run lint`
Expected: PASS — no unused imports (`NubeCreature`, `sizeFor` gone). `Btn`, `Meter` remain (still used).
Manual: `npm run dev`, open a project from Insights → detail shows the donut/tiles/last-7-days, **no creature**; the back button returns to Insights. Gate / commit msg: `refactor: creature-free project detail, back to Insights`.

---

## Task 4: Remove the Projects page

**Files:**
- Delete: `src/pages/Projects.tsx`
- Modify: `src/App.tsx` (drop import + `/projects` route)
- Modify: `src/components/AppShell.tsx:24-29` (drop the Projects `NAV` entry)

- [ ] **Step 1: Delete the page**

Run: `rm src/pages/Projects.tsx`

- [ ] **Step 2: Remove the route**

In `src/App.tsx`, delete the import line `import { Projects } from './pages/Projects'` and delete the route line:

```tsx
          <Route path="projects" element={<Projects />} />
```

Leave the `project/:id` route intact.

- [ ] **Step 3: Remove the nav item**

In `src/components/AppShell.tsx`, delete the Projects entry from the `NAV` array so it reads:

```tsx
const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: '/', label: 'Home', end: true, icon: <path d="M4 11 12 4l8 7v8a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 19z" /> },
  { to: '/insights', label: 'Insights', icon: <path d="M4 17 9 11l3.5 3.5L20 6" /> },
  { to: '/settings', label: 'Settings', icon: <g><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></g> },
]
```

- [ ] **Step 4: Verify no dead references remain**

Run: `grep -rn "pages/Projects\|to: '/projects'\|navigate('/projects')" src`
Expected: no matches.
Run: `npm run build && npm run lint`
Expected: PASS.
Manual: `npm run dev` → sidebar shows exactly **Home · Insights · Settings**. Gate / commit msg: `feat: remove Projects garden page (merged into Insights)`.

---

## Task 5: Drop `remindMin` (Settings reminder removed)

**Files:**
- Modify: `src/store/prefs.ts:8-26` (remove `remindMin` from type + defaults)
- Modify: `src/components/AppShell.tsx:85` (snooze uses a constant)

- [ ] **Step 1: Remove `remindMin` from prefs**

In `src/store/prefs.ts`, remove `remindMin: number` from the `Prefs` type and `remindMin: 2,` from `DEFAULTS`. The type becomes:

```ts
export type Prefs = {
  takeoverFinish: boolean
  takeover2: boolean
  takeover5: boolean
  sound: boolean
  companion: boolean
  introDone: boolean
}

const DEFAULTS: Prefs = {
  takeoverFinish: true,
  takeover2: true,
  takeover5: true,
  sound: true,
  companion: true,
  introDone: false,
}
```

- [ ] **Step 2: Replace the snooze use with a constant**

In `src/components/AppShell.tsx`, add a module-level constant near the top (after the `RANK` const, around line 22):

```ts
const REMIND_MIN = 2 // minutes to snooze a rescue after "I'm back" (was a user pref)
```

Then change the snooze line (was line ~85) inside the `onRescue` callback. It currently reads:

```ts
      snoozeUntil.current = Date.now() + (a === 'snooze' ? p.remindMin * 60_000 : 12_000)
```

Replace with:

```ts
      snoozeUntil.current = Date.now() + (a === 'snooze' ? REMIND_MIN * 60_000 : 12_000)
```

Keep the surrounding `const p = usePrefs.getState()` line — `p.sound` is still used just below.

- [ ] **Step 3: Verify**

Run: `grep -rn "remindMin" src`
Expected: no matches.
Run: `npm run build && npm run lint`
Expected: PASS. Gate / commit msg: `refactor: drop remindMin pref, fixed snooze interval`.

---

## Task 6: Settings — remove aggression, indefinite pause, relabel decay

**Files:**
- Modify: `src/lib/derive.ts` (export `PAUSE_SENTINEL`)
- Modify: `src/pages/Settings.tsx` (remove the reminder DragBar, the aggression block + `setAggression`; relabel the decay dial; indefinite pause)

- [ ] **Step 1: Export the pause sentinel**

In `src/lib/derive.ts`, add near the other exported constants (e.g. just after `export const BASE_LIFE = 70`):

```ts
/** Indefinite pause marker stored in Settings.pauseUntil; resume clears it to null. */
export const PAUSE_SENTINEL = '9999-12-31T23:59:59Z'
```

- [ ] **Step 2: Import the sentinel in Settings**

In `src/pages/Settings.tsx`, change the derive import to include it:

```ts
import { BASE_LIFE, PAUSE_SENTINEL } from '../lib/derive'
```

- [ ] **Step 3: Remove the `setAggression` helper and the `aggression` value**

Delete the `aggression` const and the `setAggression` arrow function (the block that computes `'gentle' | 'escalating' | 'ruthless'` and the function that sets the three takeover prefs from a preset). Keep `toggleRescue` (it stays). After deletion, the only rescue-related helper left is `toggleRescue`.

- [ ] **Step 4: Make pause indefinite**

Replace the `togglePause` definition (was line ~105):

```ts
  const togglePause = () => save({ pauseUntil: paused ? null : PAUSE_SENTINEL })
```

(`const paused = …` just above it stays as-is — `is_paused`-style check against `pauseUntil` in the future still returns `true` for the sentinel.)

- [ ] **Step 5: Remove the reminder DragBar and relabel the decay dial**

In the "how Nube reacts" card, the three `DragBar`s currently are "Nube dies after", "grace before draining", "remind me every". **Delete** the "remind me every" `DragBar` line entirely. **Relabel** the first dial's format so the per-session scaling is honest. The two remaining DragBars should read:

```tsx
              <DragBar label="Nube dies after" value={dieMin} min={1} max={15} step={1} hue={ACCENT} format={(v) => `${v} min · per waiting session`} onChange={setDieMin} />
              <DragBar label="grace before draining" value={settings.sensitivity.graceSecs} min={0} max={120} step={5} hue={ACCENT} format={(v) => `${v}s`} onChange={setGrace} />
```

- [ ] **Step 6: Remove the aggression UI block**

Delete the aggression heading + button row (the `<div className="nn-disp" …>aggression</div>` and the `{(['gentle', 'escalating', 'ruthless'] as const).map(...)}` `<div>` right below the DragBars). The "how Nube reacts" card now ends after the two DragBars.

- [ ] **Step 7: Update the pause button label**

In the "break / pause" row, change the button so it no longer says "1h":

```tsx
              <Btn hue={paused ? 158 : 268} kind={paused ? 'primary' : 'soft'} size="sm" onClick={togglePause}>{paused ? 'resume' : 'pause'}</Btn>
```

- [ ] **Step 8: Verify**

Run: `grep -rn "aggression\|remind me every\|pause 1h" src`
Expected: no matches.
Run: `npm run build && npm run lint`
Expected: PASS (no unused vars — `aggression`/`setAggression` fully removed).
Manual: `npm run dev` → Settings shows two dials (decay "per waiting session" + grace), the three full-screen-rescue toggles, and a **pause/resume** button (no "1h"). Gate / commit msg: `feat: simplify Settings — indefinite pause, drop aggression+reminder`.

---

## Task 7: Companion pause control + `setPaused` wrapper

**Files:**
- Modify: `src/lib/rescue.ts` (add `setPaused`)
- Modify: `src/components/Companion.tsx` (pause/resume UI + calm paused state)

- [ ] **Step 1: Add the `setPaused` window-command wrapper**

In `src/lib/rescue.ts`, add `setPaused` to the `rescue` object:

```ts
export const rescue = {
  showTakeover: () => safe('nube_show_takeover'),
  hideTakeover: () => safe('nube_hide_takeover'),
  setCompanion: (visible: boolean) => safe('nube_set_companion', { visible }),
  openMain: () => safe('nube_open_main'),
  setPaused: (paused: boolean) => safe('nube_set_paused', { paused }),
}
```

(`safe` already no-ops outside Tauri and swallows a missing command, so this is safe to land before the Rust command exists.)

- [ ] **Step 2: Rewrite `Companion.tsx` with the pause control**

Replace the entire contents of `src/components/Companion.tsx` with:

```tsx
// Companion — the always-on-top desktop pet (its own transparent OS window).
// Mirrors the live Nube; click to bring the main window forward. Has a small
// pause/resume control so you can stop drift tracking for lunch / meetings.

import { useEffect, type MouseEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useFocus } from '../store/focus'
import { useUsage } from '../store/usage'
import { NubeCreature } from './NubeCreature'
import { Dot, INK, SUB } from './ui'
import { PHASE_META, phaseFromTick, mmss, type Phase } from '../lib/derive'
import { isTauri } from '../lib/api'
import { rescue } from '../lib/rescue'

const TEXT: Record<Phase, string> = { working: 'thriving', idle: 'napping', waiting: 'waiting!', draining: 'come back', critical: 'gasping!', fading: 'fading…', faint: 'fainted' }

export function Companion() {
  const tick = useFocus((s) => s.tick)
  const subscribe = useFocus((s) => s.subscribe)
  const projects = useUsage((s) => s.projects)
  const loadAll = useUsage((s) => s.loadAll)

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
  const urgent = !paused && (phase === 'draining' || phase === 'critical' || phase === 'fading')
  const secs = tick.secondsSinceClaudeFinished ?? 0
  const waiting = tick.waitingSessions ?? 0

  const open = () => { if (isTauri) void invoke('nube_open_main').catch(() => {}) }
  const togglePause = (e: MouseEvent) => { e.stopPropagation(); void rescue.setPaused(!paused) }

  return (
    <div className="nn-ui" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'transparent' }}>
      <div
        onClick={open}
        role="button"
        tabIndex={0}
        aria-label="open NubeNube"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}
        title="open NubeNube"
        style={{
          width: 150, cursor: 'pointer', borderRadius: 22, padding: '10px 12px 11px',
          background: 'rgba(255,255,255,.82)', backdropFilter: 'blur(14px)',
          boxShadow: urgent ? '0 18px 40px -14px rgba(210,100,60,.6), 0 0 0 2px rgba(236,122,74,.5)' : '0 18px 40px -16px rgba(90,70,150,.55), 0 0 0 1px rgba(255,255,255,.6)',
          border: '1px solid rgba(255,255,255,.7)',
          filter: paused ? 'saturate(.7)' : 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', gap: 3, marginBottom: 2 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 4, height: 4, borderRadius: 99, background: 'rgba(120,100,170,.3)' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', height: 84, alignItems: 'center' }}>
          <NubeCreature mood={paused ? 'content' : meta.mood} hue={hue} size={96} scale={1} />
        </div>
        {paused ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span className="nn-disp" style={{ fontWeight: 700, fontSize: 13, color: SUB }}>paused · resting</span>
            <button onClick={togglePause} aria-label="resume drift tracking" style={{ border: 'none', cursor: 'pointer', borderRadius: 99, padding: '5px 14px', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 11.5, background: 'linear-gradient(165deg, hsl(158 50% 60%), hsl(158 55% 50%))', color: '#fff' }}>▶ resume</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 2 }}>
              <Dot color={meta.dot} pulse={urgent || phase === 'waiting'} size={7} />
              <span className="nn-disp" style={{ fontWeight: 700, fontSize: 13, color: urgent ? 'var(--danger)' : INK }}>{TEXT[phase]}</span>
              {(urgent || phase === 'waiting') && <span className="nn-disp" style={{ fontWeight: 700, fontSize: 12, color: SUB, marginLeft: 2 }}>{mmss(secs)}</span>}
              <button onClick={togglePause} aria-label="pause drift tracking" title="pause (lunch / meeting)" style={{ border: 'none', cursor: 'pointer', borderRadius: 99, padding: '3px 8px', marginLeft: 2, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 11, background: 'rgba(120,100,170,.12)', color: SUB }}>⏸</button>
            </div>
            {waiting > 1 && (
              <div style={{ textAlign: 'center', marginTop: 4, fontWeight: 700, fontSize: 10, color: SUB }}>{waiting} sessions waiting</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify**

Run: `npm run build && npm run lint`
Expected: PASS.
Manual: `npm run dev`, open `#/companion` in the browser → the card renders with a `⏸` control (clicking it is a no-op in the browser, which is expected — it only does work under Tauri). Gate / commit msg: `feat: pause/resume drift from the floating companion`.

---

## Task 8: Backend — per-session drift (events + DTO + drift.rs with tests)

**Files:**
- Modify: `src-tauri/src/dto.rs:116-130` (`FocusTickDto` — add `waiting_sessions`)
- Modify: `src-tauri/src/events_tail.rs` (parse + forward `sessionId`)
- Rewrite: `src-tauri/src/drift.rs` (per-session model + unit tests)

This task changes `handle_stop`/`handle_reengage` signatures and `build_tick`, so the DTO field, the events caller, and `drift.rs` must all land together for `cargo build` to pass. Tests come first (TDD) but live inside the rewritten `drift.rs`, so we write the file, then run the tests.

- [ ] **Step 1: Add the DTO field**

In `src-tauri/src/dto.rs`, add `waiting_sessions` to `FocusTickDto` (after `seconds_since_claude_finished`):

```rust
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FocusTickDto {
    pub ts: String,
    pub app_id: String,
    pub app_name: String,
    pub app_class: String,
    pub title: Option<String>,
    pub idle_secs: i64,
    pub state: String,
    pub active_project_id: Option<String>,
    pub active_project_name: Option<String>,
    pub cloud_health: f64,
    pub seconds_since_claude_finished: Option<i64>,
    pub waiting_sessions: i64,
}
```

- [ ] **Step 2: Forward `sessionId` from the event tail**

In `src-tauri/src/events_tail.rs`, extend the `Ev` struct and the dispatch. Replace the `Ev` struct:

```rust
#[derive(Deserialize)]
struct Ev {
    event: Option<String>,
    cwd: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}
```

And replace the match block (inside the `if let Ok(ev) = …` body):

```rust
                if let Ok(ev) = serde_json::from_str::<Ev>(&line) {
                    let cwd = ev.cwd.unwrap_or_default();
                    let sid = ev.session_id.unwrap_or_default();
                    if let Ok(mut rt) = runtime.lock() {
                        match ev.event.as_deref() {
                            Some("stop") => rt.handle_stop(&sid, &cwd),
                            Some("reengage") => rt.handle_reengage(&sid, &cwd),
                            _ => {}
                        }
                    }
                }
```

- [ ] **Step 3: Rewrite `drift.rs` (per-session model + tests)**

Replace the entire contents of `src-tauri/src/drift.rs` with:

```rust
//! Post-Stop drift state machine + cloudHealth — per-session and additive.
//!
//! Two-force model: WATER (tokens) grows the Nube's size (connector); FOCUS-vs-
//! DRIFT drives HEALTH (here), which resets daily. Idle (away) FREEZES health.
//!
//! Drift accrues ONLY while a Claude session is stopped-and-waiting for you AND
//! you're on a distraction app, and it STACKS across concurrently-waiting
//! sessions — each attributed to that session's own project. So 1 waiting
//! session = 1×, 4 waiting = 4×.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::Local;
use rusqlite::Connection;
use tauri::{AppHandle, Emitter};

use crate::dto::FocusTickDto;
use crate::watcher::{self, AppClass};
use crate::{db, notify, settings};

const RESET_BASELINE: f64 = 0.7;
/// A session waiting longer than this (e.g. closed terminal, never re-engaged)
/// is treated as abandoned and stops counting toward drift.
const ABANDON_SECS: u64 = 1800;

/// One Claude session that has stopped and is waiting for the user.
struct Waiting {
    since: Instant,
    project_id: Option<String>,
    notified: bool,
}

pub struct DriftRuntime {
    db_path: PathBuf,
    config_dir: PathBuf,
    state: String,
    project_id: Option<String>,
    project_name: String,
    health: f64,
    last_reset_day: String,
    last_tick: Instant,
    waiting: HashMap<String, Waiting>,
}

/// Summarize waiting sessions given each one's (project_id, elapsed_secs):
/// returns (total past-grace count, per-project past-grace counts, longest
/// elapsed among non-abandoned sessions). Pure → unit-testable.
fn waiting_load(
    sessions: &[(Option<String>, u64)],
    grace: u64,
) -> (i64, HashMap<String, i64>, Option<u64>) {
    let mut total = 0i64;
    let mut per_project: HashMap<String, i64> = HashMap::new();
    let mut longest: Option<u64> = None;
    for (pid, elapsed) in sessions {
        if *elapsed > ABANDON_SECS {
            continue;
        }
        longest = Some(longest.map_or(*elapsed, |l| l.max(*elapsed)));
        if *elapsed >= grace {
            total += 1;
            let key = pid.clone().unwrap_or_else(|| "_".to_string());
            *per_project.entry(key).or_insert(0) += 1;
        }
    }
    (total, per_project, longest)
}

impl DriftRuntime {
    pub fn new(db_path: PathBuf, config_dir: PathBuf) -> Self {
        let mut rt = DriftRuntime {
            db_path,
            config_dir,
            state: "growing".to_string(),
            project_id: None,
            project_name: String::new(),
            health: RESET_BASELINE,
            last_reset_day: String::new(),
            last_tick: Instant::now(),
            waiting: HashMap::new(),
        };
        if let Ok(conn) = db::open(&rt.db_path) {
            if let Some(pid) = db::most_recent_project(&conn) {
                rt.adopt_project(&conn, &pid);
            }
        }
        rt
    }

    fn adopt_project(&mut self, conn: &Connection, pid: &str) {
        if self.project_id.as_deref() == Some(pid) {
            return;
        }
        let (h, d) = db::load_health(conn, pid);
        self.project_id = Some(pid.to_string());
        self.project_name = db::project_name(conn, pid);
        self.health = h;
        self.last_reset_day = d;
    }

    fn session_key(session_id: &str) -> String {
        if session_id.is_empty() {
            "_".to_string()
        } else {
            session_id.to_string()
        }
    }

    /// Stop hook: this session finished — begin its waiting window.
    pub fn handle_stop(&mut self, session_id: &str, cwd: &str) {
        let mut project_id = None;
        if let Ok(conn) = db::open(&self.db_path) {
            if let Some(pid) = db::resolve_project_by_cwd(&conn, cwd) {
                project_id = Some(pid.clone());
                self.adopt_project(&conn, &pid);
            }
        }
        self.waiting.insert(
            Self::session_key(session_id),
            Waiting { since: Instant::now(), project_id, notified: false },
        );
    }

    /// UserPromptSubmit hook: this session re-engaged.
    pub fn handle_reengage(&mut self, session_id: &str, cwd: &str) {
        self.waiting.remove(&Self::session_key(session_id));
        if let Ok(conn) = db::open(&self.db_path) {
            if let Some(pid) = db::resolve_project_by_cwd(&conn, cwd) {
                self.adopt_project(&conn, &pid);
            }
        }
    }

    /// Apply scaled decay to one project's health (active project tracked in
    /// `self.health`; others read/written straight to the DB).
    fn decay_project(&mut self, conn: &Connection, pid: &str, today: &str, decay: f64) {
        if self.project_id.as_deref() == Some(pid) {
            self.health = (self.health - decay).clamp(0.0, 1.0);
        } else {
            let (h, day) = db::load_health(conn, pid);
            let base = if day != today { RESET_BASELINE } else { h };
            db::save_health(conn, pid, (base - decay).clamp(0.0, 1.0), today);
        }
    }

    pub fn tick(&mut self, app: &AppHandle) {
        let now = Instant::now();
        let dt = (now - self.last_tick).as_secs_f64();
        self.last_tick = now;

        let s = settings::load(&self.config_dir);
        let snap = watcher::snapshot();
        let class = watcher::classify(&snap.app_name, &s);
        let today = Local::now().format("%Y-%m-%d").to_string();

        if self.project_id.is_none() {
            if let Ok(conn) = db::open(&self.db_path) {
                if let Some(pid) = db::most_recent_project(&conn) {
                    self.adopt_project(&conn, &pid);
                }
            }
        }

        if self.last_reset_day != today {
            self.health = RESET_BASELINE;
            self.last_reset_day = today.clone();
        }

        // drop abandoned sessions, then summarize what's still waiting
        self.waiting.retain(|_, w| (now - w.since).as_secs() <= ABANDON_SECS);
        let grace = s.sensitivity.grace_secs.max(0) as u64;
        let sessions: Vec<(Option<String>, u64)> = self
            .waiting
            .values()
            .map(|w| (w.project_id.clone(), (now - w.since).as_secs()))
            .collect();
        let (waiting_count, per_project, longest) = waiting_load(&sessions, grace);

        let paused = settings::is_paused(&s);
        let idle = snap.idle_secs > s.sensitivity.idle_threshold_secs as u64;
        let dts = dt.round() as i64;
        let conn = db::open(&self.db_path).ok();

        if paused || idle {
            // freeze every waiting clock so a break/away doesn't age the wait
            let frozen = Duration::from_secs_f64(dt);
            for w in self.waiting.values_mut() {
                w.since += frozen;
            }
            self.state = (if paused { "paused" } else { "idle" }).to_string();
            if idle && !paused {
                if let (Some(c), Some(pid)) = (&conn, self.project_id.clone()) {
                    db::add_drift(c, &pid, &today, 0, 0, dts);
                }
            }
        } else {
            match class {
                AppClass::Work => {
                    self.state = "growing".to_string();
                    self.health += s.sensitivity.recovery_per_min * dt / 60.0;
                    if let (Some(c), Some(pid)) = (&conn, self.project_id.clone()) {
                        db::add_drift(c, &pid, &today, dts, 0, 0);
                    }
                }
                AppClass::Distraction if waiting_count > 0 => {
                    self.state = "drifting".to_string();
                    if let Some(c) = &conn {
                        for (key, k) in &per_project {
                            let drift = dts * *k;
                            let decay = s.sensitivity.decay_per_min * (dt / 60.0) * (*k as f64);
                            let pid = if key == "_" {
                                self.project_id.clone()
                            } else {
                                Some(key.clone())
                            };
                            if let Some(pid) = pid {
                                db::add_drift(c, &pid, &today, 0, drift, 0);
                                self.decay_project(c, &pid, &today, decay);
                            }
                        }
                    }
                }
                _ => {
                    // distraction while Claude is still busy, or a neutral app → hold
                    self.state = "growing".to_string();
                }
            }
        }

        self.health = self.health.clamp(0.0, 1.0);
        if let (Some(c), Some(pid)) = (&conn, self.project_id.clone()) {
            db::save_health(c, &pid, self.health, &today);
        }

        // gentle drift-moment: once per session, after grace + sustained drift
        if self.state == "drifting" {
            let mut fire = false;
            for w in self.waiting.values_mut() {
                let elapsed = (now - w.since).as_secs();
                if elapsed <= ABANDON_SECS && !w.notified && elapsed >= grace + 60 {
                    w.notified = true;
                    fire = true;
                }
            }
            if fire {
                let _ = app.emit("drift-moment", self.build_tick(&snap, class, longest, waiting_count));
                if s.drift_moment_intensity != "passive" {
                    notify::drift(app, &snap.app_name, &self.project_name);
                }
            }
        }

        let _ = app.emit("focus-tick", self.build_tick(&snap, class, longest, waiting_count));
    }

    fn build_tick(
        &self,
        snap: &watcher::Snapshot,
        class: AppClass,
        since_stop: Option<u64>,
        waiting_sessions: i64,
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
            active_project_name: if self.project_name.is_empty() {
                None
            } else {
                Some(self.project_name.clone())
            },
            cloud_health: self.health,
            seconds_since_claude_finished: since_stop.map(|x| x as i64),
            waiting_sessions,
        }
    }
}

/// Spawn the ~2s watcher loop.
pub fn start_watcher(app: AppHandle, runtime: Arc<Mutex<DriftRuntime>>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        if let Ok(mut rt) = runtime.lock() {
            rt.tick(&app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_waiting_session_is_one_x() {
        let (total, per_project, longest) =
            waiting_load(&[(Some("A".to_string()), 100)], 90);
        assert_eq!(total, 1);
        assert_eq!(per_project.get("A"), Some(&1));
        assert_eq!(longest, Some(100));
    }

    #[test]
    fn multiplier_counts_past_grace_sessions_per_project() {
        let sessions = vec![
            (Some("A".to_string()), 120),
            (Some("A".to_string()), 100),
            (Some("B".to_string()), 200),
            (Some("A".to_string()), 30),   // under grace — excluded from counts
            (Some("B".to_string()), 5000), // abandoned — excluded entirely
        ];
        let (total, per_project, longest) = waiting_load(&sessions, 90);
        assert_eq!(total, 3); // 2×A + 1×B past grace
        assert_eq!(per_project.get("A"), Some(&2));
        assert_eq!(per_project.get("B"), Some(&1));
        assert_eq!(longest, Some(200)); // 5000 abandoned → excluded from longest
    }

    #[test]
    fn empty_session_id_buckets_under_fallback() {
        let (total, per_project, _) =
            waiting_load(&[(None, 100), (None, 100)], 90);
        assert_eq!(total, 2);
        assert_eq!(per_project.get("_"), Some(&2));
    }

    #[test]
    fn sub_grace_only_yields_zero_multiplier() {
        let (total, per_project, longest) =
            waiting_load(&[(Some("A".to_string()), 10)], 90);
        assert_eq!(total, 0);
        assert!(per_project.is_empty());
        assert_eq!(longest, Some(10)); // still drives the away-timer
    }
}
```

- [ ] **Step 4: Run the unit tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml waiting_load`
Expected: the 4 `tests::*` cases PASS (`one_waiting_session_is_one_x`, `multiplier_counts_past_grace_sessions_per_project`, `empty_session_id_buckets_under_fallback`, `sub_grace_only_yields_zero_multiplier`).

- [ ] **Step 5: Build the whole backend**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS (the new `handle_stop`/`handle_reengage` signatures match the `events_tail.rs` callers; `FocusTickDto` has `waiting_sessions`). Gate / commit msg: `feat: per-session additive drift with scaled per-project decay`.

---

## Task 9: Backend — `nube_set_paused` command (companion pause)

**Files:**
- Modify: `src-tauri/src/commands.rs` (add `nube_set_paused`)
- Modify: `src-tauri/src/lib.rs:132-150` (register it in `generate_handler!`)

- [ ] **Step 1: Add the command**

In `src-tauri/src/commands.rs`, add (near the other `save_settings`/window commands):

```rust
/// Toggle indefinite drift-tracking pause. true → far-future pauseUntil
/// (matches Settings' PAUSE_SENTINEL); false → clear it. Read by the drift loop
/// each tick, so it takes effect within ~2s for every window.
#[tauri::command]
pub fn nube_set_paused(state: State<AppState>, paused: bool) {
    let mut s = crate::settings::load(&state.config_dir);
    s.pause_until = if paused {
        Some("9999-12-31T23:59:59Z".to_string())
    } else {
        None
    };
    crate::settings::save(&state.config_dir, &s);
}
```

- [ ] **Step 2: Register it**

In `src-tauri/src/lib.rs`, add `commands::nube_set_paused,` to the `tauri::generate_handler![…]` list (e.g. right after `commands::nube_hide_takeover,`):

```rust
            commands::nube_open_main,
            commands::nube_set_companion,
            commands::nube_show_takeover,
            commands::nube_hide_takeover,
            commands::nube_set_paused,
        ])
```

(No `capabilities/default.json` change is needed — app-defined commands aren't gated by the Tauri v2 permission system; that's why `nube_open_main` already works from the companion window.)

- [ ] **Step 3: Verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS.
Manual (optional, full stack): `npm run tauri dev` → enable the companion (Settings → desktop companion), click its `⏸` → within ~2 s the companion shows "paused · resting" and Home's status calms; click **resume** → tracking continues. Gate / commit msg: `feat: nube_set_paused command for companion pause`.

---

## Task 10 (optional polish): "N sessions waiting" chip on Home

**Files:**
- Modify: `src/pages/Home.tsx` (status strip)

- [ ] **Step 1: Read the count**

In `src/pages/Home.tsx`, inside `export function Home()`, add near the other derived values (after `const secs = …`):

```ts
  const waiting = demoPhase ? 0 : tick.waitingSessions ?? 0
```

- [ ] **Step 2: Show the chip in the status strip**

In the status-strip `<div>` (the pill at top-left with `meta.head`), add the chip after the `<span … >{meta.head}</span>`:

```tsx
          {waiting > 1 && (
            <span style={{ fontWeight: 700, fontSize: 11, color: SUB, background: 'rgba(120,100,170,.12)', borderRadius: 99, padding: '2px 8px', whiteSpace: 'nowrap' }}>{waiting} waiting</span>
          )}
```

- [ ] **Step 3: Verify**

Run: `npm run build && npm run lint`
Expected: PASS. Gate / commit msg: `feat: show concurrent-waiting-session count on Home`.

---

## Final verification (after all tasks)

- [ ] `npm run build` — clean (tsc + vite).
- [ ] `npm run lint` — clean.
- [ ] `cargo build --manifest-path src-tauri/Cargo.toml` — clean.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` — passes (incl. the new `waiting_load` tests and the existing `hooks_installer` test).
- [ ] `grep -rn "remindMin\|aggression\|pages/Projects" src` — no matches.
- [ ] `npm run dev` — sidebar is **Home · Insights · Settings**; Insights shows the clickable project list with **info** buttons; project detail is creature-free and returns to Insights; Settings has the indefinite pause toggle, no reminder/aggression; the companion route renders a pause control.
- [ ] (full stack) `npm run tauri dev` — pausing from the companion flips `state:"paused"` within ~2 s and halts drift; resuming continues; two concurrent waiting sessions on a distraction app double the recorded "Claude waited".

---

## Self-Review notes (author check vs. spec)

- **Spec A (nav/routes):** Task 4. ✓  **Spec B (Insights merge):** Task 2. ✓  **Spec C (detail no-nube):** Task 3. ✓
- **Spec D (Settings trim + pause):** Tasks 5 & 6. ✓  **Spec E (companion pause):** Tasks 7 & 9. ✓
- **Spec F (per-session drift, scaled decay, pause/idle freeze, abandon TTL, `waitingSessions`):** Tasks 1, 8, 9. ✓
- **Type consistency:** `waitingSessions` (TS) ↔ `waiting_sessions` (Rust camelCase serde) ↔ `tick.waitingSessions` (Companion/Home). `setPaused` (rescue.ts) ↔ `nube_set_paused` (commands.rs/lib.rs). `PAUSE_SENTINEL` (derive.ts) value equals the Rust string in `nube_set_paused`. `handle_stop(&str,&str)`/`handle_reengage(&str,&str)` match the `events_tail.rs` callers.
- **No placeholders:** every code step contains full content; no TBD/TODO.
