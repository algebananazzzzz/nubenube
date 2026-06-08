// Bridges the backend FocusTick (src/types.ts) + theme pref into NubeState, the
// view-model components consume: life→mood/sky, drift→countdown, live timers.

import { useFocus } from '../store/focus'
import { usePrefs, type Theme } from '../store/prefs'
import { useSettings } from '../store/settings'
import { useBudgetClock, useCountUp } from './useCountdown'
import { hueClay, lifeTint, sessionTier, type Clay } from './clay'
import type { FocusState, FocusTick } from '../types'

const NO_WORK_APPS: string[] = [] // stable ref so an unloaded settings store doesn't churn renders

export const BASELINE = 100
export const CAP = 300

export type Mood = 'thriving' | 'content' | 'alert' | 'worried' | 'gasping' | 'fading' | 'faint'
export type Sky = 'good' | 'working' | 'alert' | 'worried' | 'danger' | 'calm' | 'idle' | 'fading' | 'faint'

// mood is a function of life only (not the clock). Above baseline it tracks the
// banked fraction toward `cap` (not an absolute point), so the top "thriving"
// face scales with whatever the cap is — reached once you're in the top half of
// the burst range (≥200% at the default 300 cap).
export function deriveMood(life: number, cap = CAP): Mood {
  const over = cap > BASELINE ? (life - BASELINE) / (cap - BASELINE) : 0
  if (over >= 0.5) return 'thriving'
  if (life >= BASELINE) return 'content'
  if (life >= 80) return 'alert'
  if (life >= 55) return 'worried'
  if (life >= 30) return 'gasping'
  if (life >= 8) return 'fading'
  return 'faint'
}

// sky = status tint behind the creature; low life overrides state
export function deriveSky(life: number, state: FocusState): Sky {
  if (life < 8) return 'faint'
  if (life < 30) return 'fading'
  switch (state) {
    case 'vibing': return life >= 100 ? 'good' : 'working'
    case 'waiting': return 'alert'
    case 'drifting': return life < 55 ? 'danger' : 'worried'
    case 'chillin': return 'alert'
    default: return 'idle'
  }
}

export function fmtClock(secs: number): string {
  secs = Math.max(0, Math.round(secs))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

// digital countdown — M:SS or H:MM:SS
export function fmtCountdown(secs: number): string {
  secs = Math.max(0, Math.round(secs))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export type Status = { label: string; tone: string; pulse: boolean }

// label = literal state word; distraction states append the app name
export function statusFor(state: FocusState, appName: string | null): Status {
  const app = appName || 'a distraction'
  switch (state) {
    case 'vibing': return { label: 'Vibing', tone: 'var(--success)', pulse: true }
    case 'waiting': return { label: 'Waiting', tone: 'var(--accent)', pulse: true }
    case 'drifting': return { label: `Drifting · ${app}`, tone: 'var(--critical)', pulse: true }
    case 'chillin': return { label: `Chillin · ${app}`, tone: 'var(--teal)', pulse: false }
    default: return { label: 'Idle', tone: 'var(--faint)', pulse: false }
  }
}

// title = state word; line = one-sentence explanation
export function cueFor(s: NubeState): { title: string; line: string } {
  const app = s.appName || 'a distraction'
  switch (s.effState) {
    case 'drifting': return { title: `Drifting · ${app}`, line: `Claude is waiting while you're on ${app} — budget draining fast.` }
    case 'chillin': return { title: `Chillin · ${app}`, line: `You're on ${app} — spending today's distraction budget.` }
    case 'waiting': return { title: 'Waiting', line: 'Claude finished and is waiting on you.' }
    case 'vibing': return { title: 'Vibing', line: 'Claude is working for you — Nube is banking life.' }
    default: return { title: 'Idle', line: 'No Claude sessions right now.' }
  }
}

// secondary metric caption (count), keyed by state
export function timerFor(s: NubeState): string {
  if (s.effState === 'vibing') return `${s.run} running`
  if (s.effState === 'waiting') return `${s.wait} waiting`
  return ''
}

export type NubeState = {
  tick: FocusTick
  theme: Theme
  life: number
  baseline: number
  cap: number
  effState: FocusState
  appName: string | null
  run: number
  wait: number
  // live (ticking) "today" totals for the Home timers:
  work: number // session-weighted Claude-working secs (faster with more windows)
  distracted: number // seconds on a distraction
  workApp: number // seconds the foreground was a work app today
  mood: Mood
  sky: Sky
  clay: Clay
  glow: boolean // session tier 4+ — creature gets an aura
  budgetLeft: number // seconds of daily distraction budget remaining (smoothed)
  budgetTotal: number // full budget in seconds (baseline level)
  fainting: boolean
  fmtClock: typeof fmtClock
  fmtCountdown: typeof fmtCountdown
}

export function useNube(): NubeState {
  const tick = useFocus((s) => s.tick)
  const theme = usePrefs((s) => s.theme)

  const rawLife = tick.cloudHealth
  const baseline = tick.baseline || BASELINE
  const cap = tick.cap || CAP
  const effState = tick.state
  const appName = tick.appName?.trim() ? tick.appName.trim() : null
  const run = tick.runningSessions ?? 0
  const wait = tick.waitingSessions ?? 0
  const distract = tick.distractSecsToday ?? 0
  // Creature color is driven by concurrent sessions (running + waiting), not the
  // project hue — more sessions warm + saturate the clay to reward fanning out.
  const tier = sessionTier(run + wait)

  // Budget = life viewed in minutes: budgetLeft = (life/baseline)·budgetTotal,
  // banked above 100% up to the 300% cap. The shown life snaps to each backend
  // tick (no countdown animation); the budget timer interpolates between ticks
  // from the signed backend rate so "Xm left" ticks down smoothly.
  const life = rawLife
  const frozen = tick.frozen ?? false
  const budgetTotal = tick.budgetTotalSecs ?? 0
  const ratePerMin = tick.budgetRatePerMin ?? 0
  const budgetAnchor = baseline > 0 ? (life / baseline) * budgetTotal : 0
  const budgetLeft = useBudgetClock(budgetAnchor, frozen ? 0 : ratePerMin / 60)
  // fainting tracks the authoritative life meter, not the budget scale (which is
  // 0 until a fresh backend reports budgetTotalSecs — don't read that as spent).
  const fainting = life <= 0

  const { satMul, ltAdd } = lifeTint(life, baseline, cap)
  const clay = hueClay(tier.hue, satMul * tier.satScale, ltAdd)
  const mood = deriveMood(life, cap)
  const sky = deriveSky(life, effState)

  // Anchored to the backend totals; ticks locally each second while the state is
  // active so the Home clocks advance smoothly between ~2s backend updates.
  const onDistraction = effState === 'drifting' || effState === 'chillin'
  const work = useCountUp(tick.workSecsToday ?? 0, !frozen ? run : 0) // +run/sec
  const distracted = useCountUp(distract, onDistraction ? 1 : 0)
  const workApps = useSettings((st) => st.settings?.workApps) ?? NO_WORK_APPS
  const onWorkApp = !!appName && workApps.some((w) => w.toLowerCase() === appName.toLowerCase())
  const workApp = useCountUp(tick.workAppSecsToday ?? 0, !frozen && onWorkApp ? 1 : 0)

  return {
    tick, theme, life, baseline, cap, effState, appName,
    run, wait, work, distracted, workApp,
    mood, sky, clay, glow: tier.glow,
    budgetLeft, budgetTotal, fainting,
    fmtClock, fmtCountdown,
  }
}
