// ui.tsx — NubeNube primitives (Helios edition). Flat surfaces, hairline
// borders, small radii, status colors used with intent. Ported from ui.jsx.

import { useState, type CSSProperties, type ReactNode } from 'react'

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

type Tone = 'neutral' | 'soft' | 'accent' | 'ghost' | 'mint' | 'amber' | 'danger'

// Helios-style Badge. tone: neutral | accent | mint | amber | danger
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

// Helios Button. variant: primary | line (secondary) | soft | ghost | critical
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

// status dot — flat, optional gentle pulse (no glow)
export function Dot({ tone = 'var(--success)', size = 8, pulse }: { tone?: string; size?: number; pulse?: boolean }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size }}>
      {pulse && <span style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: `1.5px solid ${tone}`, animation: 'nn-pulse 1.8s var(--ease) infinite' }} />}
      <span style={{ width: size, height: size, borderRadius: '50%', background: tone }} />
    </span>
  )
}

export function Meter({ value = 0.5, tone = 'var(--accent)', h = 6, track = 'var(--surface-strong)' }: {
  value?: number; tone?: string; h?: number; track?: string
}) {
  return (
    <div style={{ height: h, borderRadius: 999, background: track, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: '100%', background: tone, borderRadius: 999, transition: 'width .6s var(--ease)' }} />
    </div>
  )
}

// ── LifeBar — the hero meter. 0..cap; baseline ("start · 100") marker.
export function LifeBar({ life, baseline = 100, cap = 130, height = 10, labels = true }: {
  life: number; baseline?: number; cap?: number; height?: number; labels?: boolean
}) {
  const basePct = (baseline / cap) * 100
  const fillPct = Math.max(0, Math.min(1, life / cap)) * 100
  const over = life > baseline
  const below = life < baseline
  const tone = over ? 'var(--success)' : below ? (life < 30 ? 'var(--critical)' : 'var(--warning)') : 'var(--success)'
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative', height, borderRadius: 999, overflow: 'hidden', background: 'var(--surface-strong)' }}>
        {/* over-baseline zone — faint hatch */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${basePct}%`, right: 0, background: 'var(--success-surface)' }} />
        {/* fill */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${fillPct}%`, background: tone, borderRadius: 999, transition: 'width .6s var(--ease)' }} />
        {/* baseline marker */}
        <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${basePct}%`, width: 2, background: 'var(--ink)', opacity: .35 }} />
      </div>
      {labels && (
        <div style={{ position: 'relative', height: 15, marginTop: 6 }}>
          <span className="nn-mono" style={{ position: 'absolute', left: 0, fontSize: 10, color: 'var(--faint)' }}>0</span>
          <span className="nn-mono" style={{ position: 'absolute', left: `${basePct}%`, transform: 'translateX(-50%)', fontSize: 10, color: 'var(--faint)' }}>start · 100</span>
          <span className="nn-mono" style={{ position: 'absolute', right: 0, fontSize: 10, color: 'var(--faint)' }}>max · {cap}</span>
        </div>
      )}
    </div>
  )
}

// ── SplitBar — focused (success) vs distracted (warning) ─────────
export function SplitBar({ pct, height = 10 }: { pct: number; height?: number }) {
  return (
    <div style={{ display: 'flex', height, borderRadius: 999, overflow: 'hidden', background: 'var(--warning-surface)' }}>
      <div style={{ width: `${pct * 100}%`, background: 'var(--success)', transition: 'width .6s var(--ease)' }} />
      <div style={{ flex: 1, background: 'var(--warning)' }} />
    </div>
  )
}

export function Spark({ data, tone = 'var(--accent)', w = 120, h = 36, fill = true }: {
  data: number[]; tone?: string; w?: number; h?: number; fill?: boolean
}) {
  const max = Math.max(...data, 1), min = Math.min(...data, 0)
  const rng = max - min || 1
  const pts = data.map((d, i) => [(i / (data.length - 1)) * w, h - 4 - ((d - min) / rng) * (h - 8)])
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${w} ${h} L0 ${h} Z`
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {fill && <path d={area} fill={tone} opacity=".1" />}
      <path d={line} fill="none" stroke={tone} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.4" fill={tone} />
    </svg>
  )
}

export function Donut({ segments, size = 120, thickness = 14, label, sub }: {
  segments: { value: number; color: string }[]; size?: number; thickness?: number; label?: string; sub?: string
}) {
  const r = (size - thickness) / 2, c = 2 * Math.PI * r
  let off = 0
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-strong)" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c
          const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} />
          off += len; return el
        })}
      </svg>
      {label && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div className="nn-num" style={{ fontSize: 20, color: 'var(--ink)' }}>{label}</div>
          {sub && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 1 }}>{sub}</div>}
        </div>
      )}
    </div>
  )
}

// Helios switch — flat
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

// Helios segmented control
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

export function StatTile({ label, value, sub, tone, icon }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string; icon?: ReactNode
}) {
  return (
    <div style={{ background: 'var(--surface-faint)', border: '1px solid var(--line-faint)', borderRadius: 'var(--r-md)', padding: '13px 15px' }}>
      <div style={{ marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--faint)' }}>{icon}{label}</div>
      <div className="nn-num" style={{ fontSize: 24, color: tone || 'var(--ink)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 5, fontWeight: 500 }}>{sub}</div>}
    </div>
  )
}

export function Divider({ style }: { style?: CSSProperties }) {
  return <div style={{ height: 1, background: 'var(--line-faint)', ...style }} />
}
