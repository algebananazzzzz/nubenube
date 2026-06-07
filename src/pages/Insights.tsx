// Insights: range-scoped water + token composition, focus split, distraction
// breakdown, and the all-time projects list. Backed by get_insights/get_projects.

import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUsage } from '../store/usage'
import { usePrefs } from '../store/prefs'
import { hueSwatch, sessionTier } from '../lib/clay'
import { formatCount } from '../lib/format'
import type { Insights as InsightsData, Project, RangeKey, SessionPoint, TokenBreakdown } from '../types'
import { Card, Pill, Eyebrow, Donut, SegTabs } from '../components/ui'

const RANGE_LABEL: Record<RangeKey, string> = {
  today: 'today', week: 'this week', month: 'this month', all: 'all-time',
}

// responsive 2-up that collapses to 1 column below ~620px content width
const TWO_UP = 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))'

function sumTokens(t: TokenBreakdown): number {
  return (t.input || 0) + (t.output || 0) + (t.cacheCreate || 0) + (t.cacheRead || 0)
}

function fmtSecs(s: number): string {
  return s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`
}

// read tokens 0.0002 mL each, output 0.0015 mL — mirrors src-tauri/src/water.rs
function waterFromTokens(t: TokenBreakdown): number {
  const read = (t.input || 0) + (t.cacheCreate || 0) + (t.cacheRead || 0)
  return 0.0002 * read + 0.0015 * (t.output || 0)
}

function WaterHero({ range, tokens }: { range: RangeKey; tokens: TokenBreakdown }) {
  const rl = RANGE_LABEL[range]
  const litres = Math.round(waterFromTokens(tokens) / 1000)
  const tokCount = formatCount(sumTokens(tokens))
  return (
    <Card pad={22}>
      <Eyebrow style={{ fontSize: 12, marginBottom: 12 }}>Water evaporated · {rl}</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="nn-num" style={{ fontSize: 52, fontWeight: 700, color: 'var(--ink)', lineHeight: 0.9 }}>{litres.toLocaleString()}</span>
        <span className="nn-disp" style={{ fontSize: 20, fontWeight: 600, color: 'var(--faint)' }}>litres</span>
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        <Pill kind="neutral" style={{ fontSize: 12 }}>{tokCount} tokens {rl}</Pill>
      </div>
      <div style={{ marginTop: 13, paddingTop: 13, borderTop: '1px solid var(--line-faint)', display: 'flex', gap: 8, fontSize: 12, color: 'var(--faint)', lineHeight: 1.5 }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7.2v3.4" strokeLinecap="round" />
          <circle cx="8" cy="5" r=".7" fill="currentColor" stroke="none" />
        </svg>
        <span>
          Estimation: about <strong style={{ color: 'var(--text)', fontWeight: 600 }}>0.2 mL</strong> of data-center cooling water per 1,000 tokens read (output tokens cost ~8× more), grounded in{' '}
          <a href="https://arxiv.org/abs/2304.03271" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>real research ↗</a>
        </span>
      </div>
    </Card>
  )
}

// concurrency reward color: more sessions → warmer/brighter (mirrors the
// creature's session tiers in lib/clay).
function tierColor(n: number, dark: boolean): string {
  return n <= 0 ? hueSwatch(240, dark) : hueSwatch(sessionTier(n).hue, dark)
}

// SVG area time-graph of peak concurrency across the chosen period. viewBox is
// fixed and the svg scales to its container width (height:auto) so strokes stay
// undistorted. x = time buckets (hourly today / daily otherwise), y = peak.
function SessionGraph({ series, dark, peak, avg }: { series: SessionPoint[]; dark: boolean; peak: number; avg: number }) {
  const gid = useId()
  const W = 600, H = 150, padL = 10, padR = 10, padT = 12, padB = 22
  const innerW = W - padL - padR, innerH = H - padT - padB, baseY = padT + innerH
  const n = series.length
  const maxPeak = Math.max(peak, 1)
  const x = (i: number) => (n > 1 ? padL + (i / (n - 1)) * innerW : padL + innerW / 2)
  const y = (v: number) => padT + (1 - Math.min(1, v / maxPeak)) * innerH
  const stroke = tierColor(peak, dark)

  const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.peak).toFixed(1)}`)
  const line = `M${pts.join(' L')}`
  const area = `M${x(0).toFixed(1)},${baseY} L${pts.join(' L')} L${x(n - 1).toFixed(1)},${baseY} Z`

  // ~6 evenly spaced x labels (first … last)
  const ticks = Math.min(n, 6)
  const tickIdx = Array.from({ length: ticks }, (_, k) => Math.round((k * (n - 1)) / Math.max(1, ticks - 1)))
  const uniqTicks = [...new Set(tickIdx)]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', marginTop: 14, overflow: 'visible' }}>
      <defs>
        <linearGradient id={`grad-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.34} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
        </linearGradient>
      </defs>

      {/* top + base gridlines */}
      <line x1={padL} y1={padT} x2={W - padR} y2={padT} stroke="var(--line-faint)" strokeWidth={1} />
      <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="var(--line)" strokeWidth={1} />
      <text x={padL} y={padT - 3} fontSize={10} fill="var(--faint)" className="nn-num">{maxPeak}</text>

      {/* avg reference line */}
      {avg > 0 && (
        <>
          <line x1={padL} y1={y(avg)} x2={W - padR} y2={y(avg)} stroke="var(--faint)" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
          <text x={W - padR} y={y(avg) - 3} fontSize={9.5} fill="var(--faint)" textAnchor="end">avg {avg.toFixed(1)}</text>
        </>
      )}

      <path d={area} fill={`url(#grad-${gid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* x labels */}
      {uniqTicks.map((i) => (
        <text key={i} x={x(i)} y={H - 6} fontSize={9.5} fill="var(--faint)" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="nn-num">{series[i].label}</text>
      ))}

      {/* per-bucket hover targets */}
      {series.map((p, i) => {
        const w = n > 1 ? innerW / (n - 1) : innerW
        return (
          <rect key={i} x={x(i) - w / 2} y={padT} width={w} height={innerH} fill="transparent">
            <title>{`${p.label} · peak ${p.peak}, avg ${p.avg.toFixed(1)}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

function SessionsCard({ insights, range, dark }: { insights: InsightsData; range: RangeKey; dark: boolean }) {
  const rl = RANGE_LABEL[range]
  const series = insights.sessionSeries ?? []
  const peak = insights.peakSessions ?? 0
  const avg = insights.avgSessions ?? 0
  return (
    <Card pad={22}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Eyebrow style={{ fontSize: 12, marginBottom: 6 }}>Concurrent sessions · {rl}</Eyebrow>
        <span style={{ fontSize: 11.5, color: 'var(--faint)', fontWeight: 500 }}>running + waiting · {range === 'today' ? 'hourly' : 'daily'}</span>
      </div>
      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-end', marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="nn-num" style={{ fontSize: 40, fontWeight: 700, color: tierColor(peak, dark), lineHeight: 0.9 }}>{peak}</span>
          <span style={{ fontSize: 13, color: 'var(--faint)', fontWeight: 600 }}>peak</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="nn-num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', lineHeight: 0.9 }}>{avg.toFixed(1)}</span>
          <span style={{ fontSize: 13, color: 'var(--faint)', fontWeight: 600 }}>avg</span>
        </div>
      </div>

      {peak > 0 && series.length >= 2 ? (
        <SessionGraph series={series} dark={dark} peak={peak} avg={avg} />
      ) : (
        <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--faint)', lineHeight: 1.5 }}>
          Run more sessions side by side to warm your Nube — color climbs from indigo to gold as you fan out.
        </div>
      )}
    </Card>
  )
}

function FocusRow({ label, value, tone, last }: { label: string; value: string; tone?: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderBottom: last ? 'none' : '1px solid var(--line-faint)' }}>
      <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{label}</span>
      <span className="nn-num" style={{ fontSize: 14, fontWeight: 600, color: tone || 'var(--ink)' }}>{value}</span>
    </div>
  )
}

function DistractionRow({ name, secs, max, last }: { name: string; secs: number; max: number; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0', borderBottom: last ? 'none' : '1px solid var(--line-faint)' }}>
      <div style={{ width: 108, fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', flexShrink: 0 }}>{name}</div>
      <div style={{ flex: 1 }}>
        <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-strong)', overflow: 'hidden' }}>
          <div style={{ width: `${Math.max(8, (secs / max) * 100)}%`, height: '100%', borderRadius: 999, background: 'var(--warning)' }} />
        </div>
      </div>
      <div className="nn-num" style={{ width: 38, textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--critical)' }}>{fmtSecs(secs)}</div>
    </div>
  )
}

function ProjectRow({ p, last }: { p: Project; last?: boolean }) {
  const [h, setH] = useState(false)
  const navigate = useNavigate()
  const dark = usePrefs((s) => s.theme) === 'dark'
  const litres = Math.round(p.waterMl / 1000)
  return (
    <div
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      onClick={() => navigate(`/project/${encodeURIComponent(p.id)}`)}
      style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '11px 12px', borderRadius: 'var(--r-sm)', cursor: 'pointer', background: h ? 'var(--surface-hover)' : 'transparent', borderBottom: last ? 'none' : '1px solid var(--line-faint)', transition: 'background .14s' }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: hueSwatch(p.colorHue, dark), flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
        <div className="nn-mono" style={{ fontSize: 11.5, color: 'var(--faint)', fontWeight: 500, marginTop: 2 }}>{p.rootPath}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
        <span className="nn-num" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{litres} L</span>
        <span className="nn-num" style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--faint)' }}>/ {formatCount(sumTokens(p.tokens))}</span>
      </div>
      <span className="nn-ui" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, padding: '5px 10px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', background: h ? 'var(--surface)' : 'transparent', color: 'var(--text)', fontSize: 12, fontWeight: 600, transition: 'background .14s', opacity: h ? 1 : 0.55 }}>
        Details
      </span>
    </div>
  )
}

function InsightsEmpty() {
  return (
    <Card pad={40} style={{ textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, margin: '0 auto 16px', borderRadius: 'var(--r-md)', background: 'var(--surface-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)' }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M4 20V6M4 20h16M9 16l3.5-4.5L16 13l4-6" />
        </svg>
      </div>
      <div className="nn-disp" style={{ fontSize: 18, color: 'var(--ink)', marginBottom: 8 }}>Nothing to show yet</div>
      <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.55, maxWidth: '40ch', margin: '0 auto' }}>
        Work with Claude for a while and your focus trends, distractions, and water output collect here.
      </div>
    </Card>
  )
}

export function Insights() {
  const totals = useUsage((s) => s.totals)
  const insights = useUsage((s) => s.insights)
  const projects = useUsage((s) => s.projects)
  const range = useUsage((s) => s.range)
  const setRange = useUsage((s) => s.setRange)
  const loaded = useUsage((s) => s.loaded)
  const dark = usePrefs((s) => s.theme) === 'dark'

  if (loaded && (!totals || totals.waterMl <= 0) && projects.length === 0) return <InsightsEmpty />

  const dist = insights?.distractionBreakdown ?? []
  const maxD = Math.max(...dist.map((d) => d.secs), 1)
  const totalDistract = dist.reduce((a, d) => a + d.secs, 0)
  const rl = RANGE_LABEL[range]

  const T = insights?.tokens ?? { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }
  const toks = [
    { label: 'cache read', value: T.cacheRead, color: 'var(--accent)' },
    { label: 'cache write', value: T.cacheCreate, color: '#a5b4fc' },
    { label: 'output', value: T.output, color: '#c7d2fe' },
    { label: 'input', value: T.input, color: '#4f46e5' },
  ]
  const totalTok = toks.reduce((a, t) => a + t.value, 0) || 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <SegTabs<RangeKey>
          tabs={[
            { key: 'today', label: 'Today' },
            { key: 'week', label: 'Week' },
            { key: 'month', label: 'Month' },
            { key: 'all', label: 'All-time' },
          ]}
          value={range} onChange={(r) => void setRange(r)} size="sm" />
      </div>

      {/* hero + key stats */}
      <div style={{ display: 'grid', gridTemplateColumns: TWO_UP, gap: 14, alignItems: 'stretch' }}>
        <WaterHero range={range} tokens={T} />
        <Card pad={20}>
          <Eyebrow style={{ fontSize: 12, marginBottom: 6 }}>{rl}</Eyebrow>
          <FocusRow label="Claude working" value={fmtSecs(insights?.claudeActiveSecs ?? 0)} tone="var(--success)" />
          <FocusRow label="Claude idle" value={fmtSecs(insights?.claudeIdleSecs ?? 0)} tone="var(--warning)" />
          <FocusRow label="Time on distractions" value={fmtSecs(totalDistract)} tone="var(--critical)" last />
        </Card>
      </div>

      {/* concurrency history */}
      {insights && <SessionsCard insights={insights} range={range} dark={dark} />}

      {/* distractions */}
      <Card pad={22}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Eyebrow style={{ fontSize: 12, marginBottom: 6 }}>Time lost to distractions · {rl}</Eyebrow>
          <span className="nn-num" style={{ fontSize: 14, fontWeight: 600, color: 'var(--critical)' }}>{fmtSecs(totalDistract)}</span>
        </div>
        {dist.length === 0 && (
          <div style={{ textAlign: 'center', padding: '16px 0 4px', color: 'var(--faint)', fontSize: 13 }}>No distractions tracked {rl}. Nice.</div>
        )}
        {dist.map((d, i) => (
          <DistractionRow key={d.name} name={d.name} secs={d.secs} max={maxD} last={i === dist.length - 1} />
        ))}
      </Card>

      {/* token composition */}
      <Card pad={20}>
        <Eyebrow style={{ fontSize: 12, marginBottom: 12 }}>Token composition · {rl}</Eyebrow>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Donut segments={toks.map((t) => ({ value: t.value, color: t.color }))} label={formatCount(totalTok)} sub="tokens" size={116} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minWidth: 0 }}>
            {toks.map((t) => (
              <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 500, color: 'var(--ink)', flex: 1 }}>{t.label}</span>
                <span className="nn-num" style={{ color: 'var(--text)', fontWeight: 600 }}>{formatCount(t.value)}</span>
                <span className="nn-num" style={{ color: 'var(--faint)', fontWeight: 500, width: 34, textAlign: 'right' }}>{Math.round((t.value / totalTok) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* projects */}
      <Card pad={14}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '6px 12px 8px' }}>
          <Eyebrow style={{ fontSize: 12 }}>Projects · all time</Eyebrow>
          <span style={{ fontSize: 12, color: 'var(--faint)', fontWeight: 500 }}>{totals?.projectCount ?? projects.length} projects</span>
        </div>
        {projects.map((p, i) => (
          <ProjectRow key={p.id} p={p} last={i === projects.length - 1} />
        ))}
      </Card>
    </div>
  )
}
