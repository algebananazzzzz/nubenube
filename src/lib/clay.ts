// Maps a project hue (0..360) to the creature's flat clay fills and the
// theme-aware accent CSS vars; both are injected on a window root.

import type { Theme } from '../store/prefs'

export type Clay = {
  soft: string
  light: string
  mid: string
  deep: string
  ink: string
  cheek: string
}

export const DEFAULT_HUE = 243 // Indigo — the fallback hue

const clamp = (v: number) => Math.max(0, Math.min(100, v))

// satMul/ltAdd wash the fill out as life falls below baseline
export function hueClay(h: number, satMul = 1, ltAdd = 0): Clay {
  const s = (v: number) => clamp(v * satMul)
  const l = (v: number) => clamp(v + ltAdd)
  return {
    soft: `hsl(${h} ${s(64)}% ${l(95)}%)`,
    light: `hsl(${h} ${s(72)}% ${l(86)}%)`,
    mid: `hsl(${h} ${s(66)}% ${l(73)}%)`,
    deep: `hsl(${h} ${s(54)}% ${l(58)}%)`,
    ink: `hsl(${h} ${s(46)}% ${l(Math.max(34, 40))}%)`,
    cheek: `hsl(${(h + 22) % 360} ${s(58)}% ${l(78)}%)`,
  }
}

// Concurrent-session tier → creature hue. Color rewards more sessions: dull grey
// at rest, then cool→warm and more saturated as the fleet grows, topping out at
// gold + an aura glow at 4+. Warm caps at gold, never red (red = critical here).
export type SessionTier = { hue: number; satScale: number; glow: boolean; name: string }

export function sessionTier(total: number): SessionTier {
  if (total <= 0) return { hue: 240, satScale: 0.18, glow: false, name: 'dormant' }
  if (total === 1) return { hue: 243, satScale: 1.0, glow: false, name: 'spark' }
  if (total === 2) return { hue: 190, satScale: 1.06, glow: false, name: 'flow' }
  if (total === 3) return { hue: 150, satScale: 1.0, glow: false, name: 'surge' }
  return { hue: 40, satScale: 1.2, glow: true, name: 'blaze' } // 4+
}

// desaturate + lighten as life falls below baseline
export function moodDrain(life: number): { satMul: number; ltAdd: number } {
  if (life >= 100) return { satMul: 1, ltAdd: 0 }
  const t = Math.max(0, Math.min(1, (100 - life) / 100))
  return { satMul: 1 - 0.4 * t, ltAdd: 3 * t }
}

// hue → accent var set, per theme (links / primary buttons / active nav / focus)
export function accentVars(hue: number, dark: boolean): Record<string, string> {
  const H = hue
  return dark
    ? {
        '--accent': `hsl(${H} 100% 70%)`,
        '--accent-hover': `hsl(${H} 100% 78%)`,
        '--accent-text': `hsl(${H} 100% 75%)`,
        '--accent-on': '#0c0d10',
        '--accent-surface': `hsla(${H}, 90%, 55%, .16)`,
        '--accent-border': `hsla(${H}, 90%, 68%, .36)`,
      }
    : {
        '--accent': `hsl(${H} 96% 52%)`,
        '--accent-hover': `hsl(${H} 92% 45%)`,
        '--accent-text': `hsl(${H} 90% 47%)`,
        '--accent-on': '#ffffff',
        '--accent-surface': `hsl(${H} 100% 97%)`,
        '--accent-border': `hsl(${H} 95% 90%)`,
      }
}

// clay-* + accent vars for a window root. Accent is fixed at DEFAULT_HUE; only
// the per-project clay fill adapts to hue.
export function themeVars(theme: Theme, clay: Clay): Record<string, string> {
  return {
    '--clay-soft': clay.soft,
    '--clay-light': clay.light,
    '--clay-mid': clay.mid,
    '--clay-deep': clay.deep,
    '--clay-ink': clay.ink,
    '--clay-cheek': clay.cheek,
    ...accentVars(DEFAULT_HUE, theme === 'dark'),
  }
}

// project hue → solid swatch readable in either theme
export function hueSwatch(hue: number, dark: boolean): string {
  return dark ? `hsl(${hue} 70% 68%)` : `hsl(${hue} 70% 48%)`
}
