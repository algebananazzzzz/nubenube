// Shared domain types. These mirror the Rust connector's JSON output (M1) so the
// frontend contract is stable whether data comes from `invoke` or the mock layer.

export type TokenBreakdown = {
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
}

export type AppClass = 'work' | 'distraction' | 'neutral'

export type FocusState =
  | 'growing' // focused on work / Claude
  | 'grace' // Claude just finished; brief no-fade window
  | 'drifting' // on a distraction app after grace
  | 'idle' // away from keyboard — health frozen
  | 'paused' // user enabled break/pause mode
  | 'unknown'

export type Project = {
  id: string
  name: string
  rootPath: string
  colorHue: number // 0..360 — neutral now, themeable later
  firstSeenUtc: string
  lastSeenUtc: string
  tokens: TokenBreakdown // lifetime, deduped
  waterMl: number // lifetime, derived from tokens
  monthlyWaterMl: number // current month
  todayWaterMl: number
  cloudHealth: number // 0..1 (resets daily)
  driftSecsToday: number
  claudeActiveSecsToday: number
  msgCount: number
  last7: number[] // trailing 7-day water (mL), oldest→newest — for the card sparkline
}

export type DayPoint = {
  day: string // YYYY-MM-DD (local)
  waterMl: number
  tokens: TokenBreakdown
  driftSecs: number
  claudeActiveSecs: number
}

export type HourPoint = {
  hour: number // 0..23 local
  waterMl: number
  driftSecs: number
  count: number
}

export type Totals = {
  waterMl: number // lifetime, all projects
  tokens: TokenBreakdown
  projectCount: number
  todayWaterMl: number
  monthWaterMl: number
  claudeActiveSecsToday: number
  driftSecsToday: number
}

export type RangeKey = 'today' | 'week' | 'month' | 'all'

export type Insights = {
  range: RangeKey
  waterMl: number
  tokens: TokenBreakdown
  byDay: DayPoint[]
  byHour: HourPoint[]
  topProjects: { id: string; name: string; waterMl: number; colorHue: number }[]
  claudeActiveSecs: number
  driftSecs: number
  longestFocusStreakSecs: number
}

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

export type Sensitivity = {
  graceSecs: number
  decayPerMin: number // health lost per minute of sustained distraction (0..1)
  recoveryPerMin: number // health regained per minute of focus (0..1)
  idleThresholdSecs: number
  windowGranularity: 'app' | 'title'
}

export type DriftMomentIntensity = 'passive' | 'gentle-notification' | 'overlay'

export type Settings = {
  workApps: string[]
  distractionApps: string[]
  neutralApps: string[]
  sensitivity: Sensitivity
  resetTimeLocal: string // "HH:MM"
  pauseUntil: string | null
  driftMomentIntensity: DriftMomentIntensity
  waterRates: { read: number; write: number } // mL per token
  logRoots: string[]
}

export type ConnectionStatus = {
  connected: boolean
  logRoots: string[]
  projectsDetected: number
  sessionsScanned: number
  hooksInstalled: boolean
  lastScanUtc: string | null
  naiveDedupRatio: number | null // self-check: should land ~1.7–3.9
  permissions: { screenRecording: boolean; automation: boolean }
}
