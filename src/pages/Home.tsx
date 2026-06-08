// Home: live cockpit (creature + status + life + pause/insights actions), the
// "today" timers, and the first-run empty state. Reads the useNube view-model.

import { useNavigate } from 'react-router-dom'
import { useUsage } from '../store/usage'
import { api } from '../lib/api'
import { useNube, statusFor, cueFor, timerFor } from '../lib/derive'
import { Card, Pill, Btn, Dot, LifeBar, Eyebrow } from '../components/ui'
import { Sky, Nube } from '../components/NubeCreature'

function HeroCockpit() {
  const s = useNube()
  const navigate = useNavigate()
  const st = statusFor(s.effState, s.appName)
  const cue = cueFor(s)
  const over = s.life - s.baseline
  const lifeTone = s.life >= 100 ? 'var(--success)' : s.life < 30 ? 'var(--critical)' : 'var(--warning)'
  const deltaPill = over >= 0
    ? <Pill tone="mint" style={{ fontSize: 11.5 }}>+{Math.round(over)}% banked</Pill>
    : <Pill tone={s.life < 30 ? 'danger' : 'amber'} style={{ fontSize: 11.5 }}>{Math.round(over)}% below start</Pill>

  return (
    <Card pad={0} style={{ overflow: 'hidden', display: 'flex', minHeight: 312 }}>
      {/* left — creature panel */}
      <div style={{ position: 'relative', width: '40%', minWidth: 260, flexShrink: 0, borderRight: '1px solid var(--line-faint)' }}>
        <Sky sky={s.sky} style={{ position: 'absolute', inset: 0 }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Nube mood={s.mood} size={172} glow={s.glow} />
          </div>
        </Sky>
      </div>

      {/* right — facts + action */}
      <div style={{ flex: 1, minWidth: 0, padding: '22px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Dot tone={st.tone} pulse={st.pulse} size={9} />
          <span className="nn-disp" style={{ fontSize: 21, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cue.title}</span>
          <span style={{ flex: 1 }} />
          {timerFor(s) && <span className="nn-mono" style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>{timerFor(s)}</span>}
        </div>

        <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5, marginTop: 8, textWrap: 'pretty' }}>{cue.line}</div>

        <div style={{ flex: 1, minHeight: 14 }} />

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, marginBottom: 8 }}>
          <Eyebrow style={{ fontSize: 10.5 }}>Daily budget</Eyebrow>
          <span style={{ flex: 1 }} />
          {deltaPill}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
          <span className="nn-num" style={{ fontSize: 40, fontWeight: 700, color: lifeTone, lineHeight: .9 }}>{Math.round(s.life)}</span>
          <span className="nn-num" style={{ fontSize: 18, fontWeight: 600, color: 'var(--faint)' }}>%</span>
          <span style={{ flex: 1 }} />
          {s.budgetTotal > 0 && (
            <span className="nn-num" style={{ fontSize: 14, fontWeight: 600, color: s.fainting ? 'var(--critical)' : 'var(--faint)' }}>
              {s.fainting ? 'budget spent' : `${s.fmtClock(s.budgetLeft)} left`}
            </span>
          )}
        </div>
        <div style={{ marginTop: 12 }}><LifeBar life={s.life} baseline={s.baseline} cap={s.cap} height={10} /></div>

        <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
          <Btn variant="soft" full onClick={() => navigate('/insights')}>View insights</Btn>
        </div>
      </div>
    </Card>
  )
}

function TimerTile({ label, value, tone, badge, fmt }: { label: string; value: number; tone: string; badge?: string | null; fmt: (s: number) => string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: '13px 14px', borderRadius: 'var(--r-md)', background: 'var(--surface-faint)', border: '1px solid var(--line-faint)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Dot tone={tone} size={6} />
        <span style={{ fontSize: 11.5, color: 'var(--faint)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        {badge && <span className="nn-num" style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: tone, padding: '1px 5px', borderRadius: 999, background: 'var(--surface-strong)' }}>{badge}</span>}
      </div>
      <div className="nn-num" style={{ fontSize: 21, fontWeight: 700, color: 'var(--ink)', marginTop: 8, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}</div>
    </div>
  )
}

function TodayStrip() {
  const s = useNube()
  return (
    <Card pad={20}>
      <Eyebrow style={{ fontSize: 10.5 }}>Today</Eyebrow>
      <div style={{ display: 'flex', gap: 10, marginTop: 13 }}>
        <TimerTile label="Claude working" value={s.work} tone="var(--success)" badge={s.run > 1 ? `×${s.run}` : null} fmt={s.fmtCountdown} />
        <TimerTile label="Distracted" value={s.distracted} tone="var(--warning)" fmt={s.fmtCountdown} />
        <TimerTile label="Work apps" value={s.workApp} tone="var(--work)" fmt={s.fmtCountdown} />
      </div>
    </Card>
  )
}

// first-run state shown until a project or connection exists
function HomeEmpty() {
  const s = useNube()
  const loadAll = useUsage((st) => st.loadAll)
  const connect = () => { void api.installHooks().then(() => loadAll()) }
  return (
    <Card pad={0} style={{ overflow: 'hidden' }}>
      <div style={{ position: 'relative', height: 200, borderBottom: '1px solid var(--line-faint)' }}>
        <Sky sky={s.sky} style={{ position: 'absolute', inset: 0 }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Nube mood="content" size={150} />
          </div>
        </Sky>
      </div>
      <div style={{ padding: '24px 26px', textAlign: 'center' }}>
        <div className="nn-disp" style={{ fontSize: 20, color: 'var(--ink)', marginBottom: 8 }}>Hi, I'm Nube</div>
        <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.55, maxWidth: '44ch', margin: '0 auto 20px' }}>
          Connect Claude Code and I'll grow while it works for you — and nudge you the moment it's your turn.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Btn variant="primary" onClick={connect}>Connect Claude Code</Btn>
        </div>
      </div>
    </Card>
  )
}

export function Home() {
  const projects = useUsage((s) => s.projects)
  const connection = useUsage((s) => s.connection)
  const loaded = useUsage((s) => s.loaded)
  const empty = loaded && projects.length === 0 && !connection?.connected
  if (empty) return <HomeEmpty />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <HeroCockpit />
      <TodayStrip />
    </div>
  )
}
