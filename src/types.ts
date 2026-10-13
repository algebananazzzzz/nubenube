// Shared domain types; mirror the Rust DTOs (serde camelCase).

export type FocusStateName = 'idle' | 'timer' | 'drift'

export type Day = {
  focus: number
  distract: number
  earned: number // rest earned, bonuses included
  spent: number // rest spent on Rest apps and sites
  target: number | null
  hit: boolean
  bonus: number // the daily-target bonus counted in `earned`
  restPlan: number
}

export type FocusTick = {
  state: FocusStateName
  app: string
  appClass: AppClass
  away: boolean
  left: number
  len: number
  run: number // seconds of unbroken focus in the running timer
  pending: number // finish bonus accrued so far
  weekday: number // 0 = Monday
  week: Day[]
  bank: number // may go negative
  extension: boolean // the browser extension is connected
}

export type FocusEvent =
  | { kind: 'timerFinished'; earned: number; bonus: number }
  | { kind: 'targetHit'; bonus: number }

export type AppClass = 'work' | 'neutral' | 'rest'

export type Site = { domain: string; class: AppClass }

export type Settings = {
  apps: Record<string, AppClass>
  sites: Site[]
  blockSites: boolean
  ratio: number
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

export type TrackingHelper = 'ok' | 'missing' | 'pending'
