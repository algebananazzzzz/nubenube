// Composes the live FocusTick, settings and theme into the view-model the pages
// and the companion read: rest health, today's pace, creature mood/sky/clay,
// and timer projections.

import { useFocus } from '../store/focus'
import { usePrefs } from '../store/prefs'
import { useSettings } from '../store/settings'
import { hueClay, hueSwatch, lifeTint } from './clay'
import { FINISH, finishAt, finishTier, hpTone, projectBonus, todayPace, type Mood } from './economy'
import { mockSettings } from './mockData'
import { fmtCountdown } from './format'
import type { Settings } from '../types'

export type Sky = 'good' | 'focus' | 'worried' | 'danger' | 'idle'

// Rules only, so they are safe to show before the real settings load; anything
// that saves settings must wait for the store instead.
export function useRules(): Settings {
  return useSettings((s) => s.settings) ?? mockSettings
}

export function useFocusView() {
  const tick = useFocus((s) => s.tick)
  const theme = usePrefs((s) => s.theme)
  const s = useRules()
  const dark = theme === 'dark'
  const today = tick.week[tick.weekday]
  const target = today.target

  // Health = banked rest vs. the rest planned for the rest of the week.
  const wanted = tick.week.reduce((a, d, i) => a + (i >= tick.weekday ? d.restPlan : 0), 0)
  const hp = wanted > 0 ? tick.bank / wanted : tick.bank > 0 ? 1 : 0
  const phase = todayPace(today.focus, target)
  const inTimer = tick.state === 'timer'
  const calm = tick.state !== 'timer'

  const { satMul, ltAdd } = lifeTint(Math.max(0, Math.min(300, 40 + hp * 120)), 100, 300)
  // The sky shows what is happening right now; a low bank already shows in the
  // creature's mood and clay, so it must not wash out the state tint.
  const sky: Sky = tick.away ? 'idle'
    : tick.state === 'timer' ? (tick.appClass === 'work' ? 'good' : 'focus')
    : tick.state === 'drift' ? (hp < 0.15 ? 'danger' : 'worried')
    : 'idle'

  const tier = finishTier(tick.run, s.finishEvery)
  const nextTierIn = tier < FINISH.length - 1 ? (tier + 1) * s.finishEvery * 60 - tick.run : 0
  const tracked = today.focus + today.distract

  return {
    ...tick, theme, dark, today, target, hp, hpTone: hpTone(hp), wanted, phase,
    mood: phase.mood as Mood, sky, inTimer,
    clay: hueClay(phase.hue, satMul * (calm ? 0.55 : phase.sat), ltAdd),
    glow: !calm && !!phase.glow,
    targetPct: target ? today.focus / target : 0,
    ratioToday: tracked ? today.focus / tracked : 0,
    finish: finishAt(tick.run, s.finishEvery), tier, nextTierIn,
    projected: tick.pending + projectBonus(tick.run, tick.left, s.finishEvery, s.ratio),
  }
}

export type FocusView = ReturnType<typeof useFocusView>

// One-line status for the sidebar chip and the companion.
export function statusLine(f: FocusView): { tone: string; text: string; pulse: boolean } {
  if (f.away) return { tone: 'var(--faint)', text: f.inTimer ? `Away · ${fmtCountdown(f.left)}` : 'Away', pulse: false }
  if (f.state === 'timer') return { tone: f.appClass === 'work' ? 'var(--success)' : hueSwatch(f.phase.hue, f.dark), text: `Focusing · ${fmtCountdown(f.left)}`, pulse: true }
  if (f.state === 'drift') return { tone: f.hp < 0.15 ? 'var(--critical)' : 'var(--warning)', text: `Resting · ${f.app}`, pulse: true }
  return { tone: 'var(--faint)', text: 'Idle', pulse: false }
}
