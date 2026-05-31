// ui.tsx — NubeNube design-system primitives, ported from the prototype (ui.jsx).
// Display/brand: Baloo 2 (nn-disp / nn-num). UI/data: Plus Jakarta Sans.

import { useId, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { hueClay } from '../lib/clay'

export const UI = 'var(--font-ui)'
export const DISP = 'var(--font-disp)'
export const INK = 'var(--ink)'
export const SUB = 'var(--sub)'
export const FAINT = 'var(--faint)'
export const shadow = { sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)' }
export const elev = { border: 'var(--border)' }

export const fmt = (n: number, d = 1) => Number(n).toFixed(d)

// ── Card ──────────────────────────────────────────────────────
export function Card({ children, style, pad = 18, ...rest }: { children?: ReactNode; style?: CSSProperties; pad?: number } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="nn-ui" {...rest} style={{ background: 'var(--surface)', borderRadius: 18, padding: pad, border: 'var(--border)', boxShadow: shadow.md, ...style }}>
      {children}
    </div>
  )
}

// ── Pill ──────────────────────────────────────────────────────
export function Pill({ children, hue = 268, tone = 'soft', style }: { children?: ReactNode; hue?: number; tone?: 'soft' | 'solid' | 'ghost'; style?: CSSProperties }) {
  const c = hueClay(hue)
  const map: Record<string, [string, string]> = { soft: [c.soft, c.ink], solid: [c.deep, '#fff'], ghost: ['rgba(255,255,255,.6)', c.ink] }
  const [bg, fg] = map[tone] || map.soft
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: bg, color: fg, borderRadius: 99, padding: '5px 11px', fontWeight: 700, fontSize: 11.5, letterSpacing: '.01em', whiteSpace: 'nowrap', fontFamily: UI, ...style }}>
      {children}
    </span>
  )
}

// ── Btn ───────────────────────────────────────────────────────
type BtnProps = { children?: ReactNode; hue?: number; kind?: 'primary' | 'soft' | 'ghost' | 'line'; size?: 'sm' | 'md' | 'lg'; style?: CSSProperties } & ButtonHTMLAttributes<HTMLButtonElement>
export function Btn({ children, hue = 268, kind = 'primary', size = 'md', style, ...rest }: BtnProps) {
  const c = hueClay(hue)
  const pad = size === 'lg' ? '13px 28px' : size === 'sm' ? '7px 14px' : '10px 20px'
  const fs = size === 'lg' ? 16 : size === 'sm' ? 13 : 14.5
  const base: CSSProperties = { border: 'none', cursor: 'pointer', borderRadius: 12, padding: pad, fontFamily: UI, fontWeight: 700, fontSize: fs, letterSpacing: '.01em', whiteSpace: 'nowrap', transition: 'transform .12s ease, box-shadow .2s ease' }
  const variants: Record<string, CSSProperties> = {
    primary: { ...base, background: `linear-gradient(165deg, ${c.mid}, ${c.deep})`, color: '#fff', boxShadow: `0 10px 22px -12px ${c.deep}` },
    soft: { ...base, background: c.soft, color: c.ink },
    ghost: { ...base, background: 'transparent', color: c.ink },
    line: { ...base, background: '#fff', color: c.ink, border: `1.5px solid ${c.light}` },
  }
  return (
    <button {...rest} style={{ ...variants[kind], ...style }} onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1.5px)' }} onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)' }}>
      {children}
    </button>
  )
}

// ── Meter ─────────────────────────────────────────────────────
export function Meter({ value = 1, hue = 268, height = 10, track = 'rgba(80,60,140,.1)', danger = false }: { value?: number; hue?: number; height?: number; track?: string; danger?: boolean }) {
  const c = hueClay(hue)
  const pct = Math.max(0, Math.min(100, value * 100))
  const fill = danger ? 'linear-gradient(90deg,#f3b06a,#ea7458)' : `linear-gradient(90deg, ${c.light}, ${c.deep})`
  return (
    <div style={{ height, borderRadius: 99, background: track, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: fill, transition: 'width .6s cubic-bezier(.4,1.2,.5,1)' }} />
    </div>
  )
}

