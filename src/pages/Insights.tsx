// Insights: range-scoped water + token composition, focus split, distraction
// breakdown, and the all-time projects list. Backed by get_insights/get_projects.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { events } from '../lib/api'
import { useUsage } from '../store/usage'
import { useFocus } from '../store/focus'
import { usePrefs } from '../store/prefs'
import { hueSwatch, sessionTier } from '../lib/clay'
import { formatCount } from '../lib/format'
import type { Insights as InsightsData, Project, RangeKey, SessionPoint, TokenBreakdown } from '../types'
import { Card, Eyebrow, Donut, SegTabs } from '../components/ui'

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

// split a short duration ("185m" / "30s") into [number, unit] so the unit can be
// rendered smaller than the headline number.
function durParts(secs: number): [string, string] {
  const t = fmtSecs(secs)
  return [t.slice(0, -1), t.slice(-1)]
}

// read tokens 0.0002 mL each, output 0.0015 mL — mirrors src-tauri/src/water.rs
function waterFromTokens(t: TokenBreakdown): number {
  const read = (t.input || 0) + (t.cacheCreate || 0) + (t.cacheRead || 0)
  return 0.0002 * read + 0.0015 * (t.output || 0)
}

function WaterHero({ range, tokens }: { range: RangeKey; tokens: TokenBreakdown }) {
  const rl = RANGE_LABEL[range]
  const litres = Math.round(waterFromTokens(tokens) / 1000)
  return (
    <Card pad={22} style={{ display: 'flex', flexDirection: 'column' }}>
      <Eyebrow style={{ fontSize: 12, marginBottom: 12 }}>Water evaporated · {rl}</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="nn-num" style={{ fontSize: 52, fontWeight: 700, color: 'var(--ink)', lineHeight: 0.9 }}>{litres.toLocaleString()}</span>
        <span className="nn-disp" style={{ fontSize: 20, fontWeight: 600, color: 'var(--faint)' }}>litres</span>
      </div>
      {/* footnote pinned to the bottom so the card reads as header + footer at any height */}
      <div style={{ marginTop: 'auto', paddingTop: 13, borderTop: '1px solid var(--line-faint)', fontSize: 12, color: 'var(--faint)', lineHeight: 1.5 }}>
        ~<strong style={{ color: 'var(--text)', fontWeight: 600 }}>0.2 mL</strong> cooling water per 1,000 tokens read (output ~8× more) ·{' '}
        <a href="https://arxiv.org/abs/2304.03271" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>research ↗</a>
      </div>
    </Card>
  )
}

// concurrency reward color: more sessions → warmer/brighter (mirrors the
// creature's session tiers in lib/clay).
function tierColor(n: number, dark: boolean): string {
  const t = Math.round(n) // tiers are integer session counts; round the avg
  return t <= 0 ? hueSwatch(240, dark) : hueSwatch(sessionTier(t).hue, dark)
}

