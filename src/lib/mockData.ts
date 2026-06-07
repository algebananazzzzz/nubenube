// Deterministic mock data so every page is fully navigable before the Rust
// connector is wired (and as a fallback when running outside Tauri / in a
// browser). Seeded with the Helios design's demo values so dev mode mirrors the
// mockups. Shapes match src/types.ts exactly.

import type {
  ConnectionStatus,
  FocusTick,
  Insights,
  KnownApp,
  Project,
  ProjectDetail,
  RangeKey,
  Settings,
  TokenBreakdown,
  Totals,
} from '../types'

// turn "767.0M" / "40.1B" into a number
function parseCount(s: string): number {
  const m = /^([\d.]+)\s*([KMBT]?)$/.exec(s.trim())
  if (!m) return 0
  const n = parseFloat(m[1])
  const mul: Record<string, number> = { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 }
  return n * (mul[m[2]] ?? 1)
}

// a plausible breakdown for a total token count (cache reads dominate)
function breakdown(total: number): TokenBreakdown {
  return {
    cacheRead: Math.round(total * 0.95),
    cacheCreate: Math.round(total * 0.04),
    output: Math.round(total * 0.008),
    input: Math.round(total * 0.002),
  }
}

// research-backed water model — mirrors src-tauri/src/water.rs (Li et al.,
// "Making AI Less Thirsty", arXiv:2304.03271): reading is ~10× cheaper than
// generating. So dev/mock litres match what the real connector computes.
const READ_ML_PER_TOKEN = 0.0002
const WRITE_ML_PER_TOKEN = 0.0015
function waterMlFromTokens(t: TokenBreakdown): number {
  const read = (t.input || 0) + (t.cacheCreate || 0) + (t.cacheRead || 0)
  return READ_ML_PER_TOKEN * read + WRITE_ML_PER_TOKEN * (t.output || 0)
}

const PROJECT_SEED: { name: string; repo: string; tokens: string; hue: number }[] = [
  { name: 'personal-wiki', repo: 'bytedance/personal-wiki', tokens: '767.0M', hue: 330 },
  { name: 'intranet-next-app', repo: 'bytedance/intranet-next-app', tokens: '679.5M', hue: 190 },
  { name: 'NewAffluxWiki', repo: 'Documents/NewAffluxWiki', tokens: '416.8M', hue: 222 },
  { name: 'algebananazzzzz2.0', repo: 'bytedance/algebananazzzzz2.0', tokens: '360.7M', hue: 36 },
  { name: 'AffluxWikiVault', repo: 'Documents/AffluxWikiVault', tokens: '362.4M', hue: 248 },
  { name: 'intranet', repo: 'bytedance/intranet', tokens: '260.9M', hue: 150 },
  { name: 'nubenube', repo: 'bytedance/nubenube', tokens: '223.3M', hue: 270 },
  { name: 'reboks-booking', repo: 'bytedance/reboks-booking', tokens: '191.5M', hue: 358 },
]

export const mockProjects: Project[] = PROJECT_SEED
  .map((p) => {
    const tokens = breakdown(parseCount(p.tokens))
    return { id: p.repo, name: p.name, rootPath: p.repo, colorHue: p.hue, tokens, waterMl: waterMlFromTokens(tokens) }
  })
  .sort((a, b) => b.waterMl - a.waterMl)

const TOTALS_TOKENS = breakdown(40.1e9)
export const mockTotals: Totals = {
  waterMl: waterMlFromTokens(TOTALS_TOKENS),
  tokens: TOTALS_TOKENS,
  projectCount: 26,
}

