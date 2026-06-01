// Settings — teach Nube what pulls you away and how hard it fights to bring you
// back. Real Rust-backed Settings (distraction apps, grace, decay, reset, pause,
// Claude Code connection) + UI-only prefs (rescue levels, reminder, sound).

import { useEffect, useState } from 'react'
import type { KnownApp } from '../types'
import { useSettings } from '../store/settings'
import { useUsage } from '../store/usage'
import { usePrefs } from '../store/prefs'
import { api } from '../lib/api'
import { Card, Pill, Btn, Toggle, DragBar, Dot, INK, SUB, FAINT } from '../components/ui'
import { BASE_LIFE, PAUSE_SENTINEL } from '../lib/derive'

const ACCENT = 28 // warm amber for "drains"

function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

function AppRow({ name, on, onToggle }: { name: string; on: boolean; onToggle: () => void }) {
  const hue = hashHue(name)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px' }}>
      <div className="nn-disp" style={{ width: 38, height: 38, borderRadius: 11, background: `hsl(${hue} 64% 62%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 6px 14px -6px hsl(${hue} 64% 62%)`, color: '#fff', fontWeight: 800, fontSize: 18 }}>{name[0]?.toUpperCase()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="nn-disp" style={{ fontWeight: 700, fontSize: 14.5, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div style={{ fontWeight: 600, fontSize: 11.5, color: FAINT }}>{on ? 'drains Nube when Claude waits' : 'ignored'}</div>
      </div>
      <span style={{ fontWeight: 700, fontSize: 11.5, color: on ? 'var(--danger)' : FAINT, marginRight: 2 }}>{on ? 'drains' : 'ignored'}</span>
      <Toggle on={on} hue={on ? ACCENT : 270} onClick={onToggle} />
    </div>
  )
}

export function Settings() {
  const settings = useSettings((s) => s.settings)
  const load = useSettings((s) => s.load)
  const save = useSettings((s) => s.save)
  const connection = useUsage((s) => s.connection)
  const loadAll = useUsage((s) => s.loadAll)
  const rescan = useUsage((s) => s.rescan)
  const prefs = usePrefs()
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [known, setKnown] = useState<KnownApp[]>([])
  const [running, setRunning] = useState<string[]>([])
  const refreshApps = async () => {
    const [k, r] = await Promise.all([api.getKnownApps(), api.listRunningApps()])
    setKnown(k.data)
    setRunning(r.data)
  }
  useEffect(() => { void refreshApps() }, [])

  useEffect(() => { void load() }, [load])

  if (!settings) {
    return <div className="nn-ui" style={{ height: '100%', display: 'grid', placeItems: 'center', color: FAINT, fontWeight: 600 }}>loading settings…</div>
  }

  const distraction = settings.distractionApps
  const distractSet = new Set(distraction.map((d) => d.toLowerCase()))
  const nameMap = new Map<string, string>() // lowercase key → display name
  for (const d of distraction) nameMap.set(d.toLowerCase(), d)
  for (const k of known) nameMap.set(k.name.toLowerCase(), k.name) // known wins for display
  for (const r of running) if (!nameMap.has(r.toLowerCase())) nameMap.set(r.toLowerCase(), r)
  const names = [...nameMap.values()].sort((a, b) => a.localeCompare(b))
  const apps = names.map((name) => ({ name, on: distractSet.has(name.toLowerCase()) }))

  const toggleApp = (name: string, on: boolean) => {
    if (on) {
      save({ distractionApps: distraction.filter((n) => n.toLowerCase() !== name.toLowerCase()) })
    } else {
      save({ distractionApps: [...distraction, name] })
    }
  }
  const addApp = () => {
    const n = adding.trim()
    if (!n || distractSet.has(n.toLowerCase())) return setAdding('')
    save({ distractionApps: [...distraction, n] })
    setAdding('')
  }

  // numeric tuning ↔ real sensitivity. Death = draining the full base life to 0,
  // so "minutes to die" = baseFrac / decayPerMin.
  const baseFrac = BASE_LIFE / 100
  const dieMin = Math.max(1, Math.min(15, Math.round(baseFrac / Math.max(0.001, settings.sensitivity.decayPerMin))))
  const setDieMin = (m: number) => save({ sensitivity: { ...settings.sensitivity, decayPerMin: baseFrac / m } })
  const setGrace = (s: number) => save({ sensitivity: { ...settings.sensitivity, graceSecs: s } })

  // flipping an individual rescue level also keeps the Rust intensity in sync
  const toggleRescue = (key: 'takeoverFinish' | 'takeover2' | 'takeover5') => {
    const next = { takeoverFinish: prefs.takeoverFinish, takeover2: prefs.takeover2, takeover5: prefs.takeover5, [key]: !prefs[key] }
    prefs.set(key, !prefs[key])
    save({ driftMomentIntensity: next.takeoverFinish || next.takeover2 || next.takeover5 ? 'overlay' : 'gentle-notification' })
  }

  const connect = async (install: boolean) => {
    setBusy(true)
    await (install ? api.installHooks() : api.uninstallHooks())
    await loadAll()
    setBusy(false)
  }

  const hooked = connection?.hooksInstalled
  const paused = !!settings.pauseUntil && new Date(settings.pauseUntil).getTime() > Date.now()
  const togglePause = () => save({ pauseUntil: paused ? null : PAUSE_SENTINEL })

  const sectionTitle = (t: string) => <div className="nn-disp" style={{ fontWeight: 800, fontSize: 16, color: INK }}>{t}</div>

  return (
    <div className="nn-ui" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 22, overflow: 'hidden' }}>
      <div className="nn-disp" style={{ fontWeight: 800, fontSize: 22, color: INK, lineHeight: 1, marginBottom: 4 }}>settings</div>
      <div style={{ fontWeight: 600, fontSize: 13, color: SUB, marginBottom: 14 }}>teach Nube what pulls you away — and how hard it should fight to bring you back</div>

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 6, display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 14, alignItems: 'start' }}>
        {/* left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* distraction apps */}
          <Card pad={18}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              {sectionTitle('what counts as distraction')}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Pill hue={ACCENT} tone="soft" style={{ fontSize: 11 }}>{distraction.length} drain</Pill>
                <Btn hue={268} kind="soft" size="sm" onClick={() => void refreshApps()}>↻ scan apps</Btn>
              </div>
            </div>
            <div style={{ fontWeight: 600, fontSize: 12, color: SUB, marginBottom: 4 }}>tag the apps that pull you away. while Claude waits, only these drain Nube — research &amp; editors never do.</div>
            <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 320, overflowY: 'auto' }}>
              {apps.map((a, i) => (
                <div key={a.name} style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(120,100,170,.1)' }}>
                  <AppRow name={a.name} on={a.on} onToggle={() => toggleApp(a.name, a.on)} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addApp()} placeholder="add an app or website…" style={{ flex: 1, border: '2px dashed rgba(150,120,200,.35)', background: 'transparent', borderRadius: 12, padding: '10px 12px', fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 13, color: INK, outline: 'none' }} />
              <Btn hue={ACCENT} kind="soft" size="sm" onClick={addApp}>add</Btn>
            </div>
          </Card>

          {/* connect Claude Code */}
          <Card pad={18}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              {sectionTitle('Claude Code connection')}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 11.5, color: connection?.connected ? '#2f8a76' : FAINT }}>
                <Dot color={connection?.connected ? '#54c489' : '#bbb'} size={7} /> {connection?.connected ? 'reading your logs' : 'not connected'}
              </span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 12, color: SUB, marginBottom: 10 }}>
              {connection?.projectsDetected ?? 0} projects · {(connection?.sessionsScanned ?? 0).toLocaleString()} sessions scanned
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn hue={268} kind={hooked ? 'line' : 'primary'} size="sm" onClick={() => connect(!hooked)} disabled={busy}>
                {hooked ? 'remove drift hook' : 'install drift hook'}
              </Btn>
              <Btn hue={268} kind="soft" size="sm" onClick={() => void rescan()} disabled={busy}>rescan logs</Btn>
            </div>
            <div style={{ fontWeight: 600, fontSize: 11, color: FAINT, marginTop: 9 }}>
              the hook lets Nube know the moment Claude finishes a turn — so it only counts drift while Claude is actually waiting for you.
            </div>
          </Card>
        </div>

        {/* right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card pad={18}>
            {sectionTitle('how Nube reacts')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 17, margin: '14px 0 18px' }}>
              <DragBar label="Nube dies after" value={dieMin} min={1} max={15} step={1} hue={ACCENT} format={(v) => `${v} min · per waiting session`} onChange={setDieMin} />
              <DragBar label="grace before draining" value={settings.sensitivity.graceSecs} min={0} max={120} step={5} hue={ACCENT} format={(v) => `${v}s`} onChange={setGrace} />
            </div>
          </Card>

          <Card pad={18}>
            <div className="nn-disp" style={{ fontWeight: 800, fontSize: 16, color: INK, marginBottom: 4 }}>full-screen rescues</div>
            <div style={{ fontWeight: 600, fontSize: 11.5, color: FAINT, marginBottom: 8 }}>when to take over your screen to drag you back</div>
            {([['the moment Claude finishes', 'takeoverFinish'], ['at the 2-minute mark', 'takeover2'], ['at the 5-minute mark', 'takeover5']] as const).map(([label, key], i) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: i === 0 ? 'none' : '1px solid rgba(120,100,170,.1)' }}>
                <span style={{ fontWeight: 600, fontSize: 13.5, color: INK }}>{label}</span>
                <Toggle on={prefs[key]} hue={ACCENT} onClick={() => toggleRescue(key)} />
              </div>
            ))}
          </Card>

          <Card pad={18}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
              <div>
                <div className="nn-disp" style={{ fontWeight: 800, fontSize: 15, color: INK }}>sound</div>
                <div style={{ fontWeight: 600, fontSize: 11.5, color: FAINT }}>chimes for danger &amp; relief</div>
              </div>
              <Toggle on={prefs.sound} onClick={() => prefs.set('sound', !prefs.sound)} hue={270} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(120,100,170,.1)' }}>
              <div>
                <div className="nn-disp" style={{ fontWeight: 800, fontSize: 15, color: INK }}>desktop companion</div>
                <div style={{ fontWeight: 600, fontSize: 11.5, color: FAINT }}>a floating Nube that watches over you on the desktop</div>
              </div>
              <Toggle on={prefs.companion} onClick={() => prefs.set('companion', !prefs.companion)} hue={270} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(120,100,170,.1)' }}>
              <div>
                <div className="nn-disp" style={{ fontWeight: 800, fontSize: 15, color: INK }}>daily reset</div>
                <div style={{ fontWeight: 600, fontSize: 11.5, color: FAINT }}>life refreshes to {BASE_LIFE}% each morning</div>
              </div>
              <input type="time" value={settings.resetTimeLocal} onChange={(e) => save({ resetTimeLocal: e.target.value })} style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, color: INK, border: '1px solid rgba(120,100,170,.2)', borderRadius: 10, padding: '6px 10px', background: '#fff' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(120,100,170,.1)' }}>
              <div>
                <div className="nn-disp" style={{ fontWeight: 800, fontSize: 15, color: INK }}>break / pause</div>
                <div style={{ fontWeight: 600, fontSize: 11.5, color: FAINT }}>{paused ? 'paused — Nube is resting' : 'lunch & meetings won’t drain Nube'}</div>
              </div>
              <Btn hue={paused ? 158 : 268} kind={paused ? 'primary' : 'soft'} size="sm" onClick={togglePause}>{paused ? 'resume' : 'pause'}</Btn>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
