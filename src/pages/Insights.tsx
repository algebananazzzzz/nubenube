// Insights — the celebratory, honest aggregate. Total water evaporated, the
// global token composition collated across ALL projects, focus vs drift, and
// where the water went. All real, from get_totals + get_insights(range).

import { useNavigate } from 'react-router-dom'
import { useUsage } from '../store/usage'
import { Donut, INK, SUB, FAINT, shadow, elev, fmt } from '../components/ui'
import { hueClay } from '../lib/clay'
import { tokenSegs, sumTokenM } from '../lib/derive'
import { formatCount, formatDuration, shortPath } from '../lib/format'
import { formatWater, funWater } from '../theme/units'
import type { Project, RangeKey } from '../types'

const litres = (ml: number) => ml / 1000
const tokenTotal = (p: Project) => p.tokens.input + p.tokens.output + p.tokens.cacheCreate + p.tokens.cacheRead
const RANGES: { k: RangeKey; label: string }[] = [
  { k: 'today', label: 'today' },
  { k: 'week', label: 'week' },
  { k: 'month', label: 'month' },
  { k: 'all', label: 'all-time' },
]

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div style={{ flex: 1, padding: '15px 16px', background: 'var(--surface)', borderRadius: 14, border: elev.border, boxShadow: shadow.sm }}>
      <div style={{ fontWeight: 700, fontSize: 10.5, color: FAINT, letterSpacing: '.05em', textTransform: 'uppercase' }}>{label}</div>
      <div className="nn-num" style={{ fontWeight: 800, fontSize: 25, color: color || INK, marginTop: 5 }}>{value}</div>
      <div style={{ fontWeight: 600, fontSize: 11, color: FAINT, marginTop: 3 }}>{sub}</div>
    </div>
  )
}

