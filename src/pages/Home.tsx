// Home: focus timer, the weekly rest bank and the week planner (where today's
// target is set).

import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { api } from '../lib/api'
import { hueSwatch } from '../lib/clay'
import { useFocusView, useRules, type FocusView } from '../lib/derive'
import { FINISH, WARMTH, projectBonus } from '../lib/economy'
import { DAYS, fmtCountdown, fmtHM } from '../lib/format'
import { say } from '../store/toast'
import { Sky, Nube } from '../components/NubeCreature'
import { Bar, Btn, Card, Dot, Eyebrow, Pill, Ring, Section, Tile } from '../components/ui'
import type { Settings } from '../types'

const report = (e: unknown) => say(String(e))
const startTimer = (min: number) => api.startTimer(min).catch(report)
const stopTimer = () =>
  api.stopTimer()
    .then((lost) => say(lost >= 30 ? `Timer stopped early. You lost the ${fmtHM(lost)} bonus.` : 'Timer stopped early'))
    .catch(report)
const setTarget = (secs: number) => api.setTarget(secs).catch(report)
const setDayTarget = (day: number, secs: number | null) => api.setDayTarget(day, secs).catch(report)
const setDayRest = (day: number, secs: number) => api.setDayRest(day, secs).catch(report)

const presetLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m}m`)

function heroCopy(f: FocusView, s: Settings): { title: string; line: string; tone: string; pulse: boolean } {
  if (f.away) return { title: 'Away', line: "Tracking pauses while you're away, so nothing is earned or spent.", tone: 'var(--faint)', pulse: false }
  switch (f.state) {
    case 'timer': return { title: `Focusing · ${f.app || 'NubeNube'}`, line: `Rest apps cost ${s.penalty}× until the timer ends.`, tone: hueSwatch(f.phase.hue, f.dark), pulse: true }
    case 'timerDrift': return { title: `Drifted to ${f.app}`, line: `You're burning rest ${s.penalty}× faster. Get back to it!`, tone: 'var(--critical)', pulse: true }
    case 'drift': return { title: `On ${f.app}`, line: 'No session running, so this comes out of your earned rest.', tone: f.hp < 0.15 ? 'var(--critical)' : 'var(--warning)', pulse: true }
    default: return f.today.hit
      ? { title: 'Target hit', line: 'Nice! Anything more is extra rest earned.', tone: 'var(--success)', pulse: false }
      : { title: 'Ready', line: "Start a focus session whenever you're ready.", tone: 'var(--faint)', pulse: false }
  }
}

function QuickPicks() {
  const s = useRules()
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {s.presets.map((m, i) => (
        <Btn key={i} variant={i === 1 ? 'primary' : 'line'} size="sm" onClick={() => void startTimer(m)} style={{ minWidth: 58 }}>{presetLabel(m)}</Btn>
      ))}
    </div>
  )
}

function FinishPips({ tier, active, every, dark }: { tier: number; active: boolean; every: number; dark: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {FINISH.map((m, i) => {
        const done = active && i <= tier, cur = active && i === tier, col = hueSwatch(WARMTH[i].hue, dark)
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: done ? col : 'transparent', border: `1.5px solid ${done ? col : 'var(--line-strong)'}`, animation: cur ? 'nn-pulse 1.8s var(--ease) infinite' : 'none' }} />
            <span className="nn-num" title={`from ${i * every} min`} style={{ fontSize: 10.5, color: done ? col : 'var(--faint)' }}>×{m}</span>
          </div>
        )
      })}
    </div>
  )
}

