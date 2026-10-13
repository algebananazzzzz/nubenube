// Shared domain types; mirror the Rust DTOs (serde camelCase).

export type FocusStateName = 'idle' | 'timer' | 'timerDrift' | 'drift'

export type Day = {
  focus: number
  distract: number
  earned: number // rest earned, bonuses included
  spent: number // rest spent, in-timer penalty included
  target: number | null
  hit: boolean
  bonus: number // the daily-target bonus counted in `earned`
  restPlan: number
}

export type FocusTick = {
  state: FocusStateName
  app: string
  away: boolean
  left: number
  len: number
  run: number // seconds of unbroken focus in the running timer
  pending: number // finish bonus accrued so far
  weekday: number // 0 = Monday
  week: Day[]
  bank: number
}

export type FocusEvent =
  | { kind: 'timerFinished'; earned: number; bonus: number }
  | { kind: 'targetHit'; bonus: number }

export type AppClass = 'work' | 'neutral' | 'rest'

export type Site = { domain: string; class: AppClass }

export type Settings = {
  apps: Record<string, AppClass>
  sites: Site[]
  shield: { enabled: boolean; subdomains: boolean; dohGuard: boolean }
  ratio: number
  penalty: number
  targetBonusMin: number
  presets: number[]
  finishEvery: number
}

export type RangeKey = 'today' | 'week' | 'month'

export type SeriesPoint = { label: string; focus: number; distract: number; present: boolean; future: boolean }

export type AppSlice = { name: string; secs: number }

export type Insights = {
  range: RangeKey
  series: SeriesPoint[]
  earned: number
  spent: number
  targetsHit: number
  targetDays: number
  focusApps: AppSlice[]
  restApps: AppSlice[]
}

export type KnownApp = { name: string; lastSeen: string }