// SVG diverging time-graph: concurrency avg bars rise above a center line,
// distraction share (distractSecs / bucketSecs) hangs below — both on ONE shared
// scale where 1.0 distraction share == one concurrent session, so a 1× bucket is
// exactly a 1-session bar tall. Height is split by the data (peak sessions up /
// peak distraction down), so the top region is taller whenever concurrency > 1.
// The in-progress session bar breathes. bucketSecs = seconds one bar spans.
function SessionGraph({ series, dark, avg, bucketSecs }: { series: SessionPoint[]; dark: boolean; avg: number; bucketSecs: number }) {
  const W = 600, H = 184, padL = 10, padR = 10, padT = 14, padB = 24
  const innerW = W - padL - padR, innerH = H - padT - padB
  const n = series.length
  const fracOf = (p: SessionPoint) => (p.present && bucketSecs > 0 ? Math.min(1, (p.distractSecs ?? 0) / bucketSecs) : 0)
  const workFracOf = (p: SessionPoint) => (p.present && bucketSecs > 0 ? Math.min(1, (p.workSecs ?? 0) / bucketSecs) : 0)
  const maxBar = Math.max(0.001, ...series.map((p) => p.avg)) // sessions peak → tier color + label
  const maxUp = Math.max(0.001, ...series.map((p) => p.avg + workFracOf(p))) // stacked: work + sessions
  const maxFrac = Math.max(0, ...series.map(fracOf)) // 0..1
  const pps = innerH / (maxUp + Math.max(maxFrac, 0.0001)) // shared pixels-per-unit
  const topH = maxUp * pps
  const botH = innerH - topH
  const centerY = padT + topH
  const baseY = padT + innerH
  const cellW = innerW / n
  const gap = Math.min(cellW * 0.3, 3)
  const barW = Math.max(1, cellW - gap)
  const left = (i: number) => padL + i * cellW + gap / 2
  const sessColor = tierColor(maxBar, dark)
  const avgY = centerY - Math.min(topH, avg * pps)
  const firstFuture = series.findIndex((p) => p.future)
  // the in-progress bucket: cell just before the future track (or the last cell
  // when nothing is future). Its bar pulses so "now" reads as live.
  const nowIdx = firstFuture > 0 ? firstFuture - 1 : firstFuture < 0 ? n - 1 : -1

  // ~6 evenly spaced x labels (first … last)
  const ticks = Math.min(n, 6)
  const tickIdx = [...new Set(Array.from({ length: ticks }, (_, k) => Math.round((k * (n - 1)) / Math.max(1, ticks - 1))))]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', marginTop: 14, overflow: 'visible' }}>
      {/* faint "rest of period" track + a divider at now */}
      {firstFuture >= 0 && (
        <>
          <rect x={left(firstFuture) - gap / 2} y={padT} width={W - padR - (left(firstFuture) - gap / 2)} height={innerH} fill="var(--surface-strong)" opacity={0.35} />
          <line x1={left(firstFuture) - gap / 2} y1={padT} x2={left(firstFuture) - gap / 2} y2={baseY} stroke="var(--faint)" strokeWidth={1} strokeDasharray="2 2" opacity={0.6} />
        </>
      )}

      {/* center baseline + top-of-scale label (sessions ↑ / distraction ↓) */}
      <line x1={padL} y1={centerY} x2={W - padR} y2={centerY} stroke="var(--line)" strokeWidth={1} />
      <text x={padL} y={padT - 3} fontSize={10} fill="var(--faint)" className="nn-num">{maxBar.toFixed(1)}</text>

      {/* session avg line (top) */}
      {avg > 0 && (
        <>
          <line x1={padL} y1={avgY} x2={W - padR} y2={avgY} stroke="var(--faint)" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
          <text x={W - padR} y={avgY - 3} fontSize={9.5} fill="var(--faint)" textAnchor="end">avg {avg.toFixed(1)}</text>
        </>
      )}

      {/* bars: work layer (base, indigo) + Claude layer (stacked above) · distraction
          down (red) · dashed nub at center for gaps · nothing for future/idle. */}
      {series.map((p, i) => {
        if (p.future) return null
        if (!p.present) {
          return <line key={i} x1={left(i)} y1={centerY} x2={left(i) + barW} y2={centerY} stroke="var(--faint)" strokeWidth={2} strokeDasharray="2 3" opacity={0.4} />
        }
        const wf = workFracOf(p)
        const wh = Math.min(topH, wf * pps) // work layer (base, indigo)
        const sh = Math.min(topH - wh, p.avg * pps) // Claude layer, stacked above work
        const dh = Math.min(botH, fracOf(p) * pps) // distraction (downward, red)
        const rx = Math.min(2, barW / 2)
        // the in-progress bucket breathes — work + Claude layers pulse together.
        const pulse = i === nowIdx ? { animation: 'nn-bar-pulse 1.8s ease-in-out infinite' } : undefined
        return (
          <g key={i}>
            {/* work + Claude share ONE animated group so they breathe in exact sync
                (separate per-rect animations start on each element's own timeline and drift). */}
            <g style={pulse}>
              {wh > 0 && <rect x={left(i)} y={centerY - wh} width={barW} height={wh} rx={rx} fill="var(--work)" opacity={0.9} />}
              {p.avg > 0 && <rect x={left(i)} y={centerY - wh - sh} width={barW} height={sh} rx={rx} fill={sessColor} opacity={0.9} />}
              {wh > 0 && sh > 0 && <line x1={left(i)} y1={centerY - wh} x2={left(i) + barW} y2={centerY - wh} stroke="var(--surface)" strokeWidth={1} />}
            </g>
            {dh > 0 && <rect x={left(i)} y={centerY} width={barW} height={dh} rx={rx} fill="var(--critical)" opacity={0.85} />}
          </g>
        )
      })}

      {/* x labels */}
      {tickIdx.map((i) => (
        <text key={`l${i}`} x={left(i) + barW / 2} y={H - 7} fontSize={9.5} fill="var(--faint)" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="nn-num">{series[i].label}</text>
      ))}

      {/* per-bucket hover targets */}
      {series.map((p, i) => (
        <rect key={`h${i}`} x={padL + i * cellW} y={padT} width={cellW} height={innerH} fill="transparent">
          <title>{p.future ? `${p.label} · upcoming` : p.present ? `${p.label} · avg ${p.avg.toFixed(1)} sessions · ${fmtSecs(p.workSecs ?? 0)} work · ${fmtSecs(p.distractSecs ?? 0)} distracted (${fracOf(p).toFixed(2)})` : `${p.label} · no data`}</title>
        </rect>
      ))}
    </svg>
  )
}

