// clay.ts — per-hue "clay" palette, ported from the prototype's ui.jsx.
// Every project carries a `colorHue` (0..360) from the Rust connector; this
// turns that hue into a soft matte-clay set of shades used everywhere.

export type Clay = {
  hi: string
  light: string
  mid: string
  deep: string
  ink: string
  soft: string
  blush: string
}

export const ACCENT_HUE = 268 // lilac — the app's hero hue

// A pleasant fallback spread for projects whose hue lands on a muddy value.
export const projectHues = [268, 210, 158, 26, 338, 44, 186, 246]

const clamp = (v: number) => Math.max(0, Math.min(100, v))

/** Build the clay shade set for a hue. `satMul`/`ltAdd` let moods drain colour. */
export function hueClay(h: number, satMul = 1, ltAdd = 0): Clay {
  const s = (v: number) => clamp(v * satMul)
  const l = (v: number) => clamp(v + ltAdd)
  return {
    hi: `hsl(${h} ${s(90)}% ${l(95)}%)`,
    light: `hsl(${h} ${s(82)}% ${l(87)}%)`,
    mid: `hsl(${h} ${s(72)}% ${l(76)}%)`,
    deep: `hsl(${h} ${s(58)}% ${l(62)}%)`,
    ink: `hsl(${h} ${s(44)}% ${Math.max(30, l(38))}%)`,
    soft: `hsl(${h} ${s(74)}% ${l(96)}%)`,
    blush: `hsl(${(h + 330) % 360} ${s(84)}% ${l(80)}%)`,
  }
}

/** Soft dreamy wallpaper gradient for a hue (used behind windows). */
export function wallpaper(h = ACCENT_HUE): string {
  return [
    `radial-gradient(1200px 760px at 16% 8%, hsl(${h} 70% 94%), transparent)`,
    `radial-gradient(1000px 820px at 90% 96%, hsl(${(h + 300) % 360} 64% 93%), transparent)`,
    `linear-gradient(150deg, hsl(${h} 46% 92%), #eef0f8 52%, hsl(${(h + 70) % 360} 40% 93%))`,
  ].join(', ')
}
