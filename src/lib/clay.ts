// Maps a hue (0..360) to the creature's flat clay fills and the theme-aware
// accent CSS vars; both are injected on a window root.

import type { Theme } from '../store/prefs'

export type Clay = {
  light: string
  mid: string
  deep: string
  cheek: string
}

export const DEFAULT_HUE = 243 // Indigo — the fallback hue

const clamp = (v: number) => Math.max(0, Math.min(100, v))

// satMul/ltAdd wash the fill out as life falls below baseline
export function hueClay(h: number, satMul = 1, ltAdd = 0): Clay {
  const s = (v: number) => clamp(v * satMul)
  const l = (v: number) => clamp(v + ltAdd)
  return {
    light: `hsl(${h} ${s(72)}% ${l(86)}%)`,
    mid: `hsl(${h} ${s(66)}% ${l(73)}%)`,
    deep: `hsl(${h} ${s(54)}% ${l(58)}%)`,
    cheek: `hsl(${(h + 22) % 360} ${s(58)}% ${l(78)}%)`,
  }
}

// Clay vitality scaled by life: below baseline it washes out (desaturate +
// lighten); above baseline it enriches (saturate + slightly deepen) in
// proportion to how far it is toward `cap`.
export function lifeTint(life: number, baseline = 100, cap = 130): { satMul: number; ltAdd: number } {
  if (life >= baseline) {
    const over = cap > baseline ? Math.min(1, (life - baseline) / (cap - baseline)) : 0
    return { satMul: 1 + 0.3 * over, ltAdd: -3 * over }
  }
  const t = Math.min(1, (baseline - life) / baseline)
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
// the clay fill adapts to hue.
export function themeVars(theme: Theme, clay: Clay): Record<string, string> {
  return {
    '--clay-light': clay.light,
    '--clay-mid': clay.mid,
    '--clay-deep': clay.deep,
    '--clay-cheek': clay.cheek,
    ...accentVars(DEFAULT_HUE, theme === 'dark'),
  }
}

// hue → solid swatch readable in either theme
export function hueSwatch(hue: number, dark: boolean): string {
  return dark ? `hsl(${hue} 70% 68%)` : `hsl(${hue} 70% 48%)`
}