// ── LifeBar — 70% base + up to 30% earned; drains below base when neglected ──
export function LifeBar({ life = 70, base = 70, hue = 268, height = 16, draining = false }: { life?: number; base?: number; hue?: number; height?: number; draining?: boolean }) {
  const c = hueClay(hue)
  const L = Math.max(0, Math.min(100, life))
  const above = L >= base
  return (
    <div style={{ position: 'relative', height, borderRadius: 99, background: 'rgba(80,60,140,.09)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${base}%`, background: above ? c.soft : 'transparent' }} />
      {above ? (
        <>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${base}%`, background: `linear-gradient(90deg, ${c.light}, ${c.mid})` }} />
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${L}%`, background: `linear-gradient(90deg, transparent ${(base / L) * 100 - 2}%, ${c.deep} ${(base / L) * 100}%, ${c.deep})`, transition: 'width .6s cubic-bezier(.4,1.2,.5,1)' }} />
        </>
      ) : (
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${L}%`, background: 'linear-gradient(90deg,#f3b06a,#ea6f52)', transition: 'width .6s cubic-bezier(.4,1.2,.5,1)', animation: draining ? 'nbDangerGlow 1.4s ease-in-out infinite' : undefined }} />
      )}
      <div style={{ position: 'absolute', left: `${base}%`, top: -1, bottom: -1, width: 2, background: above ? 'rgba(255,255,255,.85)' : 'rgba(120,90,160,.5)', transform: 'translateX(-1px)' }} />
    </div>
  )
}

// ── Dot ───────────────────────────────────────────────────────
export function Dot({ color = '#5bc88a', pulse = false, size = 9 }: { color?: string; pulse?: boolean; size?: number }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <span style={{ width: size, height: size, borderRadius: 99, background: color, boxShadow: `0 0 0 3px ${color}30` }} />
      {pulse && <span style={{ position: 'absolute', inset: -3, borderRadius: 99, border: `2px solid ${color}`, animation: 'nbDangerGlow 1.4s ease-in-out infinite' }} />}
    </span>
  )
}

// ── Soft (little ground cloud) ────────────────────────────────
export function Soft({ w = 120, opacity = 0.9 }: { w?: number; opacity?: number }) {
  return (
    <svg width={w} height={w * 0.3} viewBox="0 0 120 36">
      <g fill="#fff" opacity={opacity}>
        <ellipse cx="60" cy="23" rx="54" ry="12" />
        <ellipse cx="34" cy="19" rx="22" ry="12" />
        <ellipse cx="82" cy="18" rx="25" ry="13" />
      </g>
    </svg>
  )
}

// ── Spark (tiny sparkline) ────────────────────────────────────
export function Spark({ data = [], hue = 268, w = 120, h = 34, fill = true }: { data?: number[]; hue?: number; w?: number; h?: number; fill?: boolean }) {
  const c = hueClay(hue)
  const uid = useId().replace(/:/g, '')
  if (!data.length) return <svg width={w} height={h} />
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const pts = data.map((v, i) => [(i / Math.max(1, data.length - 1)) * w, h - ((v - min) / (max - min || 1)) * (h - 4) - 2] as [number, number])
  const line = pts.map((p) => p.join(',')).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`sp${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.mid} stopOpacity=".34" />
          <stop offset="100%" stopColor={c.mid} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <polygon points={`0,${h} ${line} ${w},${h}`} fill={`url(#sp${uid})`} />}
      <polyline points={line} fill="none" stroke={c.deep} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={c.deep} />
    </svg>
  )
}

// ── Donut (token composition). segs: [{label, value, color}] ──
export function Donut({ segs = [], size = 132, thickness = 18, center }: { segs?: { label?: string; value: number; color: string }[]; size?: number; thickness?: number; center?: ReactNode }) {
  const total = segs.reduce((s, x) => s + x.value, 0) || 1
  const r = (size - thickness) / 2
  const C = 2 * Math.PI * r
  let acc = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(80,60,140,.08)" strokeWidth={thickness} />
      {segs.map((s, i) => {
        const frac = s.value / total
        const dash = frac * C
        const el = (
          <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc * C} strokeLinecap="butt" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        )
        acc += frac
        return el
      })}
      {center && (
        <foreignObject x="0" y="0" width={size} height={size}>
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>{center}</div>
        </foreignObject>
      )}
    </svg>
  )
}

// ── DragBar (styled range input) ──────────────────────────────
export function DragBar({ label, value, min, max, step = 1, onChange, format, hue = 268 }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; hue?: number }) {
  const c = hueClay(hue)
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 12.5, color: SUB, fontFamily: UI }}>{label}</span>
        <span className="nn-num" style={{ fontWeight: 800, fontSize: 13, color: c.ink }}>{format ? format(value) : value}</span>
      </div>
      <input className="nn-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ['--p' as string]: pct + '%', ['--c' as string]: c.deep } as CSSProperties} />
    </div>
  )
}

// ── Toggle (switch) ───────────────────────────────────────────
export function Toggle({ on, onClick, hue = 270 }: { on: boolean; onClick: () => void; hue?: number }) {
  const c = hueClay(hue)
  return (
    <button onClick={onClick} aria-pressed={on} style={{ width: 46, height: 27, borderRadius: 99, border: 'none', cursor: 'pointer', position: 'relative', background: on ? `linear-gradient(90deg, ${c.light}, ${c.deep})` : 'rgba(120,100,170,.18)', transition: 'background .25s ease', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 22 : 3, width: 21, height: 21, borderRadius: 99, background: '#fff', boxShadow: '0 2px 5px rgba(80,60,140,.3)', transition: 'left .2s cubic-bezier(.4,1.4,.5,1)' }} />
    </button>
  )
}
