// Shared UI primitives. Colors/radii/shadows come from theme/tokens.css vars.

import { useState, type CSSProperties, type ReactNode } from 'react'
import type { AppClass } from '../types'

export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="nn-eyebrow" style={style}>{children}</div>
}

export function Card({ children, style, pad = 20, soft, onClick, hoverable }: {
  children: ReactNode; style?: CSSProperties; pad?: number; soft?: boolean
  onClick?: () => void; hoverable?: boolean
}) {
  const [h, setH] = useState(false)
  return (
    <div onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        background: soft ? 'var(--surface-faint)' : 'var(--surface)',
        border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: pad,
        boxShadow: hoverable && h ? 'var(--shadow-md)' : 'none',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow .16s var(--ease), border-color .16s',
        borderColor: hoverable && h ? 'var(--line-strong)' : 'var(--line)',
        ...style,
      }}>{children}</div>
  )
}

type Tone = 'neutral' | 'soft' | 'accent' | 'ghost' | 'mint' | 'amber' | 'danger' | 'work'

// `tone` overrides `kind`; both index the same palette map.
export function Pill({ children, kind = 'neutral', tone, style }: {
  children: ReactNode; kind?: Tone; tone?: Tone; style?: CSSProperties
}) {
  const tones: Record<Tone, { bg: string; fg: string; bd: string }> = {
    neutral: { bg: 'var(--surface-strong)', fg: 'var(--text)', bd: 'var(--line)' },
    soft: { bg: 'var(--accent-surface)', fg: 'var(--accent-text)', bd: 'var(--accent-border)' },
    accent: { bg: 'var(--accent-surface)', fg: 'var(--accent-text)', bd: 'var(--accent-border)' },
    ghost: { bg: 'transparent', fg: 'var(--faint)', bd: 'var(--line)' },
    mint: { bg: 'var(--success-surface)', fg: 'var(--success)', bd: 'var(--success-border)' },
    amber: { bg: 'var(--warning-surface)', fg: 'var(--warning)', bd: 'var(--warning-border)' },
    danger: { bg: 'var(--critical-surface)', fg: 'var(--critical)', bd: 'var(--critical-border)' },
    work: { bg: 'var(--work-surface)', fg: 'var(--work)', bd: 'var(--work-border)' },
  }
  const t = tones[tone || kind] || tones.neutral
  return (
    <span className="nn-ui" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 9px', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600,
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, whiteSpace: 'nowrap',
      ...style,
    }}>{children}</span>
  )
}

type Variant = 'primary' | 'line' | 'soft' | 'ghost' | 'critical'

export function Btn({ children, variant = 'primary', size = 'md', onClick, style, disabled, full }: {
  children: ReactNode; variant?: Variant; size?: 'sm' | 'md' | 'lg'
  onClick?: () => void; style?: CSSProperties; disabled?: boolean; full?: boolean
}) {
  const [h, setH] = useState(false)
  const sizes: Record<string, [number, number, number]> = { sm: [7, 12, 13], md: [9, 15, 14], lg: [12, 20, 15] }
  const [py, px, fs] = sizes[size] || sizes.md
  const V: Record<Variant, { bg: string; bgH: string; fg: string; bd: string }> = {
    primary: { bg: 'var(--accent)', bgH: 'var(--accent-hover)', fg: 'var(--accent-on)', bd: 'transparent' },
    line: { bg: 'var(--surface)', bgH: 'var(--surface-hover)', fg: 'var(--ink)', bd: 'var(--line-strong)' },
    soft: { bg: 'var(--accent-surface)', bgH: 'var(--accent-surface)', fg: 'var(--accent-text)', bd: 'var(--accent-border)' },
    ghost: { bg: 'transparent', bgH: 'var(--surface-hover)', fg: 'var(--text)', bd: 'transparent' },
    critical: { bg: 'var(--critical)', bgH: 'var(--critical-on)', fg: '#fff', bd: 'transparent' },
  }
  const v = V[variant] || V.primary
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      className="nn-ui" style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        padding: `${py}px ${px}px`, fontSize: fs, fontWeight: 600, lineHeight: 1,
        borderRadius: 'var(--r-md)', border: `1px solid ${v.bd}`,
        background: h && !disabled ? v.bgH : v.bg, color: v.fg, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1, width: full ? '100%' : 'auto',
        transition: 'background .14s var(--ease), border-color .14s', ...style,
      }}>{children}</button>
  )
}