export const mockInsights = (range: RangeKey): Insights => ({
  range,
  tokens: { cacheRead: 1.3e9, cacheCreate: 56.9e6, output: 9.3e6, input: 1.7e6 },
  claudeActiveSecs: 51 * 60,
  claudeIdleSecs: 1 * 60,
  driftSecs: 36 + 26,
  distractionBreakdown: [
    { name: 'ChatGPT Atlas', secs: 36 },
    { name: 'Telegram', secs: 26 },
  ],
  peakSessions: range === 'today' ? 4 : 5,
  avgSessions: 2.3,
  sessionSeries: range === 'today'
    ? Array.from({ length: 96 }, (_, c) => {
        // 96 × 15-min cells. Demo: app on from 07:00, a 12:00–13:00 gap, active
        // windows 09:00–11:30 and 14:00–18:00, future after the current cell.
        const now = new Date()
        const nowCell = Math.floor((now.getHours() * 60 + now.getMinutes()) / 15)
        const future = c > nowCell
        const appOff = c >= 48 && c < 52
        const present = !future && c >= 28 && !appOff
        const inWin = (c >= 36 && c <= 46) || (c >= 56 && c <= 72)
        const peak = present && inWin ? 1 + ((c * 7) % 4) : 0
        return {
          label: `${String(Math.floor((c * 15) / 60)).padStart(2, '0')}:${String((c * 15) % 60).padStart(2, '0')}`,
          peak,
          avg: peak ? Math.max(1, peak - 0.6) : 0,
          present,
          future,
        }
      })
    : range === 'week'
    ? Array.from({ length: 7 }, (_, day) =>
        // full Mon–Sun × 12 two-hour blocks; future after "now". Busy 08:00–18:00.
        Array.from({ length: 12 }, (_, b) => {
          const now = new Date()
          const wd = (now.getDay() + 6) % 7
          const h0 = b * 2
          const future = day > wd || (day === wd && h0 > now.getHours())
          const present = !future && h0 >= 6
          const inWin = h0 >= 8 && h0 <= 18
          const peak = present && inWin ? 1 + ((day * 12 + b) % 4) : 0
          return {
            label: `06-0${day + 1}`,
            peak,
            avg: peak ? Math.max(1, peak - 0.6) : 0,
            present,
            future,
          }
        }),
      ).flat()
    : range === 'month'
    ? (() => {
        // full calendar month × 1 bar/day; future after today.
        const now = new Date()
        const mo = now.getMonth()
        const days = new Date(now.getFullYear(), mo + 1, 0).getDate()
        const todayD = now.getDate()
        return Array.from({ length: days }, (_, i) => {
          const day = i + 1
          const future = day > todayD
          const present = !future && day % 6 !== 0 // demo gap every 6th day
          const peak = present ? 1 + (day % 5) : 0
          return {
            label: `${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            peak,
            avg: peak ? Math.max(1, peak - 0.6) : 0,
            present,
            future,
          }
        })
      })()
    : [
        { label: '06-01', peak: 2, avg: 1.4, present: true, future: false },
        { label: '06-02', peak: 3, avg: 1.8, present: true, future: false },
        { label: '06-03', peak: 0, avg: 0, present: false, future: false },
        { label: '06-04', peak: 4, avg: 2.6, present: true, future: false },
        { label: '06-05', peak: 3, avg: 2.1, present: true, future: false },
        { label: '06-06', peak: 5, avg: 3.0, present: true, future: false },
        { label: '06-07', peak: 4, avg: 2.3, present: true, future: false },
      ],
})

export const mockConnection: ConnectionStatus = {
  connected: true,
  projectsDetected: 26,
  sessionsScanned: 2573,
  hooksInstalled: true,
}

export const mockSettings: Settings = {
  distractionApps: ['ChatGPT Atlas', 'Telegram'],
  sensitivity: {
    graceSecs: 30,
    timeToDeathMin: 12,
    healDrainRatio: 0.1,
    idleThresholdSecs: 120,
    dayOverrides: [{ weekday: 5, timeToDeathMin: 25, healDrainRatio: 0.2 }, { weekday: 6, timeToDeathMin: 25, healDrainRatio: 0.2 }],
  },
  driftMomentIntensity: 'gentle-notification',
  logRoots: [],
  notificationSoundName: null,
  notificationSoundPath: null,
}

// auto-discovered apps surfaced by the Settings "scan" (browser/dev fallback)
export const mockKnownApps: KnownApp[] = [
  'ChatGPT Atlas', 'Telegram', 'Claude', 'Electron', 'Finder', 'Ghostty', 'Google Chrome', 'Slack',
].map((name) => ({ name, lastSeen: '' }))

export const mockProjectDetail = (id: string, range: RangeKey): ProjectDetail => {
  const p = mockProjects.find((x) => x.id === id) ?? mockProjects[0]
  return {
    id: p.id,
    name: p.name,
    rootPath: p.rootPath,
    colorHue: p.colorHue,
    range,
    tokens: p.tokens,
    waterMl: p.waterMl,
  }
}

// a calm "banking" live state — matches the design's default scenario
export const mockFocusTick: FocusTick = {
  ts: new Date(0).toISOString(),
  state: 'vibing',
  appName: 'Claude',
  cloudHealth: 113,
  baseline: 100,
  cap: 130,
  waitingSessions: 0,
  runningSessions: 1,
  secondsToDeath: null,
  activeSecsToday: Math.round(3.2 * 3600),
  distractSecsToday: 14 * 60,
  driftSecsToday: 6 * 60,
  workSecsToday: Math.round(2.6 * 3600),
  monitoredSecsToday: Math.round(3.8 * 3600),
  frozen: false,
}
