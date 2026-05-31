// Deterministic mock data so every page is fully navigable before the Rust
// connector is wired (and as a fallback when running outside Tauri / in a
// browser). The shapes match src/types.ts exactly.

import type {
  ConnectionStatus,
  DayPoint,
  FocusTick,
  HourPoint,
  Insights,
  Project,
  RangeKey,
  Settings,
  TokenBreakdown,
  Totals,
} from '../types'
import { waterMlFromTokens, DEFAULT_WATER_RATES } from '../theme/units'

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

type Seed = { name: string; hue: number; scale: number; days: number }
const PROJECT_SEEDS: Seed[] = [
  { name: 'nubenube', hue: 205, scale: 1.0, days: 6 },
  { name: 'intranet-next-app', hue: 150, scale: 3.1, days: 58 },
  { name: 'reboks-booking', hue: 320, scale: 4.0, days: 41 },
  { name: 'afflux', hue: 28, scale: 2.4, days: 70 },
  { name: 'federation', hue: 260, scale: 1.6, days: 33 },
  { name: 'vpc', hue: 96, scale: 0.7, days: 19 },
  { name: 'domain-skills-creator', hue: 185, scale: 0.9, days: 24 },
  { name: 'kelemetry-vault', hue: 12, scale: 0.5, days: 12 },
  { name: 'exam-wiki', hue: 45, scale: 0.4, days: 9 },
  { name: 'algebananazzzzz', hue: 110, scale: 0.3, days: 5 },
]

const N_DAYS = 35

// Deterministic per-project health so the sample grid shows the full mood ladder
// (thriving · content · needs-you · fainted) instead of one muddy band.
const MOCK_HEALTH = [0.92, 0.74, 0.87, 0.31, 0.0, 0.7, 0.55, 0.63, 0.44, 0.82]

function tokensFor(totalTokens: number, msgCount: number): TokenBreakdown {
  // Mirrors the verified real distribution: cache_read ~95–97% of mass,
  // cache_create ~2–3%, output ~1%, input ~ msgCount (broken placeholder).
  return {
    cacheRead: Math.round(totalTokens * 0.955),
    cacheCreate: Math.round(totalTokens * 0.03),
    output: Math.round(totalTokens * 0.014),
    input: msgCount,
  }
}

function buildProject(seed: Seed, idx: number): { project: Project; byDay: DayPoint[] } {
  const rnd = mulberry32(1000 + idx * 7)
  const today = new Date()
  const byDay: DayPoint[] = []
  let lifetimeTokens = 0
  let lifetimeMsgs = 0

  for (let i = N_DAYS - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const active = i < seed.days // project only existed for `days`
    const dow = d.getDay()
    const weekend = dow === 0 || dow === 6 ? 0.35 : 1
    const noise = 0.4 + rnd() * 1.2
    const dayTokens = active ? Math.round(seed.scale * 9.0e6 * weekend * noise) : 0
    const msgs = active ? Math.round(seed.scale * 120 * weekend * noise) : 0
    const tk = tokensFor(dayTokens, msgs)
    const claudeActiveSecs = active ? Math.round(seed.scale * 2400 * weekend * noise) : 0
    const driftSecs = active ? Math.round(claudeActiveSecs * (0.12 + rnd() * 0.5)) : 0
    lifetimeTokens += dayTokens
    lifetimeMsgs += msgs
    byDay.push({
      day: ymd(d),
      waterMl: waterMlFromTokens(tk),
      tokens: tk,
      driftSecs,
      claudeActiveSecs,
    })
  }

  const lifeTokens = tokensFor(lifetimeTokens, lifetimeMsgs)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const monthMl = byDay
    .filter((d) => new Date(d.day) >= monthStart)
    .reduce((s, d) => s + d.waterMl, 0)
  const todayPoint = byDay[byDay.length - 1]

  const project: Project = {
    id: `proj_${seed.name}`,
    name: seed.name,
    rootPath: `/Users/bytedance/${seed.name.replace(/-vault$/, '.vault')}`,
    colorHue: seed.hue,
    firstSeenUtc: byDay.find((d) => d.waterMl > 0)?.day ?? ymd(today),
    lastSeenUtc: new Date().toISOString(),
    tokens: lifeTokens,
    waterMl: waterMlFromTokens(lifeTokens),
    monthlyWaterMl: monthMl,
    todayWaterMl: todayPoint.waterMl,
    cloudHealth: MOCK_HEALTH[idx] ?? Math.max(0.18, Math.min(0.99, 0.55 + (rnd() - 0.4) * 0.9)),
    driftSecsToday: todayPoint.driftSecs,
    claudeActiveSecsToday: todayPoint.claudeActiveSecs,
    msgCount: lifetimeMsgs,
    last7: byDay.slice(-7).map((d) => d.waterMl),
  }
  return { project, byDay }
}

const built = PROJECT_SEEDS.map(buildProject)
export const mockProjects: Project[] = built.map((b) => b.project)
const dayMap = new Map(built.map((b, i) => [mockProjects[i].id, b.byDay]))

function sumTokens(list: TokenBreakdown[]): TokenBreakdown {
  return list.reduce(
    (a, t) => ({
      input: a.input + t.input,
      output: a.output + t.output,
      cacheCreate: a.cacheCreate + t.cacheCreate,
      cacheRead: a.cacheRead + t.cacheRead,
    }),
    { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }
  )
}