// Status dot; `pulse` draws an expanding ring via the nn-pulse keyframe.
export function Dot({ tone = 'var(--success)', size = 8, pulse }: { tone?: string; size?: number; pulse?: boolean }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size }}>
      {pulse && <span style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: `1.5px solid ${tone}`, animation: 'nn-pulse 1.8s var(--ease) infinite' }} />}
      <span style={{ width: size, height: size, borderRadius: '50%', background: tone }} />
    </span>
  )
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} aria-pressed={on} style={{
      width: 38, height: 22, borderRadius: 999, border: '1px solid', cursor: 'pointer', padding: 2,
      borderColor: on ? 'transparent' : 'var(--line-strong)',
      background: on ? 'var(--accent)' : 'var(--surface-strong)', transition: 'background .2s var(--ease), border-color .2s',
      display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', alignItems: 'center',
    }}>
      <span style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)', transition: 'all .2s var(--ease)' }} />
    </button>
  )
}

export function SegTabs<T extends string>({ tabs, value, onChange, size = 'md' }: {
  tabs: ({ key: T; label: string } | T)[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md'
}) {
  const py = size === 'sm' ? 5 : 7, fs = size === 'sm' ? 12.5 : 13
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 2, background: 'var(--surface-strong)', borderRadius: 'var(--r-md)' }}>
      {tabs.map((t) => {
        const k = (typeof t === 'string' ? t : t.key) as T
        const label = typeof t === 'string' ? t : t.label
        const act = k === value
        return (
          <button key={k} onClick={() => onChange(k)} className="nn-ui" style={{
            padding: `${py}px 13px`, fontSize: fs, fontWeight: 600, borderRadius: 'var(--r-sm)', border: act ? '1px solid var(--line)' : '1px solid transparent', cursor: 'pointer',
            background: act ? 'var(--surface)' : 'transparent', color: act ? 'var(--ink)' : 'var(--faint)',
            boxShadow: act ? 'var(--shadow-sm)' : 'none', transition: 'all .15s var(--ease)', whiteSpace: 'nowrap',
          }}>{label}</button>
        )
      })}
    </div>
  )
}

const BRAND: Record<string, string> = {
  telegram: '#2aabee', claude: '#d97757', cursor: '#3b3f4a', figma: '#a259ff', finder: '#3dc7a0', ghostty: '#e0584f',
  'google chrome': '#46a35e', slack: '#7a3b86', notion: '#5b5d63', discord: '#5865f2', steam: '#1b6a99', spotify: '#1db954',
}

