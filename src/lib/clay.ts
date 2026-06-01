// clay.ts — per-hue "clay" palette + theme-aware accent vars (Helios edition).
// Every project carries a `colorHue` (0..360) from the Rust connector; this
// turns that hue into a flat matte fill set for the creature, plus the Helios
// accent (links / primary buttons / active nav) used sparingly over neutral
// surfaces. Mirrors the prototype's state.jsx.

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

// ── per-hue flat "clay" palette for the creature ────────────────
// Flat fills only — no gradients, no glow. satMul / ltAdd let the body
// gently wash out as life falls below baseline.
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

// mild desaturation as life falls below baseline (no longer dramatic)
export function moodDrain(life: number): { satMul: number; ltAdd: number } {
  if (life >= 100) return { satMul: 1, ltAdd: 0 }
  const t = Math.max(0, Math.min(1, (100 - life) / 100))
  return { satMul: 1 - 0.4 * t, ltAdd: 3 * t }
}

// ── theme-aware accent vars from a hue (Helios action color) ────
// Default hue (243) lands on indigo. Accent is used sparingly —
// links, primary buttons, active nav, focus — over neutral surfaces, so it
// stays readable in both themes.
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

/** The full set of CSS vars a window root injects for (theme, hue, drained clay). */
export function themeVars(_hue: number, theme: Theme, clay: Clay): Record<string, string> {
  return {
    '--clay-soft': clay.soft,
    '--clay-light': clay.light,
    '--clay-mid': clay.mid,
    '--clay-deep': clay.deep,
    '--clay-ink': clay.ink,
    '--clay-cheek': clay.cheek,
    ...accentVars(DEFAULT_HUE, theme === 'dark'), // fixed indigo accent; clay still adapts per-project
  }
}

/** A project hue → a readable solid swatch in either theme (Insights list). */
export function hueSwatch(hue: number, dark: boolean): string {
  return dark ? `hsl(${hue} 70% 68%)` : `hsl(${hue} 70% 48%)`
}