export const mockTotals: Totals = {
  waterMl: mockProjects.reduce((s, p) => s + p.waterMl, 0),
  tokens: sumTokens(mockProjects.map((p) => p.tokens)),
  projectCount: mockProjects.length,
  todayWaterMl: mockProjects.reduce((s, p) => s + p.todayWaterMl, 0),
  monthWaterMl: mockProjects.reduce((s, p) => s + p.monthlyWaterMl, 0),
  claudeActiveSecsToday: mockProjects.reduce((s, p) => s + p.claudeActiveSecsToday, 0),
  driftSecsToday: mockProjects.reduce((s, p) => s + p.driftSecsToday, 0),
}

function rangeDays(range: RangeKey): number {
  return range === 'today' ? 1 : range === 'week' ? 7 : range === 'month' ? 30 : N_DAYS
}

export function mockInsights(range: RangeKey): Insights {
  const n = rangeDays(range)
  const allDays: DayPoint[] = []
  // merge per-project days into a global per-day series
  const byDayKey = new Map<string, DayPoint>()
  for (const [, days] of dayMap) {
    for (const d of days.slice(-n)) {
      const cur =
        byDayKey.get(d.day) ??
        ({ day: d.day, waterMl: 0, tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, driftSecs: 0, claudeActiveSecs: 0 } as DayPoint)
      cur.waterMl += d.waterMl
      cur.driftSecs += d.driftSecs
      cur.claudeActiveSecs += d.claudeActiveSecs
      cur.tokens = sumTokens([cur.tokens, d.tokens])
      byDayKey.set(d.day, cur)
    }
  }
  for (const v of [...byDayKey.values()].sort((a, b) => a.day.localeCompare(b.day))) allDays.push(v)

  // hour histogram (drift rhythm + focus windows)
  const byHour: HourPoint[] = Array.from({ length: 24 }, (_, h) => {
    const focus = Math.exp(-((h - 11) ** 2) / 16) + 0.9 * Math.exp(-((h - 16) ** 2) / 10)
    const drift = 0.5 * Math.exp(-((h - 14) ** 2) / 6) + 0.8 * Math.exp(-((h - 21) ** 2) / 8)
    return {
      hour: h,
      waterMl: Math.round(focus * 6_000_000 * (range === 'all' ? 18 : n)),
      driftSecs: Math.round(drift * 900 * (range === 'all' ? 18 : n)),
      count: Math.round(focus * 40),
    }
  })

  const waterMl = allDays.reduce((s, d) => s + d.waterMl, 0)
  const tokens = sumTokens(allDays.map((d) => d.tokens))
  const claudeActiveSecs = allDays.reduce((s, d) => s + d.claudeActiveSecs, 0)
  const driftSecs = allDays.reduce((s, d) => s + d.driftSecs, 0)

  const topProjects = [...mockProjects]
    .map((p) => {
      const ml = (dayMap.get(p.id) ?? []).slice(-n).reduce((s, d) => s + d.waterMl, 0)
      return { id: p.id, name: p.name, waterMl: ml, colorHue: p.colorHue }
    })
    .sort((a, b) => b.waterMl - a.waterMl)
    .slice(0, 6)

  return {
    range,
    waterMl,
    tokens,
    byDay: allDays,
    byHour,
    topProjects,
    claudeActiveSecs,
    driftSecs,
    longestFocusStreakSecs: 2 * 3600 + 14 * 60,
    distractionBreakdown: [
      { name: 'YouTube', secs: 720 },
      { name: 'Reddit', secs: 360 },
      { name: 'TikTok', secs: 180 },
    ],
  }
}

export function mockProjectByDay(id: string): DayPoint[] {
  return dayMap.get(id) ?? []
}

export const mockSettings: Settings = {
  distractionApps: ['TikTok', 'Netflix', 'Steam', 'Discord', 'Twitch'],
  sensitivity: {
    graceSecs: 10,
    decayPerMin: 0.06,
    recoveryPerToken: 0.000004,
    idleThresholdSecs: 120,
    windowGranularity: 'app',
  },
  resetTimeLocal: '05:00',
  pauseUntil: null,
  driftMomentIntensity: 'gentle-notification',
  waterRates: { ...DEFAULT_WATER_RATES },
  logRoots: ['/Users/bytedance/.claude/projects'],
}

export const mockConnection: ConnectionStatus = {
  connected: true,
  logRoots: ['/Users/bytedance/.claude/projects'],
  projectsDetected: 34,
  sessionsScanned: 2441,
  hooksInstalled: false,
  lastScanUtc: new Date().toISOString(),
  naiveDedupRatio: 2.4,
  permissions: { screenRecording: false, automation: false },
}

export const mockFocusTick: FocusTick = {
  ts: new Date().toISOString(),
  appId: 'com.microsoft.VSCode',
  appName: 'Code',
  appClass: 'neutral',
  title: 'lib.rs — nubenube',
  idleSecs: 4,
  state: 'growing',
  activeProjectId: 'proj_nubenube',
  activeProjectName: 'nubenube',
  cloudHealth: 0.82,
  secondsSinceClaudeFinished: 42,
  waitingSessions: 0,
  runningSessions: 1,
  secondsToDeath: undefined,
}