// Brand color for well-known apps, else a stable hue hashed from the name.
function colorFor(name: string): string {
  const k = name.toLowerCase()
  if (BRAND[k]) return BRAND[k]
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h} 45% 48%)`
}

export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 'var(--r-sm)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: colorFor(name), color: '#fff', fontWeight: 700, fontSize: size * 0.44 }}>
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  )
}

export const CLASSES: { key: AppClass; label: string; tone: string }[] = [
  { key: 'rest', label: 'Rest', tone: 'var(--critical)' },
  { key: 'neutral', label: 'Neutral', tone: 'var(--faint)' },
  { key: 'work', label: 'Work', tone: 'var(--success)' },
]

export function ClassSwitch({ value, onChange }: { value: AppClass; onChange: (v: AppClass) => void }) {
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 2, background: 'var(--surface-strong)', borderRadius: 'var(--r-md)', flexShrink: 0 }}>
      {CLASSES.map((c) => {
        const on = c.key === value
        return (
          <button key={c.key} onClick={() => onChange(c.key)} aria-pressed={on} className="nn-ui" style={{
            padding: '4px 9px', fontSize: 11.5, fontWeight: 600, border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer',
            background: on ? c.tone : 'transparent', color: on ? 'var(--accent-on)' : 'var(--faint)', transition: 'background .15s var(--ease)',
          }}>{c.label}</button>
        )
      })}
    </div>
  )
}

export function Section({ children, right, sub }: { children: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="nn-disp" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', flex: 1, minWidth: 0 }}>{children}</div>
        {right}
      </div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--faint)', lineHeight: 1.5, marginTop: 4, textWrap: 'pretty' }}>{sub}</div>}
    </div>
  )
}

export function PrefRow({ title, desc, children, last }: { title: ReactNode; desc?: ReactNode; children: ReactNode; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 0', borderBottom: last ? 'none' : '1px solid var(--line-faint)', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
        {desc && <div style={{ fontSize: 12.5, color: 'var(--faint)', marginTop: 2, lineHeight: 1.45, textWrap: 'pretty' }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

// Native range input kept invisible on top of a drawn track + thumb.
export function Slider({ title, value, fmt, min, max, step, onChange, accent = 'var(--accent)', last, desc }: {
  title: ReactNode; value: number; fmt: (v: number) => string; min: number; max: number; step: number
  onChange: (v: number) => void; accent?: string; last?: boolean; desc?: ReactNode
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div style={{ padding: '14px 0', borderBottom: last ? 'none' : '1px solid var(--line-faint)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: desc ? 2 : 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
        <div className="nn-num" style={{ fontSize: 12.5, color: 'var(--faint)', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(value)}</div>
      </div>
      {desc && <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.45, marginBottom: 12 }}>{desc}</div>}
      <div style={{ position: 'relative', height: 16 }}>
        <div style={{ position: 'absolute', top: 6, left: 0, right: 0, height: 4, borderRadius: 999, background: 'var(--surface-strong)' }} />
        <div style={{ position: 'absolute', top: 6, left: 0, width: `${pct}%`, height: 4, borderRadius: 999, background: accent }} />
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="nn-bare-range"
          style={{ position: 'absolute', inset: '-3px 0', width: '100%', height: 22, margin: 0, cursor: 'pointer' }} />
        <div style={{ position: 'absolute', top: '50%', left: `${pct}%`, width: 16, height: 16, marginLeft: -8, transform: 'translateY(-50%)', borderRadius: '50%', background: '#fff', border: `2px solid ${accent}`, boxShadow: 'var(--shadow-sm)', pointerEvents: 'none' }} />
      </div>
    </div>
  )
}

export function Ring({ pct, size = 64, thick = 7, color = 'var(--success)', children }: {
  pct: number; size?: number; thick?: number; color?: string; children?: ReactNode
}) {
  const r = (size - thick) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct))
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-strong)" strokeWidth={thick} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thick} strokeLinecap="round" strokeDasharray={`${p * c} ${c}`} style={{ transition: 'stroke-dasharray .6s var(--ease)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
    </div>
  )
}

export function Bar({ pct, color = 'var(--accent)', height = 6, track = 'var(--surface-strong)' }: {
  pct: number; color?: string; height?: number; track?: string
}) {
  return (
    <div style={{ height, borderRadius: 999, background: track, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(1, pct)) * 100}%`, height: '100%', borderRadius: 999, background: color, transition: 'width .6s var(--ease)' }} />
    </div>
  )
}

export function ShieldIcon({ size = 13, color = 'currentColor', filled }: { size?: number; color?: string; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <path d="M8 1.5l5.5 2v4.2c0 3.2-2.3 5.8-5.5 6.8-3.2-1-5.5-3.6-5.5-6.8V3.5z" fill={filled ? color : 'none'} stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

export function Tile({ label, children, foot, style }: { label: ReactNode; children: ReactNode; foot?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ minWidth: 0, padding: '14px 15px', borderRadius: 'var(--r-lg)', background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      <Eyebrow style={{ fontSize: 10.5 }}>{label}</Eyebrow>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {foot && <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.4, paddingTop: 9, borderTop: '1px solid var(--line-faint)' }}>{foot}</div>}
    </div>
  )
}

export function Stat({ value, label, color = 'var(--ink)', size = 28 }: { value: ReactNode; label: ReactNode; color?: string; size?: number }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="nn-num" style={{ fontSize: size, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--faint)', fontWeight: 600, marginTop: 5 }}>{label}</div>
    </div>
  )
}

// Marks UI whose backend isn't built yet (site tracking + the DNS shield).
export function SoonPill() {
  return <Pill tone="ghost" style={{ fontSize: 11 }}>Coming soon</Pill>
}