export function Insights() {
  const totals = useUsage((s) => s.totals)
  const insights = useUsage((s) => s.insights)
  const projects = useUsage((s) => s.projects)
  const range = useUsage((s) => s.range)
  const setRange = useUsage((s) => s.setRange)
  const navigate = useNavigate()

  const ic = hueClay(268)
  const allTime = totals?.waterMl ?? projects.reduce((s, p) => s + p.waterMl, 0)
  const fun = funWater(allTime)

  const segs = insights ? tokenSegs(insights.tokens, 268) : []
  const aggTok = insights ? sumTokenM(insights.tokens) : 0

  const focusSecs = insights?.claudeActiveSecs ?? 0
  const driftSecs = insights?.driftSecs ?? 0
  const breakdown = insights?.distractionBreakdown ?? []
  const streak = insights?.longestFocusStreakSecs ?? 0
  const msgs = projects.reduce((s, p) => s + p.msgCount, 0)

  const sorted = [...projects].sort((a, b) => b.waterMl - a.waterMl)

  return (
    <div className="nn-ui" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '20px 22px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="nn-disp" style={{ fontWeight: 800, fontSize: 23, color: INK, lineHeight: 1, letterSpacing: '-.01em' }}>insights</div>
        <div style={{ display: 'flex', gap: 4, background: 'rgba(120,100,170,.08)', borderRadius: 99, padding: 3 }}>
          {RANGES.map((r) => (
            <button
              key={r.k}
              onClick={() => setRange(r.k)}
              style={{ border: 'none', cursor: 'pointer', borderRadius: 99, padding: '6px 13px', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, background: range === r.k ? '#fff' : 'transparent', color: range === r.k ? INK : SUB, boxShadow: range === r.k ? shadow.sm : 'none' }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 6, display: 'flex', flexDirection: 'column', gap: 13 }}>
        {/* hero */}
        <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 18, padding: '22px 24px', color: '#fff', display: 'flex', flexDirection: 'column', gap: 11, flexShrink: 0, background: 'linear-gradient(135deg, hsl(268 64% 72%), hsl(246 62% 66%) 50%, hsl(210 66% 64%))', boxShadow: '0 20px 42px -22px rgba(110,90,210,.7)' }}>
          <div style={{ position: 'absolute', top: -30, right: 2, fontSize: 130, opacity: 0.13 }}>💧</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 12, opacity: 0.9, letterSpacing: '.05em', textTransform: 'uppercase' }}>total water evaporated · all-time</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <span className="nn-num" style={{ fontWeight: 800, fontSize: 50, lineHeight: 1 }}>{fmt(litres(allTime), allTime < 10_000 ? 1 : 0)}</span>
              <span className="nn-disp" style={{ fontWeight: 700, fontSize: 19 }}>litres</span>
            </div>
          </div>
          <div style={{ display: 'inline-flex', alignSelf: 'flex-start', gap: 8, background: 'rgba(255,255,255,.18)', borderRadius: 99, padding: '6px 14px', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>
            ≈ {fun.count} {fun.unit} · {formatWater(allTime)} exactly
          </div>
        </div>

        {/* honest stat cards (range-scoped) */}
        <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
          <StatCard label="time Claude worked" value={formatDuration(focusSecs)} sub={`tokens flowing · this ${range}`} color="#2f8a76" />
          <StatCard label="time drifted" value={formatDuration(driftSecs)} sub="distraction while Claude waited" color="var(--danger)" />
          <StatCard label="longest focus" value={formatDuration(streak)} sub="best unbroken stretch" color="#6a4aa8" />
        </div>

        {/* time lost to distractions (per app, range-scoped) */}
        <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 18, border: elev.border, boxShadow: shadow.md, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: SUB, letterSpacing: '.02em' }}>TIME LOST TO DISTRACTIONS · this {range}</div>
            <span className="nn-num" style={{ fontWeight: 800, fontSize: 14, color: 'var(--danger)' }}>{formatDuration(driftSecs)}</span>
          </div>
          <div style={{ fontWeight: 600, fontSize: 11.5, color: FAINT, marginBottom: 10 }}>only counts time on apps you tagged as distractions while Claude was waiting</div>
          {breakdown.length === 0 ? (
            <div style={{ fontWeight: 600, fontSize: 12.5, color: FAINT, padding: '6px 0' }}>no drift yet — nice 💚</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {breakdown.map((b, i) => {
                const max = breakdown[0]?.secs || 1
                return (
                  <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 2px', borderTop: i === 0 ? 'none' : '1px solid rgba(120,100,170,.1)' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: INK, width: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 99, background: 'rgba(120,100,170,.12)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.max(4, (b.secs / max) * 100)}%`, background: 'linear-gradient(90deg, hsl(28 80% 62%), hsl(8 78% 60%))' }} />
                    </div>
                    <span className="nn-num" style={{ fontWeight: 800, fontSize: 12.5, color: 'var(--danger)', width: 64, textAlign: 'right' }}>{formatDuration(b.secs)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* token composition + focus · all projects */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 13, flexShrink: 0 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 18, border: elev.border, boxShadow: shadow.md }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: SUB, letterSpacing: '.02em' }}>TOKEN COMPOSITION · all projects · this {range}</div>
            <div style={{ fontWeight: 600, fontSize: 11.5, color: FAINT, marginTop: 3, marginBottom: 12 }}>where every token went — cache reads dominate as Claude re-reads your code</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              <Donut
                segs={segs}
                size={132}
                thickness={20}
                center={
                  <div style={{ textAlign: 'center' }}>
                    <div className="nn-num" style={{ fontWeight: 800, fontSize: 22, color: INK, lineHeight: 1 }}>{formatCount(aggTok * 1e6)}</div>
                    <div style={{ fontWeight: 700, fontSize: 10, color: FAINT, letterSpacing: '.04em' }}>tokens</div>
                  </div>
                }
              />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {segs.map((s) => {
                  const pct = aggTok > 0 ? Math.round((s.value / aggTok) * 100) : 0
                  return (
                    <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 11, height: 11, borderRadius: 4, background: s.color, flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, fontSize: 12.5, color: INK, flex: 1 }}>{s.label}</span>
                      <span className="nn-num" style={{ fontWeight: 800, fontSize: 12.5, color: INK }}>{formatCount(s.value * 1e6)}</span>
                      <span style={{ fontWeight: 700, fontSize: 11.5, color: FAINT, width: 34, textAlign: 'right' }}>{pct}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 18, border: elev.border, boxShadow: shadow.md, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: SUB, letterSpacing: '.02em', marginBottom: 13 }}>FOCUS · this {range}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {([['time focused', formatDuration(focusSecs), ic.deep], ['Claude waited', formatDuration(driftSecs), 'var(--danger)'], ['water this range', formatWater(insights?.waterMl ?? 0), INK], ['messages all-time', msgs.toLocaleString(), INK]] as [string, string, string][]).map(([l, v, col]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 12.5, color: SUB, whiteSpace: 'nowrap' }}>{l}</span>
                  <span className="nn-num" style={{ fontWeight: 800, fontSize: 14, color: col, whiteSpace: 'nowrap', flexShrink: 0 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* projects — where the water went (tap for detail) */}
        <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 18, border: elev.border, boxShadow: shadow.md, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: SUB, letterSpacing: '.02em' }}>PROJECTS · where the water went</div>
            <span style={{ fontWeight: 600, fontSize: 11.5, color: FAINT }}>{sorted.length} projects · tap for detail</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sorted.map((p, i) => {
              const c = hueClay(p.colorHue)
              const go = () => navigate(`/project/${encodeURIComponent(p.id)}`)
              return (
                <div
                  key={p.id}
                  onClick={go}
                  role="button"
                  tabIndex={0}
                  aria-label={`open ${p.name}`}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 6px', cursor: 'pointer', borderTop: i === 0 ? 'none' : '1px solid rgba(120,100,170,.1)' }}
                >
                  <span style={{ width: 14, height: 14, borderRadius: 99, background: `radial-gradient(circle at 35% 30%, ${c.light}, ${c.deep})`, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    <div style={{ fontWeight: 600, fontSize: 11, color: FAINT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortPath(p.rootPath)}</div>
                  </div>
                  <span className="nn-num" style={{ fontWeight: 800, fontSize: 13, color: c.ink, whiteSpace: 'nowrap' }}>{fmt(litres(p.waterMl), 0)} L</span>
                  <span style={{ fontWeight: 600, fontSize: 11.5, color: FAINT, whiteSpace: 'nowrap' }}>/ {formatCount(tokenTotal(p))}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); go() }}
                    aria-label={`info about ${p.name}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: elev.border, background: '#fff', cursor: 'pointer', borderRadius: 99, padding: '6px 11px', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 11.5, color: c.deep, boxShadow: shadow.sm, flexShrink: 0 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.deep} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5h.01" /></svg>
                    info
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
