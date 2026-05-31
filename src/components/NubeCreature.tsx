// NubeCreature.tsx — the Nube: a clay cloud-bloop with a full life-state ladder
// for the Tamagotchi mechanic. Ported from the Claude Design prototype (nube.jsx).
//
//   mood  : thriving | content | alert | worried | gasping | fading | faint
//   hue   : project colour (0..360)
//   size  : px width   |  scale: extra multiplier (water → size)
//   idle  : animate (default true)   |  accessory: null | 'party' | 'leaf' | 'crown'

import { useId } from 'react'
import type { NubeMood } from '../lib/derive'

type MoodCfg = {
  sat: number; lt: number; sx: number; sy: number; bs: number; op: number
  float: string | null; squish: string | null
  curl: 'sway' | 'flop'
  eye: 'star' | 'open' | 'wide' | 'sad' | 'wideSad' | 'closing' | 'faint'
  brow: 'up' | 'worried' | 'none'
  mouth: 'grin' | 'smile' | 'o' | 'gasp' | 'flat' | 'tiny'
  blush: number
  sparkle?: boolean; beat?: string | null; tail?: boolean
  bang?: boolean; sweat?: boolean; tear?: boolean; amber?: boolean; fainted?: boolean
}

export const NUBE_MOODS: Record<NubeMood, MoodCfg> = {
  thriving: { sat: 1.05, lt: 0, sx: 1.0, sy: 1.02, bs: 1.0, op: 1, float: 'nbFloat 3s ease-in-out infinite', squish: 'nbSquish 3.4s ease-in-out infinite', curl: 'sway', eye: 'star', brow: 'up', mouth: 'grin', blush: 1, sparkle: true, beat: null, tail: false },
  content: { sat: 1, lt: 0, sx: 1.0, sy: 1.0, bs: 0.98, op: 1, float: 'nbFloatSoft 4.4s ease-in-out infinite', squish: null, curl: 'flop', eye: 'open', brow: 'none', mouth: 'smile', blush: 0.8, sparkle: false, beat: null, tail: false },
  alert: { sat: 1.04, lt: 0, sx: 1.0, sy: 1.0, bs: 1.0, op: 1, float: 'nbFloat 2.2s ease-in-out infinite', squish: null, curl: 'sway', eye: 'wide', brow: 'up', mouth: 'o', blush: 0.9, sparkle: false, beat: null, bang: true, tail: false },
  worried: { sat: 0.74, lt: 1, sx: 1.0, sy: 0.99, bs: 0.88, op: 0.99, float: 'nbFloatSoft 3.4s ease-in-out infinite', squish: null, curl: 'flop', eye: 'sad', brow: 'worried', mouth: 'flat', blush: 0.5, sweat: true, beat: '2.4s', tail: false },
  gasping: { sat: 0.58, lt: 3, sx: 1.0, sy: 1.0, bs: 0.76, op: 0.98, float: 'nbFloatSoft 2.2s ease-in-out infinite', squish: 'nbGasp 1.3s ease-in-out infinite', curl: 'flop', eye: 'wideSad', brow: 'worried', mouth: 'gasp', blush: 0.42, sweat: true, beat: '1.1s', amber: true, tail: false },
  fading: { sat: 0.34, lt: 7, sx: 1.0, sy: 1.0, bs: 0.58, op: 0.9, float: 'nbFloatSoft 5.5s ease-in-out infinite', squish: null, curl: 'flop', eye: 'closing', brow: 'worried', mouth: 'tiny', blush: 0.26, tear: true, beat: '2.6s', tail: true },
  faint: { sat: 0.2, lt: 10, sx: 1.0, sy: 1.0, bs: 0.4, op: 0.86, float: 'nbFloatSoft 6s ease-in-out infinite', squish: null, curl: 'flop', eye: 'faint', brow: 'none', mouth: 'tiny', blush: 0.2, beat: null, fainted: true, tail: true },
}

export type NubeProps = {
  mood?: NubeMood
  hue?: number
  size?: number
  scale?: number
  accessory?: 'party' | 'leaf' | 'crown' | null
  idle?: boolean
}

const clamp = (v: number) => Math.max(0, Math.min(100, v))