function Hero() {
  const f = useFocusView(), s = useRules()
  const cue = heroCopy(f, s)
  const big = f.inTimer ? fmtCountdown(f.left) : '−1×'
  const bigTone = f.state === 'timer' ? 'var(--ink)' : f.state === 'timerDrift' ? 'var(--critical)' : 'var(--warning)'
  const prog = f.inTimer ? 1 - f.left / Math.max(1, f.len) : 0
  const eyebrow = f.inTimer ? `Timer · ${Math.round(f.len / 60)} min` : f.state === 'drift' ? 'Spending rest' : 'Start focusing'
  const earning = f.state === 'timer' ? `Finish to earn +${fmtHM(f.len / s.ratio)} rest, +${fmtHM(f.projected)} bonus`
    : f.state === 'timerDrift' ? `Losing ${s.penalty} min of rest per minute` : null
  const preset = s.presets[1] ?? s.presets[0] ?? 45
  return (
    <Card pad={0} style={{ overflow: 'hidden', display: 'flex', flexWrap: 'wrap', minHeight: 320 }}>
      <div style={{ position: 'relative', flex: '1 1 240px', minHeight: 240, maxWidth: 380, borderRight: '1px solid var(--line-faint)' }}>
        <Sky sky={f.sky} style={{ position: 'absolute', inset: 0 }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 28 }}>
            <Nube mood={f.mood} size={164} glow={f.glow} />
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 16, display: 'flex', justifyContent: 'center' }}>
            <span className="nn-ui" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 10px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: f.phase.tone }} /><span>{f.phase.name}</span>
            </span>
          </div>
        </Sky>
      </div>
      <div style={{ flex: '2 1 320px', minWidth: 0, padding: '22px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Dot tone={cue.tone} pulse={cue.pulse} size={9} />
          <span className="nn-disp" style={{ fontSize: 20, color: 'var(--ink)', lineHeight: 1.2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cue.title}</span>
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5, marginTop: 8, textWrap: 'pretty' }}>{cue.line}</div>
        <div style={{ flex: 1, minHeight: 16 }} />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
          <Eyebrow style={{ fontSize: 10.5 }}>{eyebrow}</Eyebrow>
          <span style={{ flex: 1 }} />
          {f.inTimer && (
            <Pill tone="neutral" style={{ fontSize: 11, color: hueSwatch(WARMTH[f.tier].hue, f.dark) }}>
              {f.nextTierIn ? `×${f.finish} · ×${FINISH[f.tier + 1]} in ${fmtCountdown(Math.min(f.nextTierIn, f.left))}` : `×${f.finish} max bonus`}
            </Pill>
          )}
        </div>
        {f.inTimer || f.state === 'drift'
          ? <div className="nn-num" style={{ fontSize: 56, fontWeight: 700, color: bigTone, lineHeight: 1, letterSpacing: '-.03em' }}>{big}</div>
          : (
            <div style={{ padding: '6px 0 2px' }}>
              <QuickPicks />
              <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 10, lineHeight: 1.5 }}>
                {`Finish a ${preset}m session to earn ${fmtHM((preset * 60) / s.ratio)} of rest, plus a ${fmtHM(projectBonus(0, preset * 60, s.finishEvery, s.ratio))} bonus.`}
              </div>
            </div>
          )}
        {f.inTimer && <div style={{ marginTop: 14 }}><Bar pct={prog} height={8} color={f.state === 'timerDrift' ? 'var(--critical)' : hueSwatch(f.phase.hue, f.dark)} /></div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, flexWrap: 'wrap', minHeight: 30 }}>
          <FinishPips tier={f.tier} active={f.state === 'timer'} every={s.finishEvery} dark={f.dark} />
          {earning && <span className="nn-num" style={{ fontSize: 12, color: f.state === 'timerDrift' ? 'var(--critical)' : 'var(--success)' }}>{earning}</span>}
          <span style={{ flex: 1 }} />
          {f.inTimer && <Btn variant="line" size="sm" onClick={() => void stopTimer()}>Stop early</Btn>}
          {f.state === 'drift' && <QuickPicks />}
        </div>
      </div>
    </Card>
  )
}

function RestBank() {
  const f = useFocusView(), s = useRules()
  return (
    <Card pad={20}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <Eyebrow style={{ fontSize: 10.5 }}>Rest earned</Eyebrow>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>Resets Monday</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="nn-num" style={{ fontSize: 44, fontWeight: 700, color: f.hpTone, lineHeight: 0.9, transition: 'color .4s' }}>{f.bank <= 0 ? '0m' : fmtHM(f.bank)}</div>
          <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 8 }}>{f.bank <= 0 ? "You're out of rest. Work to earn more." : `earned in ${f.weekday + 1} day${f.weekday ? 's' : ''}`}</div>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ textAlign: 'right', paddingBottom: 2 }}>
          <div className="nn-num" style={{ fontSize: 15, color: 'var(--ink)' }}>{s.ratio} : 1</div>
          <div style={{ fontSize: 12, color: 'var(--faint)' }}>work : rest</div>
        </div>
      </div>
      <div style={{ marginTop: 14, height: 14, borderRadius: 999, background: 'var(--surface-strong)', overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, width: `${Math.max(0, Math.min(1, f.hp)) * 100}%`, background: f.hpTone, borderRadius: 999, transition: 'width .6s var(--ease), background .4s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
        <span className="nn-mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{!f.wanted ? 'no rest planned yet' : f.hp >= 1 ? 'covers all your planned rest' : `covers ${Math.round(Math.max(0, f.hp) * 100)}% of your planned rest`}</span>
        <span className="nn-mono" style={{ fontSize: 10, color: 'var(--faint)' }}>planned · {fmtHM(f.wanted)}</span>
      </div>
    </Card>
  )
}

