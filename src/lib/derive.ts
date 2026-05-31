// derive.ts — the bridge between the REAL backend data (src/types.ts, emitted by
// the Rust drift/connector layer) and the prototype's visual states. This is what
// makes the candy UI run on live data instead of mocks.

import type { FocusTick, Project, TokenBreakdown } from '../types'
import { hueClay } from './clay'

// ── shared visual vocabularies (NubeCreature + Biome import these) ──
export type NubeMood =
  | 'thriving'
  | 'content'
  | 'alert'
  | 'worried'
  | 'gasping'
  | 'fading'
  | 'faint'

export type SkyState =
  | 'calm'
  | 'working'
  | 'alert'
  | 'worried'
  | 'danger'
  | 'fading'
  | 'faint'
  | 'mint'

// The live "home" phase. Derived from a FocusTick; drives Home, Companion, Takeover.
export type Phase = 'working' | 'idle' | 'waiting' | 'draining' | 'critical' | 'fading' | 'faint'

export const BASE_LIFE = 70 // cloudHealth resets daily to 0.70 → 70% base life

/** Indefinite pause marker stored in Settings.pauseUntil; resume clears it to null. */
export const PAUSE_SENTINEL = '9999-12-31T23:59:59Z'

type PhaseMeta = {
  mood: NubeMood
  sky: SkyState
  dot: string
  head: string
  sub: string
  cta: string | null
  distract: boolean
  glow: number // hue used for ambient accenting
}

export const PHASE_META: Record<Phase, PhaseMeta> = {
  working: {
    mood: 'thriving', sky: 'working', dot: '#54c489', glow: 158, distract: false,
    head: 'In flow — Nube is thriving', sub: 'every focused minute feeds Nube — life is climbing', cta: null,
  },
  idle: {
    mood: 'content', sky: 'calm', dot: '#a18fd6', glow: 268, distract: false,
    head: 'All calm — Nube is napping', sub: 'resting at base life · do some work to earn more', cta: null,
  },
  waiting: {
    mood: 'alert', sky: 'alert', dot: '#6f9be0', glow: 210, distract: false,
    head: 'Claude finished — Nube is waiting', sub: 'hop back before its earned life drains away', cta: "I'm back",
  },
  draining: {
    mood: 'worried', sky: 'worried', dot: '#e0a23a', glow: 44, distract: true,
    head: 'You drifted away', sub: 'Nube is weeping — already losing life', cta: 'Back to Claude',
  },
  critical: {
    mood: 'gasping', sky: 'danger', dot: '#ec7a4a', glow: 26, distract: true,
    head: 'Nube is gasping for focus', sub: '2+ min away · shrinking fast', cta: 'Rescue Nube',
  },
  fading: {
    mood: 'fading', sky: 'fading', dot: '#d07a6a', glow: 12, distract: true,
    head: 'Nube is drying to a tadpole', sub: '5+ min away · almost gone', cta: 'Save Nube now',
  },
  faint: {
    mood: 'faint', sky: 'faint', dot: '#9a93a8', glow: 268, distract: false,
    head: 'Nube has fainted', sub: 'revive by getting back to work (~10 min of focus)', cta: 'Start a focus session',
  },
}

/** Map a live FocusTick onto one of the seven phases.
    Per the product intent, the urgent states only happen when you've drifted to a
    *distraction* app while Claude waits — never while you're at your desk or on a break. */
export function phaseFromTick(t: FocusTick): Phase {
  const h = t.cloudHealth ?? BASE_LIFE / 100
  if (h <= 0.02) return 'faint'
  const ss = t.secondsSinceClaudeFinished ?? null
  const distracted = t.appClass === 'distraction'
  switch (t.state) {
    case 'drifting':
      // on a distraction app after grace — escalate by how long Claude has waited
      if (ss != null && ss >= 300) return 'fading'
      if (ss != null && ss >= 120) return 'critical'
      return 'draining'
    case 'grace':
      // Claude just finished; only nudge if you're already in a distraction app
      return distracted ? 'waiting' : 'working'
    case 'paused':
    case 'idle':
      // an explicit break or away-from-keyboard is always resting — never a takeover
      return 'idle'
    case 'growing':
      return 'working'
    default:
      return 'idle'
  }
}

export function lifeFromHealth(h: number): number {
  return Math.max(0, Math.min(100, Math.round((h ?? 0) * 100)))
}
/** Life earned above the daily base (0..30). */
export function earnedFromHealth(h: number): number {
  return Math.max(0, lifeFromHealth(h) - BASE_LIFE)
}
/** How far below base life the Nube has drained (0..70). */
export function belowBaseFromHealth(h: number): number {
  return Math.max(0, BASE_LIFE - lifeFromHealth(h))
}

/** Lifetime water → bloop scale multiplier (sqrt curve, like the prototype). */
export function sizeFor(waterMl: number, maxWaterMl: number): number {
  const t = Math.min(1, Math.max(0, waterMl / (maxWaterMl || 1)))
  return 0.62 + 0.44 * Math.sqrt(t)
}

/** A project's resting mood, from its (daily-resetting) cloudHealth. */
export function moodFromHealth(h: number): NubeMood {
  if (h <= 0.02) return 'faint'
  if (h < 0.2) return 'fading'
  if (h < 0.4) return 'gasping'
  if (h < 0.58) return 'worried'
  if (h < 0.78) return 'content'
  return 'thriving'
}

export type ProjectStatus = { mood: NubeMood; dot: string; label: string; attn: boolean }

/** Status chip + dot for a project card / row. */
export function projectStatus(p: Project): ProjectStatus {
  const h = p.cloudHealth
  if (h <= 0.05) return { mood: 'faint', dot: '#cf8a4a', label: 'fainted', attn: true }
  if (h >= 0.82) return { mood: 'thriving', dot: '#54c489', label: 'thriving', attn: false }
  if (h < 0.4) return { mood: moodFromHealth(h), dot: '#e0a23a', label: 'needs you', attn: true }
  return { mood: moodFromHealth(h), dot: '#a18fd6', label: 'resting', attn: false }
}

export type TokenSeg = { key: keyof TokenBreakdown; label: string; value: number; color: string }

/** Token composition → donut/legend segments. `value` is in MILLIONS of tokens.
    Note the prototype's "cache write" == the backend's `cacheCreate`. */
export function tokenSegs(t: TokenBreakdown, hue: number): TokenSeg[] {
  const c = hueClay(hue)
  const M = (n: number) => (n || 0) / 1e6
  return [
    { key: 'cacheRead', label: 'cache read', value: M(t.cacheRead), color: c.deep },
    { key: 'input', label: 'input', value: M(t.input), color: c.mid },
    { key: 'output', label: 'output', value: M(t.output), color: c.light },
    { key: 'cacheCreate', label: 'cache write', value: M(t.cacheCreate), color: `hsl(${hue} 30% 84%)` },
  ]
}

export const sumTokenM = (t: TokenBreakdown): number =>
  ((t.input || 0) + (t.output || 0) + (t.cacheCreate || 0) + (t.cacheRead || 0)) / 1e6

/** Clock for the away-from-Claude timer. m:ss under an hour, h:mm:ss above. */
export function mmss(secs: number): string {
  const s = Math.max(0, Math.round(secs))
  const sec = s % 60
  if (s >= 3600) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${Math.floor(s / 60)}:${String(sec).padStart(2, '0')}`
}

/** Local time-of-day greeting for Home. */
export function greeting(d = new Date()): string {
  const h = d.getHours()
  if (h < 12) return 'good morning'
  if (h < 18) return 'good afternoon'
  return 'good evening'
}
