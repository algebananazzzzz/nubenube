// derive.ts — the bridge between the REAL backend data (the Rust drift/connector
// layer, src/types.ts) and the Helios design's visual states. `useNube()`
// composes the live FocusTick + theme pref into the exact shape the ported
// design components expect (the prototype's `useNN()` store).

import { useFocus } from '../store/focus'
import { usePrefs, type Theme } from '../store/prefs'
import { useCountdown, useCountUp } from './useCountdown'
import { rescue } from './rescue'
import { hueClay, moodDrain, DEFAULT_HUE, type Clay } from './clay'
import type { FocusState, FocusTick } from '../types'

export const BASELINE = 100
export const CAP = 130

export type Mood = 'thriving' | 'content' | 'alert' | 'worried' | 'gasping' | 'fading' | 'faint'
export type Sky = 'good' | 'working' | 'alert' | 'worried' | 'danger' | 'calm' | 'idle' | 'fading' | 'faint'

// ── derivation ──────────────────────────────────────────────────
// Mood comes from LIFE (not the clock). cap = 130, baseline = 100.
export function deriveMood(life: number, cap = CAP): Mood {
  if (life >= 0.95 * cap) return 'thriving'
  if (life >= 100) return 'content'
  if (life >= 80) return 'alert'
  if (life >= 55) return 'worried'
  if (life >= 30) return 'gasping'
  if (life >= 8) return 'fading'
  return 'faint'
}

// "sky" → the calm tinted panel behind the creature
export function deriveSky(life: number, state: FocusState): Sky {
  if (life < 8) return 'faint'
  if (life < 30) return 'fading'
  switch (state) {
    case 'vibing': return life >= 100 ? 'good' : 'working'
    case 'waiting': return 'alert'
    case 'drifting': return life < 55 ? 'danger' : 'worried'
    case 'chillin': return 'alert' // on a distraction, but nothing's blocked
    case 'paused': return 'calm'
    default: return 'idle'
  }
}

export const MOOD_LABEL: Record<Mood, string> = {
  thriving: 'Thriving', content: 'Content', alert: 'Perky',
  worried: 'Worried', gasping: 'Gasping', fading: 'Fading', faint: 'Faint',
}

// ── formatters ──────────────────────────────────────────────────
export function fmtClock(secs: number): string {
  secs = Math.max(0, Math.round(secs))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

export function fmtMin(secs: number): string {
  const m = Math.round(secs / 60)
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${m}m`
}

// digital countdown — M:SS (or H:MM:SS)
export function fmtCountdown(secs: number): string {
  secs = Math.max(0, Math.round(secs))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── status / cue / timer ────────────────────────────────────────
export type Status = { label: string; tone: string; toneKind: string; pulse: boolean }

// Labels are the user's own state words — never invented synonyms. The two
// distraction states append the app name (the overlay must name where you are).
export function statusFor(state: FocusState, appName: string | null): Status {
  const app = appName || 'a distraction'
  switch (state) {
    case 'vibing': return { label: 'Vibing', tone: 'var(--success)', toneKind: 'mint', pulse: true }
    case 'waiting': return { label: 'Waiting', tone: 'var(--accent)', toneKind: 'accent', pulse: true }
    case 'drifting': return { label: `Drifting · ${app}`, tone: 'var(--critical)', toneKind: 'danger', pulse: true }
    case 'chillin': return { label: `Chillin · ${app}`, tone: 'var(--teal)', toneKind: 'teal', pulse: false }
    case 'paused': return { label: 'Paused', tone: 'var(--calm)', toneKind: 'calm', pulse: false }
    default: return { label: 'Idle', tone: 'var(--faint)', toneKind: 'neutral', pulse: false }
  }
}

// the one line the user should read first — what to do right now
// Title is always the user's state word; the line just explains what's happening.
export function cueFor(s: NubeState): { title: string; line: string } {
  const app = s.appName || 'a distraction'
  switch (s.effState) {
    case 'paused': return { title: 'Paused', line: 'Tracking is off — nothing counts until you resume.' }
    case 'drifting': return { title: `Drifting · ${app}`, line: `Claude is waiting while you're on ${app} — Nube is draining.` }
    case 'chillin': return { title: `Chillin · ${app}`, line: `You're on ${app}. Nothing is waiting, so Nube is fine.` }
    case 'waiting': return { title: 'Waiting', line: 'Claude finished and is waiting on you.' }
    case 'vibing': return { title: 'Vibing', line: 'Claude is working for you — Nube is banking life.' }
    default: return { title: 'Idle', line: 'No Claude sessions right now.' }
  }
}