// Week planner: work up (earns rest), rest down (spends it), running balance
// below. Bars for today and later days drag in 15-minute steps.
const PL_FMAX = 8 * 3600, PL_RMAX = 4 * 3600, PL_TOP = 128, PL_BOT = 76, PL_STEP = 900
const PL_FOCUS = 'var(--success)', PL_REST = 'var(--teal)'
const tint = (c: string, p: number) => `color-mix(in oklab, ${c} ${p}%, transparent)`
type Draft = { i: number; kind: 'focus' | 'rest'; v: number }

function WeekPlanner() {
  const f = useFocusView(), s = useRules()
  const [draft, setDraft] = useState<Draft | null>(null)
  // A raised target for today waiting on the "can't lower it" confirmation.
  const [pending, setPending] = useState<number | null>(null)
  const today = f.weekday
  const laterWeekdays = [0, 1, 2, 3, 4].filter((i) => i > today)
  const focusOf = (i: number) => (draft && draft.i === i && draft.kind === 'focus' ? draft.v
    : i === today && pending != null ? pending
    : i < today ? f.week[i].focus : f.week[i].target || 0)
  const restOf = (i: number) => (draft && draft.i === i && draft.kind === 'rest' ? draft.v : i < today ? f.week[i].spent : f.week[i].restPlan)
  const fmax = Math.max(PL_FMAX, Math.ceil(Math.max(...f.week.map((d, i) => Math.max(focusOf(i), i <= today ? d.focus : 0, i < today ? d.target || 0 : 0))) / 7200) * 7200)
  const rmax = Math.max(PL_RMAX, Math.ceil(Math.max(...f.week.map((_, i) => restOf(i))) / 3600) * 3600)
  const axis = (v: number) => `${+(v / 3600).toFixed(1)}h`
  const earnOf = (i: number) => (i < today ? f.week[i].earned : focusOf(i) / s.ratio + (focusOf(i) ? s.targetBonusMin * 60 : 0))
  const cum = f.week.map((_, i) => earnOf(i) - restOf(i)).reduce<number[]>((acc, v) => (acc.push((acc.length ? acc[acc.length - 1] : 0) + v), acc), [])
  const plannedFocus = f.week.reduce((a, d, i) => a + (i < today ? d.focus : Math.max(focusOf(i), i === today ? d.focus : 0)), 0)
  const end = cum[6], plannedRest = f.week.reduce((a, _, i) => a + restOf(i), 0)

  const commit = (i: number, kind: Draft['kind'], v: number) => {
    if (kind === 'rest') void setDayRest(i, v)
    else if (i > today) void setDayTarget(i, v || null)
    else if (v > (f.target || 0)) setPending(v)
  }
  const startDrag = (i: number, kind: Draft['kind'], e: ReactPointerEvent<HTMLDivElement>) => {
    if (i < today) return
    e.preventDefault()
    const el = e.currentTarget, r = el.getBoundingClientRect(), scale = kind === 'focus' ? fmax : rmax, cap = kind === 'focus' ? 16 * 3600 : 12 * 3600
    const floor = kind === 'focus' && i === today ? f.target || 0 : 0
    const val = (y: number) => {
      const p = kind === 'focus' ? (r.bottom - y) / r.height : (y - r.top) / r.height
      return Math.max(floor, Math.min(cap, Math.round((p * scale) / PL_STEP) * PL_STEP))
    }
    let v = val(e.clientY)
    setDraft({ i, kind, v })
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => { v = val(ev.clientY); setDraft({ i, kind, v }) }
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      setDraft(null)
      commit(i, kind, v)
    }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }
  // Spread the missing work over the weekdays after today; today's commitment is
  // only ever raised by the user, with confirmation.
  const balance = () => {
    const need = -end * s.ratio
    if (!laterWeekdays.length || need <= 0) return
    const per = Math.ceil(need / laterWeekdays.length / PL_STEP) * PL_STEP
    laterWeekdays.forEach((i) => void setDayTarget(i, Math.min(12 * 3600, (f.week[i].target || 0) + per)))
    say(`Added ${fmtHM(per)} of work to ${laterWeekdays.map((i) => DAYS[i]).join(', ')}`)
  }

  const maxAbs = Math.max(1800, ...cum.map(Math.abs)), SH = 46
  const yOf = (v: number) => SH / 2 - (v / maxAbs) * (SH / 2 - 5)
  const pts = cum.map((v, i) => `${((i + 0.5) / 7) * 100},${yOf(v)}`).join(' ')
  const area = `${(0.5 / 7) * 100},${SH / 2} ${pts} ${(6.5 / 7) * 100},${SH / 2}`
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 } as const

  return (
    <Card pad={20}>
      <Section sub="Commit to focusing more on weekdays to enjoy your weekends!">This week's commitments</Section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', padding: '12px 14px', borderRadius: 'var(--r-md)', background: end >= 0 ? 'var(--success-surface)' : 'var(--critical-surface)', border: `1px solid ${end >= 0 ? 'var(--success-border)' : 'var(--critical-border)'}`, marginBottom: 16 }}>
        <div><div className="nn-num" style={{ fontSize: 18, color: PL_FOCUS }}>{fmtHM(plannedFocus)}</div><div style={{ fontSize: 11.5, color: 'var(--faint)' }}>work planned</div></div>
        <div><div className="nn-num" style={{ fontSize: 18, color: PL_REST }}>{fmtHM(plannedRest)}</div><div style={{ fontSize: 11.5, color: 'var(--faint)' }}>rest planned</div></div>
        <span style={{ flex: 1 }} />
        <div style={{ textAlign: 'right' }}>
          <div className="nn-disp" style={{ fontSize: 14.5, color: end >= 0 ? 'var(--success)' : 'var(--critical)' }}>{end >= 0 ? `${fmtHM(end)} to spare` : `${fmtHM(-end)} of rest not earned yet`}</div>
          <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>{end >= 0 ? 'Your work covers the rest you planned' : `Add about ${fmtHM(-end * s.ratio)} of work to cover it`}</div>
        </div>
        {end < 0 && laterWeekdays.length > 0 && <Btn variant="primary" size="sm" onClick={balance}>Balance it</Btn>}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ width: 26, flexShrink: 0, position: 'relative' }}>
          {[1, 2, 3, 4].map((k) => <span key={k} className="nn-mono" style={{ position: 'absolute', right: 0, top: 16 + PL_TOP - (k / 4) * PL_TOP - 6, fontSize: 9.5, color: 'var(--faint)' }}>{axis((k * fmax) / 4)}</span>)}
          {[1, 2, 3].map((k) => <span key={k} className="nn-mono" style={{ position: 'absolute', right: 0, top: 16 + PL_TOP + 30 + (k / 4) * PL_BOT - 6, fontSize: 9.5, color: 'var(--faint)' }}>{axis((k * rmax) / 4)}</span>)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={grid}>
            {f.week.map((d, i) => {
              const past = i < today, isToday = i === today, editable = !past
              const fv = focusOf(i), rv = restOf(i), done = i <= today ? d.focus : 0, spent = isToday ? d.spent : 0
              const fh = (Math.min(fv, fmax) / fmax) * PL_TOP, dh = (Math.min(done, fmax) / fmax) * PL_TOP
              const rh = (Math.min(rv, rmax) / rmax) * PL_BOT, sh = (Math.min(spent, rmax) / rmax) * PL_BOT
              const tgtH = past && d.target ? (Math.min(d.target, fmax) / fmax) * PL_TOP : null
              const active = draft?.i === i
              return (
                <div key={i} style={{ minWidth: 0, borderRadius: 'var(--r-md)', background: isToday ? 'var(--surface-strong)' : 'transparent', padding: '0 3px' }}>
                  <div onPointerDown={(e) => startDrag(i, 'focus', e)} style={{ position: 'relative', height: PL_TOP, marginTop: 16, cursor: editable ? 'ns-resize' : 'default', touchAction: 'none', backgroundImage: `repeating-linear-gradient(to top, transparent 0, transparent ${PL_TOP / 4 - 1}px, var(--line-faint) ${PL_TOP / 4 - 1}px, var(--line-faint) ${PL_TOP / 4}px)` }}>
                    <span className="nn-num" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(fh, dh) + 3, textAlign: 'center', fontSize: 11, fontWeight: 600, color: active && draft?.kind === 'focus' ? 'var(--ink)' : fv ? 'var(--text)' : 'var(--faint)', whiteSpace: 'nowrap' }}>{fv ? fmtHM(fv) : editable ? '+' : '—'}</span>
                    {!past && fh > 0 && (
                      <div style={{ position: 'absolute', left: 3, right: 3, bottom: 0, height: fh, borderRadius: '4px 4px 0 0', background: tint(PL_FOCUS, 26), border: `1.5px solid ${PL_FOCUS}`, borderBottom: 'none', transition: active ? 'none' : 'height .2s var(--ease)' }}>
                        <span style={{ position: 'absolute', top: 3, left: '50%', width: 14, height: 3, marginLeft: -7, borderRadius: 2, background: PL_FOCUS, opacity: 0.8 }} />
                      </div>
                    )}
                    {dh > 0 && <div style={{ position: 'absolute', left: 3, right: 3, bottom: 0, height: dh, borderRadius: past || dh >= fh ? '4px 4px 0 0' : 0, background: past && !d.hit ? 'var(--accent)' : PL_FOCUS }} />}
                    {tgtH != null && <div style={{ position: 'absolute', left: 0, right: 0, bottom: tgtH, borderTop: '1.5px dashed var(--ink)', opacity: 0.45 }} />}
                  </div>
                  <div style={{ height: 30, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid var(--line-strong)', borderBottom: '1px solid var(--line-strong)' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: isToday ? 'var(--ink)' : past ? 'var(--faint)' : 'var(--text)' }}>{isToday ? 'Today' : DAYS[i]}</span>
                  </div>
                  <div onPointerDown={(e) => startDrag(i, 'rest', e)} style={{ position: 'relative', height: PL_BOT, cursor: editable ? 'ns-resize' : 'default', touchAction: 'none', backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${PL_BOT / 4 - 1}px, var(--line-faint) ${PL_BOT / 4 - 1}px, var(--line-faint) ${PL_BOT / 4}px)` }}>
                    {rh > 0 && (
                      <div style={{ position: 'absolute', left: 3, right: 3, top: 0, height: rh, borderRadius: '0 0 4px 4px', background: past ? tint('var(--warning)', 70) : tint(PL_REST, 26), border: past ? 'none' : `1.5px solid ${PL_REST}`, borderTop: 'none', transition: active ? 'none' : 'height .2s var(--ease)' }}>
                        {!past && <span style={{ position: 'absolute', bottom: 3, left: '50%', width: 14, height: 3, marginLeft: -7, borderRadius: 2, background: PL_REST, opacity: 0.8 }} />}
                      </div>
                    )}
                    {sh > 0 && <div style={{ position: 'absolute', left: 3, right: 3, top: 0, height: sh, background: tint('var(--warning)', 70), borderRadius: sh >= rh ? '0 0 4px 4px' : 0 }} />}
                    <span className="nn-num" style={{ position: 'absolute', left: 0, right: 0, top: Math.min(rh, PL_BOT - 14) + 3, textAlign: 'center', fontSize: 11, fontWeight: 600, color: rv ? (past ? 'var(--warning)' : 'var(--teal)') : 'var(--faint)', whiteSpace: 'nowrap' }}>{rv ? fmtHM(rv) : editable ? '+' : '—'}</span>
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ position: 'relative', height: SH, marginTop: 18 }}>
            <svg viewBox={`0 0 100 ${SH}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
              <defs>
                <clipPath id="pl-above"><rect x="0" y="0" width="100" height={SH / 2} /></clipPath>
                <clipPath id="pl-below"><rect x="0" y={SH / 2} width="100" height={SH / 2} /></clipPath>
              </defs>
              <line x1="0" x2="100" y1={SH / 2} y2={SH / 2} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <polygon points={area} fill={tint('var(--success)', 18)} clipPath="url(#pl-above)" />
              <polygon points={area} fill={tint('var(--critical)', 20)} clipPath="url(#pl-below)" />
              <polyline points={pts} fill="none" stroke="var(--success)" strokeWidth="2" vectorEffect="non-scaling-stroke" clipPath="url(#pl-above)" />
              <polyline points={pts} fill="none" stroke="var(--critical)" strokeWidth="2" vectorEffect="non-scaling-stroke" clipPath="url(#pl-below)" />
            </svg>
            {cum.map((v, i) => <span key={i} style={{ position: 'absolute', left: `calc(${((i + 0.5) / 7) * 100}% - 4px)`, top: yOf(v) - 4, width: 8, height: 8, borderRadius: '50%', background: v >= 0 ? 'var(--success)' : 'var(--critical)', border: '2px solid var(--surface)', boxSizing: 'content-box', marginLeft: -2, marginTop: -2 }} />)}
          </div>
          <div style={{ ...grid, marginTop: 6 }}>
            {cum.map((v, i) => <span key={i} className="nn-num" style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: v >= 0 ? 'var(--success)' : 'var(--critical)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{`${v >= 0 ? '+' : ''}${fmtHM(v)}`}</span>)}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--faint)', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-faint)' }}>
        {([[PL_FOCUS, 'Work', false], [PL_REST, 'Rest', false], ['var(--warning)', 'Rest used', false], ['var(--ink)', 'Past targets', true]] as const).map(([c, l, dash]) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: dash ? 0 : 10, borderRadius: 2, background: dash ? 'none' : c, borderTop: dash ? `1.5px dashed ${c}` : 'none', opacity: dash ? 0.5 : 1 }} />{l}
          </span>
        ))}
      </div>
      {pending != null && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(2px)' }}>
          <Card pad={24} style={{ width: 380, maxWidth: '90vw', boxShadow: 'var(--shadow-lg)', animation: 'nn-from-tr .18s var(--ease-soft)' }}>
            <div className="nn-disp" style={{ fontSize: 18, color: 'var(--ink)' }}>Commit to {fmtHM(pending)} today?</div>
            <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5, marginTop: 8, textWrap: 'pretty' }}>
              Are you sure? You can raise today's commitment later, but you can't lower it.
              {s.targetBonusMin > 0 && ` Hit it to earn +${fmtHM(s.targetBonusMin * 60)} of rest.`}
            </div>
            <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
              <Btn variant="primary" full onClick={() => { void setTarget(pending); setPending(null) }}>Commit</Btn>
              <Btn variant="soft" onClick={() => setPending(null)}>Cancel</Btn>
            </div>
          </Card>
        </div>
      )}
    </Card>
  )
}