function SessionsCard({ insights, range, dark }: { insights: InsightsData; range: RangeKey; dark: boolean }) {
  const rl = RANGE_LABEL[range]
  const series = insights.sessionSeries ?? []
  const avg = insights.avgSessions ?? 0
  // "clauding" = session-weighted Claude-working time; distracted = total lost
  // (honest day_stats totals, matching Home + the breakdown card).
  const claudingSecs = insights.claudeActiveSecs ?? 0
  const distractTotal = insights.distractSecs ?? 0
  const workAppTotal = insights.workAppSecs ?? 0
  const [claudingN, claudingU] = durParts(claudingSecs)
  const [distractN, distractU] = durParts(distractTotal)
  const [workN, workU] = durParts(workAppTotal)
  // wall-clock seconds one bar spans, for the distraction-share denominator.
  const bucketSecs = range === 'today' ? 15 * 60 : range === 'week' ? 2 * 3600 : 24 * 3600
  return (
    <Card pad={22}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Eyebrow style={{ fontSize: 12, marginBottom: 6 }}>Sessions &amp; distraction · {rl}</Eyebrow>
        <span style={{ fontSize: 11.5, color: 'var(--faint)', fontWeight: 500 }}>{range === 'today' ? '15-min' : range === 'week' ? '2-hour' : 'daily'}</span>
      </div>
      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="nn-num" style={{ fontSize: 40, fontWeight: 700, color: hueSwatch(40, dark), lineHeight: 0.9 }}>{claudingN}<span style={{ fontSize: 15 }}>{claudingU}</span></span>
          <span style={{ fontSize: 13, color: 'var(--faint)', fontWeight: 600 }}>clauding</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="nn-num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--work)', lineHeight: 0.9 }}>{workN}<span style={{ fontSize: 15 }}>{workU}</span></span>
          <span style={{ fontSize: 13, color: 'var(--faint)', fontWeight: 600 }}>work apps</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="nn-num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--critical)', lineHeight: 0.9 }}>{distractN}<span style={{ fontSize: 15 }}>{distractU}</span></span>
          <span style={{ fontSize: 13, color: 'var(--faint)', fontWeight: 600 }}>distracted</span>
        </div>
      </div>

      {series.length >= 2 ? (
        <SessionGraph series={series} dark={dark} avg={avg} bucketSecs={bucketSecs} />
      ) : (
        <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--faint)', lineHeight: 1.5 }}>
          Run more sessions side by side to warm your Nube — color climbs from indigo to gold as you fan out.
        </div>
      )}
    </Card>
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
  const refreshInsights = useUsage((s) => s.refreshInsights)
  const loaded = useUsage((s) => s.loaded)
  const dark = usePrefs((s) => s.theme) === 'dark'
  // live concurrency from the focus tick — running + waiting = the value the graph plots
  const concurrency = useFocus((s) => s.tick.runningSessions + s.tick.waitingSessions)

  // Keep the concurrency graph live: poll so the time axis advances and the
  // current bucket fills, and refresh instantly when the connector sees new
  // usage. Cadence scales with bucket size (today = 15-min cells, sampled often).
  useEffect(() => {
    const ms = range === 'today' ? 10_000 : range === 'week' ? 30_000 : 60_000
    const id = setInterval(() => void refreshInsights(), ms)
    const un = events.onUsageUpdated(() => void refreshInsights())
    return () => { clearInterval(id); void un.then((f) => f()) }
  }, [range, refreshInsights])

  // The moment concurrency actually changes (session starts/ends), pull fresh
  // insights so the current bucket reflects it without waiting for the poll.
  const prevConc = useRef(concurrency)
  useEffect(() => {
    if (prevConc.current === concurrency) return
    prevConc.current = concurrency
    void refreshInsights()
  }, [concurrency, refreshInsights])

  if (loaded && (!totals || totals.waterMl <= 0) && projects.length === 0) return <InsightsEmpty />

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

      {/* hero + token composition */}
      <div style={{ display: 'grid', gridTemplateColumns: TWO_UP, gap: 14, alignItems: 'stretch' }}>
        <WaterHero range={range} tokens={T} />
        <Card pad={20} style={{ display: 'flex', flexDirection: 'column' }}>
          <Eyebrow style={{ fontSize: 12, marginBottom: 12 }}>Token composition · {rl}</Eyebrow>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 24 }}>
            <Donut segments={toks.map((t) => ({ value: t.value, color: t.color }))} label={formatCount(totalTok)} sub="tokens" size={116} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minWidth: 0 }}>
              {toks.map((t) => (
                <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 500, color: 'var(--ink)', flex: 1 }}>{t.label}</span>
                  <span className="nn-num" style={{ color: 'var(--text)', fontWeight: 600 }}>{formatCount(t.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* concurrency history */}
      {insights && <SessionsCard insights={insights} range={range} dark={dark} />}

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
