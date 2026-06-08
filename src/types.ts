// Shared domain types; mirror the Rust DTOs (serde camelCase).

export type TokenBreakdown = {
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
}

export type FocusState =
  | 'vibing' // Claude is working for you, nothing waiting (running sessions heal life)
  | 'waiting' // a turn finished; Claude is idle waiting on you — not on a distraction
  | 'drifting' // on a distraction while a turn waits — life drains (countdown)
  | 'chillin' // on a distraction, nothing waiting (named, but no countdown)
  | 'idle' // away / nothing happening — life frozen
  | 'unknown'

export type Project = {
  id: string
  name: string
  rootPath: string
  colorHue: number // 0..360 — drives the swatch / accent / creature tint
  tokens: TokenBreakdown // lifetime, deduped
  waterMl: number // lifetime, derived from tokens
}

export type Totals = {
  waterMl: number // lifetime, all projects
  tokens: TokenBreakdown
  projectCount: number
}

export type RangeKey = 'today' | 'week' | 'month' | 'all'

export type DistractionSlice = { name: string; secs: number }

export type SessionPoint = { label: string; avg: number; distractSecs: number; workSecs?: number; present: boolean; future: boolean }

export type Insights = {
  range: RangeKey
  tokens: TokenBreakdown // token composition for the range
  claudeActiveSecs: number // Claude working
  distractSecs: number // total time on a distraction (honest; matches Home)
  driftSecs: number // drift (distraction while a turn waits)
  workAppSecs: number // total wall-clock time on a work app over the range
  distractionBreakdown: DistractionSlice[]
  avgSessions: number // time-weighted avg concurrent over engaged time in the range
  sessionSeries: SessionPoint[] // time graph over the whole period
}

export type ProjectDetail = {
  id: string
  name: string
  rootPath: string
  colorHue: number
  range: RangeKey
  tokens: TokenBreakdown
  waterMl: number
}

export type FocusTick = {
  ts: string
  state: FocusState
  appName: string
  cloudHealth: number // life on the 0..cap (300) scale (NOT a 0..1 fraction)
  baseline: number // full/par life — always 100
  cap: number // max life incl. banked bonus — always 300
  waitingSessions: number // # Claude sessions stopped-and-waiting (past grace)
  runningSessions: number // # sessions currently running (Claude working)
  budgetTotalSecs: number // today's full budget in secs (baseline level = budget min · 60)
  budgetRatePerMin: number // signed budget-secs gained per min (negative = draining)
  activeSecsToday: number // today's states 1+2+3+4 (engaged or on a distraction)
  distractSecsToday: number // today's states 3+4 (on a distraction)
  workSecsToday: number // session-weighted Claude-working secs (Σ running·dt)
  workAppSecsToday: number // today's wall-clock secs on a work app
  monitoredSecsToday: number // present-&-tracking wall-clock (all but away)
  frozen: boolean // meter frozen (away/idle) — pause live UI timers
}

export type DayOverride = {
  weekday: number // 0=Mon … 6=Sun
  timeToDeathMin: number
  healDrainRatio: number
}

export type Sensitivity = {
  graceSecs: number
  timeToDeathMin: number // daily distraction allowance in minutes (1× drain budget)
  healDrainRatio: number // heal-per-running ÷ drain-per-waiting (default 0.1)
  waitingMultiplier: number // drain ×multiplier while a turn is waiting on you
  idleThresholdSecs: number
  dayOverrides: DayOverride[] // per-weekday overrides of the two rate knobs (empty = same all week)
}

export type Settings = {
  distractionApps: string[]
  workApps: string[]
  sensitivity: Sensitivity
  driftMomentIntensity: 'passive' | 'gentle-notification' | 'overlay'
  logRoots: string[]
  notificationSoundName: string | null
  notificationSoundPath: string | null
}

export type KnownApp = { name: string; lastSeen: string }

export type ConnectionStatus = {
  connected: boolean
  projectsDetected: number
  sessionsScanned: number
  hooksInstalled: boolean
}
