// Client-side mirror of the economy constants in src-tauri/src/economy.rs, for
// projections the backend doesn't send (bonus forecasts, today's pace). Keep
// FINISH, finishTier and REDLINE_SECS in sync with Rust.

export const FINISH = [1, 1.15, 1.3, 1.5]

export const REDLINE_SECS = 60

export const finishTier = (run: number, every: number) =>
  Math.min(FINISH.length - 1, Math.max(0, Math.floor(run / Math.max(1, every * 60))))
export const finishAt = (run: number, every: number) => FINISH[finishTier(run, every)]

// Bonus still to accrue over `left` seconds, starting from `run` seconds of focus.
export function projectBonus(run: number, left: number, every: number, ratio: number): number {
  let b = 0
  for (let t = 0; t < left; t += 30) b += ((finishAt(run + t, every) - 1) * Math.min(30, left - t)) / ratio
  return b
}

// Timer lengths the UI offers, in minutes (quick starts and the Home stepper).
export const LEN_MIN = 5, LEN_MAX = 180, LEN_STEP = 5
export const clampLen = (v: number) => Math.max(LEN_MIN, Math.min(LEN_MAX, Math.round(v)))

// Creature hue per finish step; also tints the multiplier pips.
export const WARMTH = [{ hue: 243 }, { hue: 190 }, { hue: 150 }, { hue: 40 }]

export type Mood = 'thriving' | 'content' | 'alert' | 'worried' | 'gasping' | 'fading' | 'faint'

export type Phase = {
  key: 'late' | 'behind' | 'track' | 'excellent' | 'none'
  name: string
  tone: string
  hue: number
  sat: number
  glow?: boolean
  mood: Mood
}

const PHASES: Record<Phase['key'], Phase> = {
  late: { key: 'late', name: 'Behind schedule', tone: 'var(--critical)', hue: 22, sat: 1.05, mood: 'worried' },
  behind: { key: 'behind', name: 'Slightly behind', tone: 'var(--warning)', hue: 75, sat: 1, mood: 'alert' },
  track: { key: 'track', name: 'On track', tone: 'var(--success)', hue: 150, sat: 1, mood: 'content' },
  excellent: { key: 'excellent', name: 'Excellent', tone: 'var(--excellent)', hue: 300, sat: 1.15, glow: true, mood: 'thriving' },
  none: { key: 'none', name: 'No target', tone: 'var(--faint)', hue: 243, sat: 1, mood: 'content' },
}

// Is today on track? The target is expected to spread evenly over 09:00–18:00.
export function todayPace(done: number, target: number | null, now = new Date()): Phase & { expected: number } {
  if (!target) return { ...PHASES.none, expected: 0 }
  const dayFrac = Math.max(0, Math.min(1, (now.getHours() + now.getMinutes() / 60 - 9) / 9))
  const expected = target * dayFrac
  const r = expected > 0 ? done / expected : 1
  const p = done >= target || r >= 1.2 ? PHASES.excellent : r >= 0.97 ? PHASES.track : r >= 0.75 ? PHASES.behind : PHASES.late
  return { ...p, expected }
}

export const hpTone = (p: number) => (p >= 0.7 ? 'var(--success)' : p >= 0.3 ? 'var(--warning)' : 'var(--critical)')
