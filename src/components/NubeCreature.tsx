// Nube creature: flat CSS/SVG blob tinted by --clay-* vars. Face, body, and the
// status-tinted "sky" panel are pure functions of mood/sky props.

import type { CSSProperties, ReactNode } from 'react'
import type { Mood, Sky as SkyKind } from '../lib/derive'

// sky → status tint behind the creature
function skyTint(sky: SkyKind): string {
  switch (sky) {
    case 'good':
    case 'working': return 'var(--success-surface)'
    case 'alert': return 'var(--warning-surface)'
    case 'worried':
    case 'danger': return 'var(--critical-surface)'
    case 'calm': return 'rgba(120,124,136,.13)'   // paused — neutral grey
    case 'idle': return 'var(--accent-surface)'    // idle — muted indigo
    default: return 'transparent'
  }
}

export function Sky({ sky, children, style }: { sky: SkyKind; children?: ReactNode; style?: CSSProperties }) {
  const tint = skyTint(sky)
  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 'inherit', background: 'var(--surface-faint)', transition: 'background .6s var(--ease-soft)', ...style }}>
      {tint !== 'transparent' && (
        <div style={{ position: 'absolute', inset: 0, background: tint, opacity: 1, transition: 'background .6s var(--ease-soft)', pointerEvents: 'none' }} />
      )}
      {children}
    </div>
  )
}

const EYE = '#26282e'

function Face({ mood, B }: { mood: Mood; B: number }) {
  const cx = B / 2, eyeY = B * 0.46, dx = B * 0.165
  const rx = B * 0.07, ry = B * 0.10
  const closed = mood === 'faint'
  const wide = mood === 'gasping'
  const half = mood === 'fading'
  const happy = mood === 'thriving' || mood === 'content' || mood === 'alert'

  const Eye = ({ x }: { x: number }) => {
    if (closed) return <path d={`M${x - rx * 1.5} ${eyeY} q ${rx * 1.5} ${ry * 0.9} ${rx * 3} 0`} stroke={EYE} strokeWidth={B * 0.022} fill="none" strokeLinecap="round" />
    const ery = half ? ry * 0.5 : wide ? ry * 1.18 : ry
    return (
      <g>
        <ellipse cx={x} cy={eyeY} rx={rx} ry={ery} fill={EYE} />
        {!half && <circle cx={x - rx * 0.3} cy={eyeY - ery * 0.4} r={rx * 0.4} fill="#fff" />}
      </g>
    )
  }

  let mouth: ReactNode
  const my = B * 0.62, mw = B * 0.11
  if (mood === 'thriving') mouth = <path d={`M${cx - mw} ${my - 1} q ${mw} ${mw * 1.5} ${mw * 2} 0`} stroke={EYE} strokeWidth={B * 0.026} fill="none" strokeLinecap="round" />
  else if (happy) mouth = <path d={`M${cx - mw * 0.85} ${my} q ${mw * 0.85} ${mw} ${mw * 1.7} 0`} stroke={EYE} strokeWidth={B * 0.024} fill="none" strokeLinecap="round" />
  else if (mood === 'worried') mouth = <path d={`M${cx - mw * 0.7} ${my + 2} q ${mw * 0.7} ${-mw * 0.55} ${mw * 1.4} 0`} stroke={EYE} strokeWidth={B * 0.022} fill="none" strokeLinecap="round" />
  else if (mood === 'gasping') mouth = <ellipse cx={cx} cy={my + 3} rx={mw * 0.46} ry={mw * 0.66} fill={EYE} opacity=".85" />
  else if (mood === 'fading') mouth = <path d={`M${cx - mw * 0.6} ${my + 2} q ${mw * 0.6} ${-mw * 0.6} ${mw * 1.2} 0`} stroke={EYE} strokeWidth={B * 0.02} fill="none" strokeLinecap="round" opacity=".7" />
  else mouth = <line x1={cx - mw * 0.5} y1={my} x2={cx + mw * 0.5} y2={my} stroke={EYE} strokeWidth={B * 0.018} strokeLinecap="round" opacity=".6" />

  const cheek = happy ? 0.85 : mood === 'worried' || mood === 'gasping' ? 0.4 : 0.15
  return (
    <svg width={B} height={B} viewBox={`0 0 ${B} ${B}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      <ellipse cx={cx - dx - rx * 0.8} cy={B * 0.57} rx={B * 0.08} ry={B * 0.048} fill="var(--clay-cheek)" opacity={cheek} />
      <ellipse cx={cx + dx + rx * 0.8} cy={B * 0.57} rx={B * 0.08} ry={B * 0.048} fill="var(--clay-cheek)" opacity={cheek} />
      <g style={{ animation: closed ? 'none' : 'nn-blink 5.5s steps(1) infinite', transformOrigin: `${cx}px ${eyeY}px` }}>
        <Eye x={cx - dx} /><Eye x={cx + dx} />
      </g>
      {mouth}
    </svg>
  )
}

export function Nube({ mood, size = 200 }: { mood: Mood; size?: number }) {
  const s = size
  const B = s * 0.84
  const low = mood === 'fading' || mood === 'faint'
  const float = mood === 'faint' ? 'none' : 'nn-bob 4.6s var(--ease) infinite'
  const sink = mood === 'faint' ? 'translateY(7px)' : mood === 'fading' ? 'translateY(3px)' : 'none'
  const bodyOpacity = mood === 'faint' ? 0.7 : mood === 'fading' ? 0.86 : 1

  const foot: CSSProperties = { position: 'absolute', bottom: s * 0.05, width: s * 0.16, height: s * 0.1, borderRadius: '50%', background: 'var(--clay-deep)' }

  return (
    <div style={{ position: 'relative', width: s, height: s * 1.04, transform: sink, transition: 'transform .7s var(--ease-soft)' }}>
      <div style={{ position: 'absolute', left: '50%', bottom: s * 0.02, width: s * 0.5, height: s * 0.06, transform: 'translateX(-50%)', borderRadius: '50%', background: 'rgba(0,0,0,.10)', filter: 'blur(4px)' }} />

      <div style={{ position: 'absolute', inset: 0, animation: float, opacity: bodyOpacity, transition: 'opacity .7s' }}>
        <div style={{ ...foot, left: s * 0.3, transform: 'rotate(-10deg)' }} />
        <div style={{ ...foot, right: s * 0.3, transform: 'rotate(10deg)' }} />

        <div style={{
          position: 'absolute', left: (s - B) / 2, top: s * 0.1, width: B, height: B, borderRadius: '50%',
          background: 'var(--clay-mid)', boxShadow: 'inset 0 0 0 1px var(--clay-deep)',
        }}>
          <div style={{ position: 'absolute', top: B * 0.08, left: B * 0.14, width: B * 0.5, height: B * 0.34, borderRadius: '50%', background: 'var(--clay-light)', opacity: low ? 0.4 : 0.7 }} />
          <Face mood={mood} B={B} />
        </div>
      </div>
    </div>
  )
}
