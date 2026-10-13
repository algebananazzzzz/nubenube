// Insights: work vs rest over time, totals, and the top apps and sites.

import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useFocusView, useRules } from '../lib/derive'
import { FINISH, finishTier } from '../lib/economy'
import { fmtHM } from '../lib/format'
import { say } from '../store/toast'
import { Avatar, Bar, Card, Eyebrow, SegTabs, Stat } from '../components/ui'
import type { AppSlice, Insights as InsightsT, RangeKey, SeriesPoint } from '../types'

const RANGES: { key: RangeKey; label: string }[] = [{ key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'month', label: 'This month' }]
const BUCKET_SECS: Record<RangeKey, number> = { today: 900, week: 7200, month: 86400 }

// Finish-bonus step reached by the end of each bucket, for the tooltip. A gap
// or a rest-heavy bucket breaks the run.
function withTiers(series: SeriesPoint[], every: number) {
  let run = 0
  return series.map((p) => {
    run = !p.present || p.distract > 120 ? 0 : run + p.focus
    return { ...p, tier: finishTier(run, every) }
  })
}

// Diverging time graph: work above the line, shaded by bar height; rest below.
// Same scale both ways.
const focusShade = (p: number) => `color-mix(in oklab, var(--success) ${Math.round(30 + 70 * Math.max(0, Math.min(1, p)))}%, var(--surface-strong))`
const DIST = 'var(--critical)'

function TimeGraph({ series, range }: { series: (SeriesPoint & { tier: number })[]; range: RangeKey }) {
  const bucketSecs = BUCKET_SECS[range]
  const W = 600, H = 190, padL = 10, padR = 10, padT = 14, padB = 24
  const innerW = W - padL - padR, innerH = H - padT - padB, n = series.length
  const up = (p: SeriesPoint) => (p.present ? Math.min(1, p.focus / bucketSecs) : 0)
  const dn = (p: SeriesPoint) => (p.present ? Math.min(1, p.distract / bucketSecs) : 0)
  const maxUp = Math.max(0.001, ...series.map(up)), maxDn = Math.max(0.05, ...series.map(dn))
  const pps = innerH / (maxUp + maxDn), cy = padT + maxUp * pps, baseY = padT + innerH
  const cellW = innerW / n, gap = Math.min(cellW * 0.3, 3), bw = Math.max(1, cellW - gap)
  const left = (i: number) => padL + i * cellW + gap / 2
  const firstFuture = series.findIndex((p) => p.future)
  const nowIdx = firstFuture > 0 ? firstFuture - 1 : firstFuture < 0 ? n - 1 : -1
  const ticks = range === 'week' ? series.map((_, i) => (i % 12 === 0 ? i : -1)).filter((i) => i >= 0)
    : range === 'today' ? [0, 16, 32, 48, 64, 80, 95]
    : [...new Set(Array.from({ length: 6 }, (_, k) => Math.round((k * (n - 1)) / 5)))]
  const live = series.filter((p) => p.present && p.focus > 0)
  const avgUp = live.length ? live.reduce((a, p) => a + up(p), 0) / live.length : 0
  const avgY = cy - avgUp * pps
  const tipFmt = (s: number) => (bucketSecs >= 86400 ? fmtHM(s) : s >= 60 ? `${Math.round(s / 60)}m` : `${Math.round(s)}s`)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', marginTop: 14, overflow: 'visible' }}>
      {firstFuture >= 0 && (
        <g>
          <rect x={left(firstFuture) - gap / 2} y={padT} width={W - padR - (left(firstFuture) - gap / 2)} height={innerH} fill="var(--surface-strong)" opacity={0.35} />
          <line x1={left(firstFuture) - gap / 2} y1={padT} x2={left(firstFuture) - gap / 2} y2={baseY} stroke="var(--faint)" strokeWidth={1} strokeDasharray="2 2" opacity={0.6} />
        </g>
      )}
      {range === 'week' && ticks.slice(1).map((i) => <line key={`d${i}`} x1={padL + i * cellW} y1={padT} x2={padL + i * cellW} y2={baseY} stroke="var(--line-faint)" strokeWidth={1} />)}
      <line x1={padL} y1={cy} x2={W - padR} y2={cy} stroke="var(--line)" strokeWidth={1} />
      <text x={padL} y={padT - 3} fontSize={10} fill="var(--faint)" className="nn-num">{tipFmt(Math.round(maxUp * bucketSecs))}</text>
      {avgUp > 0 && (
        <g>
          <line x1={padL} y1={avgY} x2={W - padR} y2={avgY} stroke="var(--faint)" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
          <text x={W - padR} y={avgY - 3} fontSize={9.5} fill="var(--faint)" textAnchor="end">avg {tipFmt(Math.round(avgUp * bucketSecs))}</text>
        </g>
      )}
      {series.map((p, i) => {
        if (p.future) return null
        if (!p.present) return <line key={i} x1={left(i)} y1={cy} x2={left(i) + bw} y2={cy} stroke="var(--faint)" strokeWidth={2} strokeDasharray="2 3" opacity={0.4} />
        const fh = up(p) * pps, dh = dn(p) * pps, rx = Math.min(2, bw / 2)
        const pulse = i === nowIdx && range !== 'month' ? { animation: 'nn-bar-pulse 1.8s ease-in-out infinite' } : undefined
        return (
          <g key={i} style={pulse}>
            {fh > 0 && <rect x={left(i)} y={cy - fh} width={bw} height={fh} rx={rx} fill={focusShade(up(p) / maxUp)} />}
            {dh > 0 && <rect x={left(i)} y={cy} width={bw} height={dh} rx={rx} fill={DIST} />}
          </g>
        )
      })}
      {ticks.map((i) => (
        <text key={`l${i}`} x={range === 'week' ? padL + i * cellW + 2 : left(i) + bw / 2} y={H - 7} fontSize={9.5} fill="var(--faint)"
          textAnchor={range === 'week' ? 'start' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="nn-num">{series[i].label}</text>
      ))}
      {series.map((p, i) => (
        <rect key={`h${i}`} x={padL + i * cellW} y={padT} width={cellW} height={innerH} fill="transparent">
          <title>{p.future ? `${p.label} · upcoming`
            : p.present ? `${p.label}${range === 'week' ? ` ${String((i % 12) * 2).padStart(2, '0')}:00` : ''} · ${tipFmt(p.focus)} work${p.tier ? ` (×${FINISH[p.tier]})` : ''} · ${tipFmt(p.distract)} rest`
            : `${p.label} · no data`}</title>
        </rect>
      ))}
    </svg>
  )
}

