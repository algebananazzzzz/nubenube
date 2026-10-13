// Browser-only stand-in for the Rust engine, so every page renders and the timer
// runs under `npm run dev`. A loose approximation of src-tauri/src/economy.rs:
// it never runs inside Tauri, so it only needs to look right.

import { finishAt } from './economy'
import { DAYS } from './format'
import type { AppSlice, Day, FocusEvent, FocusTick, Insights, RangeKey, SeriesPoint, Settings } from '../types'

export const mockSettings: Settings = {
  apps: {
    Cursor: 'work', Figma: 'work', Ghostty: 'work', Notion: 'work',
    Slack: 'neutral', 'Google Chrome': 'neutral', Finder: 'neutral', Spotify: 'neutral',
    Telegram: 'rest', Discord: 'rest', Steam: 'rest',
  },
  sites: [
    ...['youtube.com', 'reddit.com', 'x.com', 'instagram.com', 'tiktok.com'].map((domain) => ({ domain, class: 'rest' as const })),
    ...['github.com', 'gitlab.com', 'docs.google.com', 'atlassian.net', 'claude.ai', 'chatgpt.com'].map((domain) => ({ domain, class: 'work' as const })),
    { domain: 'mail.google.com', class: 'neutral' },
  ],
  blockSites: true,
  ratio: 5, targetBonusMin: 30, presets: [25, 45, 60, 90], finishEvery: 15,
}

export const mockApps = ['Calculator', 'Cursor', 'Discord', 'Files', 'Firefox', 'Ghostty', 'Google Chrome', 'Mail', 'Obsidian', 'Slack', 'Spotify', 'Steam', 'Telegram', 'Visual Studio Code']

const todayIdx = () => (new Date().getDay() + 6) % 7

// focus hours, rest minutes, target hours for Mon..Sun
const WK = { focus: [4.3, 3.4, 4.8, 3.1, 4.4, 1.2, 0.6], rest: [32, 55, 20, 45, 30, 140, 170], target: [4, 4, 4, 4, 4, 1, 1] }

function mockWeek(): Day[] {
  const t = todayIdx(), s = mockSettings
  return DAYS.map((_, d) => {
    if (d > t) return { focus: 0, distract: 0, earned: 0, spent: 0, target: WK.target[d] * 3600, hit: false, bonus: 0, restPlan: d >= 5 ? 3 * 3600 : 1800 }
    const focus = d === t ? 9400 : WK.focus[d] * 3600, distract = d === t ? 960 : WK.rest[d] * 60, target = WK.target[d] * 3600
    const hit = focus >= target, bonus = hit ? s.targetBonusMin * 60 : 0
    return { focus, distract, earned: focus / s.ratio + bonus, spent: distract, target, hit, bonus, restPlan: d === t ? 1800 : 0 }
  })
}

let tick: FocusTick = (() => {
  const week = mockWeek()
  return { state: 'timer', app: 'Cursor', away: false, left: 1100, len: 2700, run: 1600, pending: 12, weekday: todayIdx(), week, bank: bankOf(week), extension: false }
})()

function bankOf(week: Day[]) {
  return week.reduce((a, d) => a + d.earned - d.spent, 0)
}

const tickListeners = new Set<(t: FocusTick) => void>()
const eventListeners = new Set<(e: FocusEvent) => void>()
let clock: ReturnType<typeof setInterval> | null = null

function publish(next: FocusTick) {
  tick = { ...next, bank: bankOf(next.week) }
  tickListeners.forEach((cb) => cb(tick))
}

function editToday(fn: (d: Day) => Day): Day[] {
  return tick.week.map((d, i) => (i === tick.weekday ? fn({ ...d }) : d))
}

function advance() {
  if (tick.state !== 'timer') return
  const s = mockSettings, run = tick.run + 1
  let week = editToday((d) => ({ ...d, focus: d.focus + 1, earned: d.earned + 1 / s.ratio }))
  const today = week[tick.weekday]
  if (!today.hit && today.target && today.focus >= today.target) {
    const bonus = s.targetBonusMin * 60
    week = week.map((d, i) => (i === tick.weekday ? { ...d, hit: true, bonus, earned: d.earned + bonus } : d))
    eventListeners.forEach((cb) => cb({ kind: 'targetHit', bonus }))
  }
  const pending = tick.pending + (finishAt(run, s.finishEvery) - 1) / s.ratio
  if (tick.left <= 1) {
    week = week.map((d, i) => (i === tick.weekday ? { ...d, earned: d.earned + pending } : d))
    eventListeners.forEach((cb) => cb({ kind: 'timerFinished', earned: tick.len / s.ratio + pending, bonus: pending }))
    publish({ ...tick, state: 'idle', left: 0, len: 0, run: 0, pending: 0, week })
    return
  }
  publish({ ...tick, left: tick.left - 1, run, pending, week })
}

