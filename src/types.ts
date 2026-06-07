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
  | 'paused' // user enabled break/pause mode
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

export type SessionPoint = { label: string; peak: number; avg: number }

export type Insights = {
  range: RangeKey
  tokens: TokenBreakdown // token composition for the range
  claudeActiveSecs: number // Claude working
  claudeIdleSecs: number // Claude idle, waiting on you
  driftSecs: number // time on distractions
  distractionBreakdown: DistractionSlice[]
  peakSessions: number // max concurrent (running+waiting) over range
  avgSessions: number // time-weighted avg concurrent while engaged
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
  cloudHealth: number // life on the 0..cap (130) scale (NOT a 0..1 fraction)
  baseline: number // full/par life — always 100
  cap: number // max life incl. banked bonus — always 130
  waitingSessions: number // # Claude sessions stopped-and-waiting (past grace)
  runningSessions: number // # sessions currently running (Claude working)
  secondsToDeath?: number | null // honest net-rate countdown; only while net-draining
  activeSecsToday: number // today's states 1+2+3+4 (engaged or on a distraction)
  distractSecsToday: number // today's states 3+4 (on a distraction)
  workSecsToday: number // session-weighted Claude-working secs (Σ running·dt)
  monitoredSecsToday: number // present-&-tracking wall-clock (all but paused/away)
  frozen: boolean // meter frozen (paused or away/idle) — pause live UI timers
  colorHue: number // active project's hue (drives accent + creature tint)
}

export type Sensitivity = {
  graceSecs: number
  timeToDeathMin: number // minutes of one waiting session on a distraction, baseline → 0
  healDrainRatio: number // heal-per-running ÷ drain-per-waiting (default 0.1)
  idleThresholdSecs: number
  windowGranularity: 'app' | 'title'
}

export type Settings = {
  distractionApps: string[]
  sensitivity: Sensitivity
  resetTimeLocal: string // "HH:MM"
  pauseUntil: string | null
  driftMomentIntensity: 'passive' | 'gentle-notification' | 'overlay'
  waterRates: { read: number; write: number }
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