function Tiles() {
  const f = useFocusView()
  const total = f.today.focus + f.today.distract || 1
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: 14 }}>
      <Tile label="Today's target" foot={f.target ? (f.today.hit ? 'Hit' : `${f.phase.name} · should be at ${fmtHM(f.phase.expected)}`) : 'Not set yet'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Ring pct={f.targetPct} size={58} thick={6} color={f.today.hit ? 'var(--success)' : 'var(--accent)'}>
            <span className="nn-num" style={{ fontSize: 12, color: 'var(--ink)' }}>{Math.round(Math.min(1, f.targetPct) * 100)}%</span>
          </Ring>
          <div>
            <div className="nn-num" style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>{fmtHM(f.today.focus)}</div>
            <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 4 }}>{f.target ? `of ${fmtHM(f.target)}` : 'worked'}</div>
          </div>
        </div>
      </Tile>
      <Tile label="Work ratio" foot={`${fmtHM(f.today.focus)} work | ${fmtHM(f.today.distract)} resting`}>
        <div className="nn-num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>{Math.round(f.ratioToday * 100)}%</div>
        <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', marginTop: 12, gap: 2 }}>
          <div style={{ width: `${(f.today.focus / total) * 100}%`, background: 'var(--success)' }} />
          <div style={{ width: `${(f.today.distract / total) * 100}%`, background: 'var(--critical)' }} />
        </div>
      </Tile>
    </div>
  )
}

export function Home() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1100 }}>
      <Hero />
      <RestBank />
      <WeekPlanner />
      <Tiles />
    </div>
  )
}
