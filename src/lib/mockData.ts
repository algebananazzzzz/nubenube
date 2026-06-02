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
    windowGranularity: 'app',
  },
  resetTimeLocal: '05:00',
  pauseUntil: null,
  driftMomentIntensity: 'gentle-notification',
  waterRates: { read: 0.0002, write: 0.0015 },
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
  workSecsToday: Math.round(2.6 * 3600),
  monitoredSecsToday: Math.round(3.8 * 3600),
  frozen: false,
  colorHue: 243,
}
