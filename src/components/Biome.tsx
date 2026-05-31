// Biome.tsx — the sky scene: gradient skies, drifting clouds, sun, twinkles,
// rain (the bloop weeping while you drift) and Zzz. Ported from biome.jsx.

import { useMemo, type CSSProperties, type ReactNode } from 'react'
import type { SkyState } from '../lib/derive'

export const SKY: Record<SkyState, string> = {
  calm: 'linear-gradient(180deg,#d6c8f2 0%,#e7dcf5 46%,#f3ecfa 100%)',
  working: 'linear-gradient(180deg,#a9d8f4 0%,#cbe7f2 46%,#eaf7fb 100%)',
  alert: 'linear-gradient(180deg,#bcd2f4 0%,#d6def6 46%,#eef0fb 100%)',
  worried: 'linear-gradient(180deg,#c7c2d6 0%,#d8d2e2 48%,#ece8f1 100%)',
  danger: 'linear-gradient(180deg,#ffce97 0%,#ffd2c0 46%,#ffe7dc 100%)',
  fading: 'linear-gradient(180deg,#cdc6c2 0%,#ddd7d2 50%,#efebe7 100%)',
  faint: 'linear-gradient(180deg,#a7a1b4 0%,#bdb7c8 50%,#d6d2de 100%)',
  mint: 'linear-gradient(180deg,#bfead8 0%,#d6f0e6 48%,#eef8f3 100%)',
}

export function Sky({ state = 'calm', children, style }: { state?: SkyState; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: SKY[state] || SKY.calm, overflow: 'hidden', transition: 'background .8s ease', ...style }}>
      {children}
    </div>
  )
}

export function Cloud({ x, y, scale = 1, health = 1, dur = 16, delay = 0, anim = 'drift1', tint = '#eef0fb' }: {
  x: number | string; y: number | string; scale?: number; health?: number; dur?: number; delay?: number; anim?: string; tint?: string
}) {
  const s = scale * (0.55 + 0.45 * health)
  const op = 0.45 + 0.55 * health
  const gid = `cl${String(x).replace(/\D/g, '')}${String(y).replace(/\D/g, '')}${Math.round(scale * 10)}`
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `scale(${s})`, transformOrigin: 'center', animation: `${anim} ${dur}s ease-in-out infinite`, animationDelay: `${delay}s`, opacity: op, transition: 'transform .8s ease, opacity .8s ease' }}>
      <svg width="160" height="86" viewBox="0 0 160 86" style={{ filter: 'drop-shadow(0 8px 10px rgba(140,120,180,.18))' }}>
        <defs>
          <radialGradient id={gid} cx="42%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#fff" />
            <stop offset="100%" stopColor={tint} />
          </radialGradient>
        </defs>
        <g fill={`url(#${gid})`}>
          <ellipse cx="54" cy="54" rx="44" ry="30" />
          <ellipse cx="96" cy="50" rx="40" ry="33" />
          <circle cx="78" cy="38" r="28" />
          <circle cx="116" cy="56" r="22" />
          <circle cx="40" cy="44" r="22" />
        </g>
        <ellipse cx="58" cy="34" rx="20" ry="11" fill="#fff" opacity=".55" />
      </svg>
    </div>
  )
}

export function Sun({ x, y, size = 80, rays = true, pulse = true }: { x: number | string; y: number | string; size?: number; rays?: boolean; pulse?: boolean }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y }}>
      {rays && (
        <svg width={size * 2.2} height={size * 2.2} viewBox="0 0 200 200" style={{ position: 'absolute', left: -size * 0.6, top: -size * 0.6, animation: 'sunSpin 60s linear infinite', opacity: 0.5 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <rect key={i} x="97" y="6" width="6" height="26" rx="3" fill="#ffe39a" transform={`rotate(${i * 30} 100 100)`} />
          ))}
        </svg>
      )}
      <div style={{ width: size, height: size, borderRadius: '50%', background: 'radial-gradient(circle at 38% 32%, #fff6d8, #ffd86b 70%, #f7b94e)', boxShadow: '0 0 40px 12px rgba(255,214,107,.5)', animation: pulse ? 'sunPulse 5s ease-in-out infinite' : 'none' }} />
    </div>
  )
}

export function Twinkles({ count = 7, area = { w: 280, h: 360 } }: { count?: number; area?: { w: number; h: number } }) {
  const pts = useMemo(
    () => Array.from({ length: count }).map(() => ({ x: Math.random() * area.w, y: Math.random() * area.h, d: Math.random() * 3, dur: 2 + Math.random() * 2 })),
    [count, area.w, area.h]
  )
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {pts.map((p, i) => (
        <svg key={i} width="14" height="14" viewBox="0 0 14 14" style={{ position: 'absolute', left: p.x, top: p.y, animation: `twk ${p.dur}s ease-in-out infinite`, animationDelay: `${p.d}s` }}>
          <path d="M7 0 L8.4 5.6 14 7 8.4 8.4 7 14 5.6 8.4 0 7 5.6 5.6Z" fill="#fff" />
        </svg>
      ))}
    </div>
  )
}

export function Rain({ count = 16, area = { w: 360, h: 200 }, color = 'hsl(205 70% 72%)' }: { count?: number; area?: { w: number; h: number }; color?: string }) {
  const pts = useMemo(
    () => Array.from({ length: count }).map(() => ({ x: Math.random() * area.w, y: Math.random() * area.h * 0.4, d: Math.random() * 1.6, dur: 0.9 + Math.random() * 0.8, len: 8 + Math.random() * 8 })),
    [count, area.w, area.h]
  )
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {pts.map((p, i) => (
        <div key={i} style={{ position: 'absolute', left: p.x, top: p.y, width: 3, height: p.len, borderRadius: 9, background: color, animation: `rainFall ${p.dur}s linear infinite`, animationDelay: `${p.d}s`, opacity: 0.6 }} />
      ))}
    </div>
  )
}

export function Zzz({ x, y }: { x: number; y: number }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, pointerEvents: 'none' }}>
      {['z', 'z', 'z'].map((z, i) => (
        <span key={i} className="nn-disp" style={{ position: 'absolute', left: i * 13, top: -i * 6, fontWeight: 800, fontSize: 14 + i * 4, color: 'rgba(120,95,170,.6)', animation: 'zzzFloat 3.4s ease-in-out infinite', animationDelay: `${i * 0.5}s` }}>
          {z}
        </span>
      ))}
    </div>
  )
}
