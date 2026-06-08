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

// rough range scale so wider windows show plausibly larger totals in dev.
const RANGE_MUL: Record<RangeKey, number> = { today: 1, week: 4, month: 13, all: 22 }

// avg within a bucket is always below its peak (a few sessions ramp up/down),
// so the card's "peak" (max bucket avg) stays ≥ the overall avg.
const bucketAvg = (peak: number) => (peak > 0 ? Math.max(0.6, peak - 0.7) : 0)

export const mockInsights = (range: RangeKey): Insights => {
  const sessionSeries = mockSessionSeries(range)
  // Derive peak + avg FROM the series so they can never contradict the bars
  // (avg is the engaged-weighted mean, always ≤ the tallest bucket avg).
  const live = sessionSeries.filter((p) => p.present && p.avg > 0)
  const peakSessions = sessionSeries.reduce((m, p) => Math.max(m, p.peak), 0)
  const avgSessions = live.length ? live.reduce((a, p) => a + p.avg, 0) / live.length : 0
  return {
    range,
    tokens: { cacheRead: 1.3e9, cacheCreate: 56.9e6, output: 9.3e6, input: 1.7e6 },
    // Same measurement as Home's "Today" tile, scaled by range: working =
    // Σ(running·dt) across sessions, distract + drift = total wall-clock (drift ⊂
    // distract = breakdown sum). today matches mockTick so dev screens agree.
    claudeActiveSecs: Math.round(2.6 * 3600 * RANGE_MUL[range]),
    distractSecs: Math.round(14 * 60 * RANGE_MUL[range]),
    driftSecs: Math.round(6 * 60 * RANGE_MUL[range]),
    workAppSecs: Math.round(48 * 60 * RANGE_MUL[range]),
    distractionBreakdown: [
      { name: 'ChatGPT Atlas', secs: Math.round(9 * 60 * RANGE_MUL[range]) },
      { name: 'Telegram', secs: Math.round(5 * 60 * RANGE_MUL[range]) },
    ],
    peakSessions,
    avgSessions,
    sessionSeries,
  }
}

function mockSessionSeries(range: RangeKey): Insights['sessionSeries'] {
  const now = new Date()
  if (range === 'today') {
    // 96 × 15-min cells. Activity fills the cells leading up to "now" (relative,
    // so bars always show regardless of the clock), with a one-hour gap.
    const nowCell = Math.floor((now.getHours() * 60 + now.getMinutes()) / 15)
    const start = Math.max(0, nowCell - 44) // ~11h of history
    return Array.from({ length: 96 }, (_, c) => {
      const future = c > nowCell
      const gap = c >= nowCell - 8 && c < nowCell - 4 // a recent ~1h break
      const present = !future && c >= start && !gap
      const peak = present ? 1 + ((c * 7) % 4) : 0
      // demo distraction: wavy stretches with gaps, 0–~85% of each 15-min (900s) cell
      const wave = (Math.sin(c / 2.5) * 0.5 + 0.5) * 540
      const distractSecs = present ? Math.round(c % 5 === 0 ? 0 : wave + (c % 9 === 0 ? 240 : 0)) : 0
      return {
        label: `${String(Math.floor((c * 15) / 60)).padStart(2, '0')}:${String((c * 15) % 60).padStart(2, '0')}`,
        peak,
        avg: bucketAvg(peak),
        distractSecs,
        workSecs: present ? Math.round((Math.sin(c / 3) * 0.5 + 0.5) * 600) : 0, // 0..600 of a 900s cell
        present,
        future,
      }
    })
  }
  if (range === 'week') {
    // full Mon–Sun × 12 two-hour blocks; future after "now". Busy 08:00–18:00.
    const wd = (now.getDay() + 6) % 7
    const monday = new Date(now)
    monday.setDate(now.getDate() - wd)
    return Array.from({ length: 7 }, (_, day) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + day)
      const label = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return Array.from({ length: 12 }, (_, b) => {
        const h0 = b * 2
        const future = day > wd || (day === wd && h0 > now.getHours())
        const present = !future && h0 >= 6 && h0 <= 20
        const inWin = h0 >= 8 && h0 <= 18
        const peak = present && inWin ? 1 + ((day * 12 + b) % 4) : 0
        const distractSecs = present ? Math.round((Math.sin((day * 12 + b) / 2.2) * 0.5 + 0.5) * 3600 + (b % 6 === 0 ? 1200 : 0)) : 0
        return { label, peak, avg: bucketAvg(peak), distractSecs, workSecs: present ? Math.round((Math.sin((day * 12 + b) / 2) * 0.5 + 0.5) * 4200) : 0, present, future }
      })
    }).flat()
  }
  // month / all: 1 bar/day across the calendar month, future after today.
  const mo = now.getMonth()
  const days = new Date(now.getFullYear(), mo + 1, 0).getDate()
  const todayD = now.getDate()
  return Array.from({ length: days }, (_, i) => {
    const day = i + 1
    const future = day > todayD
    const present = !future && day % 6 !== 0 // demo gap every 6th day
    const peak = present ? 1 + (day % 5) : 0
    const distractSecs = present ? Math.round((Math.sin(day / 1.7) * 0.5 + 0.5) * 16200 + (day % 4 === 0 ? 7200 : 0)) : 0
    return {
      label: `${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      peak,
      avg: bucketAvg(peak),
      distractSecs,
      workSecs: present ? Math.round((Math.sin(day / 2) * 0.5 + 0.5) * 50000) : 0,
      present,
      future,
    }
  })
}

export const mockConnection: ConnectionStatus = {
  connected: true,
  projectsDetected: 26,
  sessionsScanned: 2573,
  hooksInstalled: true,
}

export const mockSettings: Settings = {
  distractionApps: ['ChatGPT Atlas', 'Telegram'],
  workApps: ['Slack', 'Google Chrome'],
  sensitivity: {
    graceSecs: 30,
    timeToDeathMin: 30,
    healDrainRatio: 0.1,
    waitingMultiplier: 3,
    idleThresholdSecs: 120,
    dayOverrides: [{ weekday: 5, timeToDeathMin: 60, healDrainRatio: 0.2 }, { weekday: 6, timeToDeathMin: 60, healDrainRatio: 0.2 }],
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
  budgetTotalSecs: 30 * 60,
  budgetRatePerMin: 0, // calm vibing demo — budget steady
  activeSecsToday: Math.round(3.2 * 3600),
  distractSecsToday: 14 * 60,
  driftSecsToday: 6 * 60,
  workSecsToday: Math.round(2.6 * 3600),
  workAppSecsToday: Math.round(0.8 * 3600),
  monitoredSecsToday: Math.round(3.8 * 3600),
  frozen: false,
}