// Secondary caption: a metric (count / time), not an alternate state word —
// the state name is already the title.
export function timerFor(s: NubeState): string {
  if (s.paused) return 'frozen'
  if (s.effState === 'drifting') return `${fmtClock(s.secondsToDeath ?? 0)} left`
  if (s.effState === 'vibing') return `${s.run} running`
  if (s.effState === 'waiting') return `${s.wait} waiting`
  return ''
}

// ── the composed live store the design components read ──────────
export type NubeState = {
  tick: FocusTick
  theme: Theme
  hue: number
  life: number
  baseline: number
  cap: number
  effState: FocusState
  appName: string | null
  run: number
  wait: number
  active: number // today's at-machine seconds (includes the distract subset)
  distract: number // today's seconds on a distraction app
  focused: number // active − distract
  focusPct: number // focused / active
  // live (ticking) "today" totals for the Home timers:
  work: number // session-weighted Claude-working secs (faster with more windows)
  distracted: number // seconds on a distraction (states 3+4)
  monitored: number // present-&-tracking seconds (all but paused/away)
  frozen: boolean // meter frozen (paused or away/idle)
  paused: boolean
  togglePause: () => void
  mood: Mood
  moodLabel: string
  sky: Sky
  clay: Clay
  losing: boolean
  secondsToDeath: number | null
  remaining: number | null
  countdownPct: number
  fainting: boolean
  fmtClock: typeof fmtClock
  fmtMin: typeof fmtMin
  fmtCountdown: typeof fmtCountdown
}

export function useNube(): NubeState {
  const tick = useFocus((s) => s.tick)
  const theme = usePrefs((s) => s.theme)

  const life = tick.cloudHealth
  const baseline = tick.baseline || BASELINE
  const cap = tick.cap || CAP
  const effState = tick.state
  const paused = effState === 'paused'
  const appName = tick.appName?.trim() ? tick.appName.trim() : null
  const run = tick.runningSessions ?? 0
  const wait = tick.waitingSessions ?? 0
  const active = tick.activeSecsToday ?? 0
  const distract = tick.distractSecsToday ?? 0
  const focused = Math.max(0, active - distract)
  const focusPct = active > 0 ? focused / active : 0
  const hue = tick.colorHue || DEFAULT_HUE

  const { satMul, ltAdd } = moodDrain(life)
  const clay = hueClay(hue, satMul, ltAdd)
  const mood: Mood = paused
    ? (life >= 100 ? 'content' : life >= 55 ? 'worried' : 'fading')
    : deriveMood(life, cap)
  const sky = paused ? 'calm' : deriveSky(life, effState)

  const secondsToDeath = tick.secondsToDeath ?? null
  const losing = !paused && effState === 'drifting' && secondsToDeath != null
  const remaining = useCountdown(losing ? secondsToDeath : null, losing)
  const countdownPct = losing && secondsToDeath ? Math.max(0, (remaining ?? 0) / secondsToDeath) : 0
  const fainting = remaining != null && remaining <= 0

  // live "today" timers — anchored to the backend totals, ticking locally each
  // second while their state is active (so the Home clocks count smoothly).
  const frozen = tick.frozen ?? paused
  const onDistraction = effState === 'drifting' || effState === 'chillin'
  const work = useCountUp(tick.workSecsToday ?? 0, !frozen ? run : 0) // +run/sec
  const distracted = useCountUp(distract, onDistraction ? 1 : 0)
  const monitored = useCountUp(tick.monitoredSecsToday ?? 0, !frozen ? 1 : 0)

  return {
    tick, theme, hue, life, baseline, cap, effState, appName,
    run, wait, active, distract, focused, focusPct,
    work, distracted, monitored, frozen,
    paused, togglePause: () => { void rescue.setPaused(!paused) },
    mood, moodLabel: MOOD_LABEL[mood], sky, clay,
    losing, secondsToDeath, remaining, countdownPct, fainting,
    fmtClock, fmtMin, fmtCountdown,
  }
}