function SourceList({ title, rows, tone, total }: { title: string; rows: AppSlice[]; tone: string; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.secs))
  return (
    <Card pad={20}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 12 }}>
        <Eyebrow style={{ fontSize: 11, flex: 1 }}>{title}</Eyebrow>
        <span className="nn-num" style={{ fontSize: 12, color: 'var(--faint)' }}>{fmtHM(total)}</span>
      </div>
      {rows.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>Nothing yet.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {rows.map((r) => (
          <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={r.name} size={22} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                <span className="nn-num" style={{ fontSize: 12, color: 'var(--text)', flexShrink: 0 }}>{fmtHM(r.secs)}</span>
              </div>
              <Bar pct={r.secs / max} color={tone} height={4} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function Insights() {
  const f = useFocusView(), s = useRules()
  const [range, setRange] = useState<RangeKey>('today')
  const [data, setData] = useState<InsightsT | null>(null)

  // Refetch every minute so the current bucket keeps filling.
  useEffect(() => {
    let live = true
    const load = () => api.getInsights(range).then((d) => { if (live) setData(d) }).catch((e) => say(`Couldn't load insights: ${e}`))
    void load()
    const id = setInterval(load, 60_000)
    return () => { live = false; clearInterval(id) }
  }, [range])

  const series = useMemo(() => withTiers(data?.series ?? [], s.finishEvery), [data, s.finishEvery])
  const focus = series.reduce((a, p) => a + p.focus, 0), distract = series.reduce((a, p) => a + p.distract, 0)
  const left = data ? data.earned - data.spent : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <SegTabs tabs={RANGES} value={range} onChange={setRange} size="sm" />
      </div>
      <Card pad={22}>
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
          <Eyebrow style={{ fontSize: 11, flex: 1 }}>{`Work & rest · ${range === 'today' ? '15-min' : range === 'week' ? '2-hour' : 'daily'}`}</Eyebrow>
          <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--faint)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-flex', gap: 2 }}>{[0, 0.33, 0.66, 1].map((v) => <span key={v} style={{ width: 8, height: 8, borderRadius: 2, background: focusShade(v) }} />)}</span>
              Work
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: DIST }} />Rest</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 28, marginTop: 14, flexWrap: 'wrap' }}>
          <Stat value={fmtHM(focus)} label="worked" size={40} color="var(--success)" />
          <Stat value={fmtHM(distract)} label="rested" color="var(--critical)" />
          <Stat value={fmtHM(left)} label="rest left" color={left >= 0 ? 'var(--ink)' : 'var(--critical)'} />
          {range === 'today'
            ? <Stat value={f.target ? `${Math.round(Math.min(1, f.targetPct) * 100)}%` : '—'} label="of today's target" />
            : <Stat value={data ? `${data.targetsHit}/${data.targetDays}` : '—'} label="targets hit" />}
        </div>
        {series.length > 0 && <TimeGraph series={series} range={range} />}
        <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 10 }}>Gaps are when you were away.</div>
      </Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 14 }}>
        <SourceList title="Work breakdown" rows={data?.focusApps ?? []} tone="var(--success)" total={focus} />
        <SourceList title="Rest breakdown" rows={data?.restApps ?? []} tone="var(--critical)" total={distract} />
      </div>
    </div>
  )
}
