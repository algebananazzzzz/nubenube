// ProjectDetail — where the water went for one project: token & cache
// composition, focus vs distraction, and the last-7-days rhythm. All real,
// from get_project_detail (project + per-day history).

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, type ProjectDetail as Detail } from '../lib/api'
import { Donut, Meter, Btn, INK, SUB, FAINT, shadow, elev, fmt } from '../components/ui'
import { hueClay } from '../lib/clay'
import { projectStatus, tokenSegs, sumTokenM, type TokenSeg } from '../lib/derive'
import { formatCount, formatDuration } from '../lib/format'
import type { DayPoint } from '../types'

const litres = (ml: number) => ml / 1000

function MetricTile({ label, value, unit, sub, color }: { label: string; value: string; unit?: string; sub?: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: '13px 14px', background: 'var(--surface)', borderRadius: 13, border: elev.border, boxShadow: shadow.sm }}>
      <div style={{ fontWeight: 700, fontSize: 10, color: FAINT, letterSpacing: '.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 5, whiteSpace: 'nowrap' }}>
        <span className="nn-num" style={{ fontWeight: 800, fontSize: 22, color: color || INK, lineHeight: 1 }}>{value}</span>
        {unit && <span style={{ fontWeight: 700, fontSize: 11.5, color: SUB }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontWeight: 600, fontSize: 10.5, color: FAINT, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function LegendRow({ s, total }: { s: TokenSeg; total: number }) {
  const pct = total > 0 ? Math.round((s.value / total) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 11, height: 11, borderRadius: 4, background: s.color, flexShrink: 0 }} />
      <span style={{ fontWeight: 700, fontSize: 12.5, color: INK, flex: 1 }}>{s.label}</span>
      <span className="nn-num" style={{ fontWeight: 800, fontSize: 12.5, color: INK }}>{fmt(s.value, 1)}M</span>
      <span style={{ fontWeight: 700, fontSize: 11.5, color: FAINT, width: 36, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

export function ProjectDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let alive = true
    setDetail(null)
    setNotFound(false)
    api.getProjectDetail(decodeURIComponent(id)).then((r) => {
      if (!alive) return
      if (r.data) setDetail(r.data)
      else setNotFound(true)
    })
    return () => { alive = false }
  }, [id])

  if (notFound) {
    return (
      <div className="nn-ui" style={{ height: '100%', display: 'grid', placeItems: 'center', gap: 12, color: SUB, fontWeight: 600, textAlign: 'center' }}>
        <div>this bloop drifted away.</div>
        <Btn hue={268} kind="soft" size="sm" onClick={() => navigate('/insights')}>back to insights</Btn>
      </div>
    )
  }
  if (!detail) {
    return <div className="nn-ui" style={{ height: '100%', display: 'grid', placeItems: 'center', color: FAINT, fontWeight: 600 }}>loading bloop…</div>
  }

  const p = detail.project
  const byDay: DayPoint[] = detail.byDay ?? []
  const c = hueClay(p.colorHue)
  const st = projectStatus(p)
  const faint = st.mood === 'faint'
  const segs = tokenSegs(p.tokens, p.colorHue)
  const totalTok = sumTokenM(p.tokens)

  const last7 = byDay.slice(-7)
  const maxDay = Math.max(...last7.map((d) => d.waterMl), 1)
  const focusSecs = byDay.reduce((s, d) => s + d.claudeActiveSecs, 0)
  const driftSecs = byDay.reduce((s, d) => s + d.driftSecs, 0)
  const activeDays = byDay.filter((d) => d.waterMl > 0).length
  const dayLabel = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2)

  return (
    <div className="nn-ui" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px 12px' }}>
        <button onClick={() => navigate('/insights')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent', cursor: 'pointer', color: SUB, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={SUB} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
          Insights
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 12, color: faint ? '#c47a3a' : SUB }}>{st.label}</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 22px 22px' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '6px 0 16px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="nn-disp" style={{ fontWeight: 800, fontSize: 26, color: c.ink, lineHeight: 1, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
            <div style={{ fontWeight: 600, fontSize: 13, color: SUB, marginTop: 6 }}>
              <b className="nn-num" style={{ color: INK }}>{fmt(litres(p.waterMl), 0)} L</b> evaporated · <b className="nn-num" style={{ color: INK }}>{formatCount(totalTok * 1e6)}</b> tokens · <b className="nn-num" style={{ color: INK }}>{formatCount(p.msgCount)}</b> messages
            </div>
            <div style={{ fontWeight: 600, fontSize: 11.5, color: FAINT, marginTop: 3 }}>{p.rootPath}</div>
          </div>
        </div>

        {/* low-life note (quiet — no creature) */}
        {faint && (
          <div style={{ marginBottom: 14, padding: '12px 16px', borderRadius: 14, background: 'var(--surface)', border: elev.border, boxShadow: shadow.sm }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 12.5, color: '#c47a3a' }}>low on life · {Math.round(p.cloudHealth * 100)}%</span>
              <span style={{ fontWeight: 600, fontSize: 11.5, color: FAINT }}>get back to work to revive · 1 L ≈ 10 min focus</span>
            </div>
            <Meter value={p.cloudHealth} hue={26} height={10} danger />
          </div>
        )}

        {/* metric tiles */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <MetricTile label="water · lifetime" value={fmt(litres(p.waterMl), 0)} unit="L" sub={`${fmt(litres(p.monthlyWaterMl), 1)} L this month`} color={c.deep} />
          <MetricTile label="evaporated today" value={fmt(litres(p.todayWaterMl), 1)} unit="L" sub={`≈ ${formatDuration(p.claudeActiveSecsToday)} active`} />
          <MetricTile label="focus time" value={fmt(focusSecs / 3600, 0)} unit="h" sub={`${activeDays} active days`} />
          <MetricTile label="time distracted" value={formatDuration(driftSecs)} sub="Claude waited" color="var(--danger)" />
        </div>

        {/* two columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 13 }}>
          {/* token composition */}
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 18, border: elev.border, boxShadow: shadow.md }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: SUB, letterSpacing: '.02em', marginBottom: 4 }}>TOKEN COMPOSITION</div>
            <div style={{ fontWeight: 600, fontSize: 11.5, color: FAINT, marginBottom: 12 }}>cache reads dominate — that's Claude recalling your codebase</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <Donut
                segs={segs}
                size={128}
                thickness={19}
                center={
                  <div style={{ textAlign: 'center' }}>
                    <div className="nn-num" style={{ fontWeight: 800, fontSize: 22, color: INK, lineHeight: 1 }}>{fmt(totalTok, 1)}M</div>
                    <div style={{ fontWeight: 700, fontSize: 10, color: FAINT, letterSpacing: '.04em' }}>tokens</div>
                  </div>
                }
              />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11 }}>
                {segs.map((s) => (
                  <LegendRow key={s.key} s={s} total={totalTok} />
                ))}
              </div>
            </div>
          </div>

          {/* focus & last 7 days */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 18, border: elev.border, boxShadow: shadow.md }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, color: SUB, letterSpacing: '.02em', marginBottom: 12 }}>FOCUS &amp; DISTRACTION</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {([['time focused', formatDuration(focusSecs), c.deep], ['Claude waited', formatDuration(driftSecs), 'var(--danger)'], ['today', formatDuration(p.claudeActiveSecsToday), c.deep], ['waited today', formatDuration(p.driftSecsToday), 'var(--danger)']] as [string, string, string][]).map(([l, v, col]) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontWeight: 600, fontSize: 12.5, color: SUB, whiteSpace: 'nowrap' }}>{l}</span>
                    <span className="nn-num" style={{ fontWeight: 800, fontSize: 14, color: col, whiteSpace: 'nowrap', flexShrink: 0 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 18, border: elev.border, boxShadow: shadow.md }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, color: SUB, letterSpacing: '.02em', marginBottom: 12 }}>LAST 7 DAYS</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 7, height: 70 }}>
                {last7.map((d, i) => (
                  <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{ width: '100%', maxWidth: 22, height: `${Math.max(6, (d.waterMl / maxDay) * 100)}%`, borderRadius: 6, background: i === last7.length - 1 ? `linear-gradient(180deg,${c.mid},${c.deep})` : `linear-gradient(180deg,${c.light},${c.mid})` }} />
                    <span style={{ fontWeight: 700, fontSize: 9.5, color: i === last7.length - 1 ? c.deep : FAINT }}>{dayLabel(d.day)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