export function NubeCreature({ mood = 'content', hue = 270, size = 200, scale = 1, accessory = null, idle = true }: NubeProps) {
  const m = NUBE_MOODS[mood] || NUBE_MOODS.content
  const sm = m.sat
  const la = m.lt
  const sc = (v: number) => clamp(v * sm)
  const lc = (v: number) => clamp(v + la)
  const c = {
    hi: `hsl(${hue} ${sc(92)}% ${lc(95)}%)`,
    light: `hsl(${hue} ${sc(84)}% ${lc(87)}%)`,
    mid: `hsl(${hue} ${sc(74)}% ${lc(77)}%)`,
    deep: `hsl(${hue} ${sc(62)}% ${lc(66)}%)`,
    ink: `hsl(${hue} ${sc(46)}% ${Math.max(30, lc(40))}%)`,
    soft: `hsl(${hue} ${sc(82)}% ${lc(96)}%)`,
    blush: `hsl(${(hue + 330) % 360} ${sc(86)}% ${lc(80)}%)`,
  }
  const uid = useId().replace(/:/g, '')
  const bodyGrad = `bg-${uid}`
  const curlGrad = `cg-${uid}`
  const occ = `oc-${uid}`
  const cy = 152
  const rx = 74
  const ry = 70
  const eyeY = 150
  const curlAnim = m.curl === 'sway' ? 'nbCurlSway' : 'nbCurlFlop'

  const eye = (cx: number, side: 'L' | 'R') => {
    const dir = side === 'L' ? -1 : 1
    const brow =
      m.brow === 'worried' ? (
        <path d={`M${cx - 9},139 Q${cx},135 ${cx + 9},141`} stroke={c.ink} strokeWidth="3" strokeLinecap="round" fill="none" opacity=".75" transform={`rotate(${dir * -8} ${cx} 138)`} />
      ) : m.brow === 'up' ? (
        <path d={`M${cx - 8},133 Q${cx},128 ${cx + 8},133`} stroke={c.ink} strokeWidth="3" strokeLinecap="round" fill="none" opacity=".55" />
      ) : null

    if (m.eye === 'faint')
      return (
        <g>
          {brow}
          <path d={`M${cx - 9},150 q4.5,-7 9,0 q-4.5,7 -9,0`} stroke={c.ink} strokeWidth="3.4" strokeLinecap="round" fill="none" opacity=".7" />
        </g>
      )
    if (m.eye === 'closing')
      return (
        <g>
          {brow}
          <path d={`M${cx - 11},150 Q${cx},156 ${cx + 11},150`} stroke={c.ink} strokeWidth="4.4" strokeLinecap="round" fill="none" />
        </g>
      )
    if (m.eye === 'sad' || m.eye === 'wideSad') {
      const r = m.eye === 'wideSad' ? 12.5 : 10
      return (
        <g>
          {brow}
          <g style={idle ? { animation: 'nbBlink 5s ease-in-out infinite', transformBox: 'fill-box', transformOrigin: 'center' } : undefined}>
            <ellipse cx={cx} cy="152" rx={r} ry={r + 1.5} fill={c.ink} />
            <circle cx={cx - 3} cy="148" r="3.4" fill="#fff" opacity=".92" />
          </g>
          <path d={`M${cx - 10},159 Q${cx},162 ${cx + 10},159`} stroke={c.ink} strokeWidth="2.4" strokeLinecap="round" fill="none" opacity=".5" />
        </g>
      )
    }
    const star = m.eye === 'star'
    const wide = m.eye === 'wide'
    const ry2 = star ? 18 : wide ? 17 : 16
    const rx2 = star ? 13.5 : wide ? 13 : 12.5
    return (
      <g>
        {brow}
        <g style={idle ? { animation: 'nbBlink 4.6s ease-in-out infinite', transformBox: 'fill-box', transformOrigin: 'center' } : undefined}>
          <ellipse cx={cx} cy="150" rx={rx2} ry={ry2} fill={c.ink} />
          <circle cx={cx - 4} cy="143" r={star || wide ? 6 : 5.2} fill="#fff" />
          <circle cx={cx + 4} cy="156" r="2.8" fill="#fff" opacity=".9" />
          {star && <path d={`M${cx + 5},143 l1.6,3 3,1.6 -3,1.6 -1.6,3 -1.6,-3 -3,-1.6 3,-1.6z`} fill="#fff" opacity=".95" />}
        </g>
      </g>
    )
  }

  const mouth = (() => {
    const t = m.mouth
    if (t === 'grin') return <path d="M84,176 Q100,194 116,176 Q100,184 84,176 Z" fill={c.ink} opacity=".82" />
    if (t === 'smile') return <path d="M89,178 Q100,188 111,178" stroke={c.ink} strokeWidth="3.5" strokeLinecap="round" fill="none" />
    if (t === 'o') return <ellipse cx="100" cy="180" rx="6.5" ry="8" fill={c.ink} opacity=".78" />
    if (t === 'gasp') return <ellipse cx="100" cy="182" rx="9" ry="11" fill={c.ink} opacity=".8" />
    if (t === 'flat') return <path d="M91,182 Q100,179 109,182" stroke={c.ink} strokeWidth="3" strokeLinecap="round" fill="none" />
    return <ellipse cx="100" cy="183" rx="3.6" ry="2.8" fill={c.ink} opacity=".7" />
  })()

  return (
    <svg width={size} height={size * 1.3} viewBox="0 0 200 260" style={{ overflow: 'visible', opacity: m.op }}>
      <defs>
        <radialGradient id={bodyGrad} cx="36%" cy="28%" r="80%">
          <stop offset="0%" stopColor={c.hi} />
          <stop offset="44%" stopColor={c.light} />
          <stop offset="80%" stopColor={c.mid} />
          <stop offset="100%" stopColor={c.deep} />
        </radialGradient>
        <linearGradient id={curlGrad} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={c.mid} />
          <stop offset="100%" stopColor={c.soft} />
        </linearGradient>
        <radialGradient id={occ} cx="50%" cy="52%" r="52%">
          <stop offset="58%" stopColor={c.deep} stopOpacity="0" />
          <stop offset="100%" stopColor={c.deep} stopOpacity=".5" />
        </radialGradient>
      </defs>

      <g transform={`translate(100,170) scale(${scale * m.bs}) translate(-100,-170)`}>
        <ellipse cx="100" cy="232" rx={54 * m.sx} ry="11" fill="hsl(270 30% 55%)" opacity=".16" />

        {m.beat && (
          <circle
            cx="100" cy={cy} r="86" fill={m.amber ? 'hsl(28 90% 70%)' : c.mid} opacity=".22"
            style={idle ? { animation: `nbHeart ${m.beat} ease-in-out infinite`, transformBox: 'fill-box', transformOrigin: 'center' } : undefined}
          />
        )}

        <g style={idle && m.float ? { animation: m.float, transformOrigin: '100px 150px' } : undefined}>
          {!m.fainted && (
            <g style={idle ? { animation: `${curlAnim} ${m.curl === 'sway' ? '3.6s' : '6s'} ease-in-out infinite`, transformOrigin: '100px 100px' } : undefined}>
              <path
                d={mood === 'thriving' ? 'M100,98 C92,52 118,26 132,40 C145,53 134,76 120,70' : 'M100,104 C96,72 113,52 127,60 C137,66 134,82 122,80'}
                fill="none" stroke={`url(#${curlGrad})`} strokeWidth="11" strokeLinecap="round"
              />
              <circle cx={mood === 'thriving' ? 121 : 123} cy={mood === 'thriving' ? 68 : 79} r="9" fill={c.soft} />
            </g>
          )}

          <g style={idle && m.squish ? { animation: m.squish, transformOrigin: '100px 178px' } : undefined}>
            <g transform={`translate(100,${cy}) scale(${m.sx},${m.sy}) translate(-100,-${cy})`}>
              {m.tail && (
                <g style={idle ? { animation: 'nbTailWag 2.6s ease-in-out infinite', transformBox: 'fill-box', transformOrigin: '30% 90%' } : undefined}>
                  <path
                    d={`M116,${cy + 36} C150,${cy + 30} 180,${cy + 40} 198,${cy + 58} C192,${cy + 56} 190,${cy + 64} 184,${cy + 62} C152,${cy + 56} 126,${cy + 52} 114,${cy + 46} Z`}
                    fill={c.mid} opacity=".92"
                  />
                  <circle cx="198" cy={cy + 58} r="5" fill={c.light} opacity=".9" />
                </g>
              )}
              <ellipse cx="34" cy="168" rx="13" ry="17" fill={c.mid} transform="rotate(-18 34 168)" />
              <ellipse cx="166" cy="168" rx="13" ry="17" fill={c.mid} transform="rotate(18 166 168)" />
              <ellipse cx="100" cy={cy} rx={rx} ry={ry} fill={`url(#${bodyGrad})`} />
              <ellipse cx="100" cy={cy} rx={rx} ry={ry} fill={`url(#${occ})`} />
              <ellipse cx="74" cy={cy - 36} rx="30" ry="20" fill="#fff" opacity=".42" transform={`rotate(-20 74 ${cy - 36})`} />
              <ellipse cx="74" cy={cy + 66} rx="15" ry="9" fill={c.deep} />
              <ellipse cx="126" cy={cy + 66} rx="15" ry="9" fill={c.deep} />
            </g>
          </g>

          <g transform={`translate(0,${eyeY - 150})`}>
            <ellipse cx="62" cy="166" rx="11" ry="7.5" fill={c.blush} opacity={m.blush} />
            <ellipse cx="138" cy="166" rx="11" ry="7.5" fill={c.blush} opacity={m.blush} />
            {eye(78, 'L')}
            {eye(122, 'R')}
            {mouth}
            {m.sweat && (
              <path
                d="M140,150 q-4,7 0,11 q4,-4 0,-11 z" fill="hsl(205 80% 82%)" stroke="hsl(205 60% 70%)" strokeWidth="1" opacity=".9"
                style={idle ? { animation: 'nbSweat 2.6s ease-in-out infinite', transformOrigin: '140px 150px' } : undefined}
              />
            )}
            {m.tear && (
              <path
                d="M120,160 q-4,7 0,11 q4,-4 0,-11 z" fill="hsl(205 80% 80%)" opacity=".9"
                style={idle ? { animation: 'nbTear 3.4s ease-in-out infinite', transformOrigin: '120px 160px' } : undefined}
              />
            )}
          </g>

          {m.bang && (
            <g transform="translate(150,96)" style={idle ? { animation: 'nbFloatSoft 1.4s ease-in-out infinite' } : undefined}>
              <circle cx="0" cy="0" r="15" fill="#fff" opacity=".92" />
              <rect x="-2.6" y="-9" width="5.2" height="11" rx="2.6" fill={c.deep} />
              <circle cx="0" cy="6.5" r="2.8" fill={c.deep} />
            </g>
          )}

          {accessory === 'party' && (
            <g transform="translate(100,82)">
              <path d="M-22,8 L0,-34 L22,8 Z" fill={`hsl(${(hue + 40) % 360} 80% 72%)`} />
              <circle cx="0" cy="-36" r="6" fill="#fff" />
            </g>
          )}
          {accessory === 'crown' && (
            <g transform="translate(100,80)" fill="hsl(44 85% 70%)">
              {[-16, 0, 16].map((dx, i) => (
                <path key={i} d={`M${dx},${i === 1 ? -14 : -6} l5,16 l-10,0 z`} />
              ))}
            </g>
          )}
          {accessory === 'leaf' && <path d="M100,88 q-16,-20 2,-30 q14,12 -2,30z" fill="hsl(140 55% 70%)" />}

          {m.sparkle && (
            <g fill={c.soft} opacity=".95">
              <path d="M30,120 l2,5 5,2 -5,2 -2,5 -2,-5 -5,-2 5,-2z" style={idle ? { animation: 'nbTwinkle 2.4s ease-in-out infinite' } : undefined} />
              <path d="M172,108 l2.4,6 6,2.4 -6,2.4 -2.4,6 -2.4,-6 -6,-2.4 6,-2.4z" style={idle ? { animation: 'nbTwinkle 2.8s ease-in-out infinite .6s' } : undefined} />
            </g>
          )}
        </g>
      </g>
    </svg>
  )
}