export const mockEngine = {
  get: () => tick,
  onTick(cb: (t: FocusTick) => void) {
    tickListeners.add(cb)
    clock ??= setInterval(advance, 1000)
    return () => { tickListeners.delete(cb) }
  },
  onEvent(cb: (e: FocusEvent) => void) {
    eventListeners.add(cb)
    return () => { eventListeners.delete(cb) }
  },
  startTimer(minutes: number) {
    publish({ ...tick, state: 'timer', left: minutes * 60, len: minutes * 60, run: 0, pending: 0 })
  },
  stopTimer(): number {
    const forfeited = tick.pending
    publish({ ...tick, state: 'idle', left: 0, len: 0, run: 0, pending: 0 })
    return forfeited
  },
  setTarget(secs: number) {
    const bonus = mockSettings.targetBonusMin * 60
    publish({
      ...tick,
      week: editToday((d) => {
        const hit = d.focus >= secs, b = hit ? bonus : 0
        return { ...d, target: secs, hit, bonus: b, earned: d.earned - d.bonus + b }
      }),
    })
  },
  setDayTarget(day: number, secs: number | null) {
    publish({ ...tick, week: tick.week.map((d, i) => (i === day ? { ...d, target: secs } : d)) })
  },
  setDayRest(day: number, secs: number) {
    publish({ ...tick, week: tick.week.map((d, i) => (i === day ? { ...d, restPlan: secs } : d)) })
  },
}

// ── insights ──
function series(range: RangeKey, today: Day): SeriesPoint[] {
  const now = new Date(), t = todayIdx()
  if (range === 'today') {
    const nowCell = Math.floor((now.getHours() * 60 + now.getMinutes()) / 15), start = Math.max(0, nowCell - 44)
    const raw = Array.from({ length: 96 }, (_, c) => {
      const future = c > nowCell, gap = c >= nowCell - 18 && c < nowCell - 14, present = !future && c >= start && !gap
      const lull = present && (c % 9 === 0 || c === nowCell - 30)
      return { c, future, present, wf: present ? (lull ? 0.15 : 0.55 + Math.sin(c / 2.6) * 0.35 + (c % 5 === 0 ? -0.2 : 0.1)) : 0, wd: present ? (lull ? 0.9 : c % 7 === 0 ? 0.35 : 0.05) : 0 }
    })
    const sf = raw.reduce((x, p) => x + p.wf, 0) || 1, sd = raw.reduce((x, p) => x + p.wd, 0) || 1
    return raw.map((p) => {
      const distract = Math.min(900, Math.round((p.wd / sd) * today.distract))
      const focus = Math.max(0, Math.min(900 - distract, Math.round((p.wf / sf) * today.focus)))
      return { label: `${String(Math.floor(p.c / 4)).padStart(2, '0')}:${String((p.c % 4) * 15).padStart(2, '0')}`, focus, distract, present: p.present, future: p.future }
    })
  }
  if (range === 'week') {
    const cells: SeriesPoint[] = []
    for (let d = 0; d < 7; d++) for (let b = 0; b < 12; b++) {
      const h0 = b * 2, future = d > t || (d === t && h0 > now.getHours()), weekend = d >= 5
      const present = !future && h0 >= 8 && h0 <= 22 && !(weekend && h0 < 10)
      const k = d * 12 + b, inWork = h0 >= 9 && h0 <= 18
      const focus = present ? Math.round(Math.max(0, (inWork ? 0.62 : 0.18) + Math.sin(k / 2.1) * 0.22 - (weekend ? 0.45 : 0)) * 7200) : 0
      const distract = present ? Math.round(Math.max(0, (weekend ? 0.42 : 0.05) + (h0 >= 20 ? 0.25 : 0) + Math.sin(k / 1.7) * 0.05) * 7200) : 0
      cells.push({ label: DAYS[d], focus: Math.min(7200, focus), distract: Math.min(7200 - Math.min(7200, focus), distract), present, future })
    }
    return cells
  }
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), td = now.getDate()
  return Array.from({ length: days }, (_, i) => {
    const day = i + 1, dow = new Date(now.getFullYear(), now.getMonth(), day).getDay(), weekend = dow === 0 || dow === 6
    const future = day > td, present = !future && day % 11 !== 0
    const focus = present ? Math.round(3600 * (weekend ? 0.5 + (day % 3) * 0.4 : Math.max(1.5, 3.8 + Math.sin(day / 1.7) * 1.2))) : 0
    const distract = present ? Math.round(weekend ? 7200 + (day % 4) * 1800 : 1200 + (Math.sin(day / 2.1) * 0.5 + 0.5) * 2400) : 0
    return { label: `${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, focus, distract, present, future }
  })
}

const FOCUS_APPS: AppSlice[] = [{ name: 'Cursor', secs: 21600 }, { name: 'Figma', secs: 11400 }, { name: 'Google Chrome', secs: 6600 }, { name: 'Ghostty', secs: 5400 }]
const REST_APPS: AppSlice[] = [{ name: 'Telegram', secs: 1260 }, { name: 'Discord', secs: 840 }, { name: 'Steam', secs: 420 }]

export function mockInsights(range: RangeKey): Insights {
  const s = series(range, tick.week[tick.weekday])
  const focus = s.reduce((a, p) => a + p.focus, 0), distract = s.reduce((a, p) => a + p.distract, 0)
  const k = range === 'month' ? 4.3 : range === 'today' ? 0.2 : 1
  const scale = (rows: AppSlice[]) => rows.map((r) => ({ ...r, secs: Math.round(r.secs * k) }))
  const days = range === 'today' ? 1 : range === 'week' ? tick.weekday + 1 : new Date().getDate()
  return {
    range, series: s, earned: focus / mockSettings.ratio, spent: distract,
    targetsHit: Math.round(days * 0.7), targetDays: days,
    focusApps: scale(FOCUS_APPS), restApps: scale(REST_APPS),
  }
}
