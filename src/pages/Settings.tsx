// Settings: Rust-backed config (distraction apps, sensitivity sliders, reset,
// Claude Code connection) + localStorage prefs (theme, sound, companion).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '../store/settings'
import { useUsage } from '../store/usage'
import { usePrefs, type Theme, type UpdateChannel } from '../store/prefs'
import { api } from '../lib/api'
import { checkForUpdates } from '../lib/updater'
import { armChimeUnlock, playChime, CHIME_VOICES, type ChimeVoice } from '../lib/chime'
import { Card, Pill, Btn, Dot, Toggle, SegTabs } from '../components/ui'
import { version } from '../../package.json'
import type { Settings as SettingsT, Sensitivity, DayOverride } from '../types'

const VOICE_LABEL: Record<ChimeVoice, string> = {
  bell: 'Bell', marimba: 'Marimba', chord: 'Chord', koto: 'Koto', blip: 'Blip',
}

const BRAND: Record<string, string> = {
  'chatgpt atlas': '#10a37f', telegram: '#2aabee', claude: '#d97757', electron: '#8a6dff',
  finder: '#3dc7a0', ghostty: '#e0584f', 'google chrome': '#46a35e', slack: '#7a3b86',
}
function colorFor(name: string): string {
  const k = name.toLowerCase()
  if (BRAND[k]) return BRAND[k]
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h} 55% 52%)`
}

function AppAvatar({ name, color }: { name: string; color: string }) {
  return (
    <div style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: color, color: '#fff', fontWeight: 700, fontSize: 15 }}>
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  )
}

function AppRow({ name, on, onToggle, last }: { name: string; on: boolean; onToggle: () => void; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 2px', borderBottom: last ? 'none' : '1px solid var(--line-faint)' }}>
      <AppAvatar name={name} color={colorFor(name)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{name}</div>
        <div style={{ fontSize: 12, color: on ? 'var(--critical)' : 'var(--faint)', fontWeight: 500, marginTop: 1 }}>
          {on ? 'Drains health while Claude is waiting' : 'Ignored'}
        </div>
      </div>
      <Toggle on={on} onChange={onToggle} />
    </div>
  )
}

function SliderRow({ title, value, fmt, min, max, step, onChange, accent, last }: {
  title: string; value: number; fmt: (v: number) => string; min: number; max: number; step: number
  onChange: (v: number) => void; accent: string; last?: boolean
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div style={{ padding: '14px 0', borderBottom: last ? 'none' : '1px solid var(--line-faint)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', flexShrink: 0 }}>{title}</div>
        <div className="nn-num" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--faint)', textAlign: 'right' }}>{fmt(value)}</div>
      </div>
      <div style={{ position: 'relative', height: 16 }}>
        <div style={{ position: 'absolute', top: 6, left: 0, right: 0, height: 4, borderRadius: 999, background: 'var(--surface-strong)' }} />
        <div style={{ position: 'absolute', top: 6, left: 0, width: `${pct}%`, height: 4, borderRadius: 999, background: accent }} />
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)}
          className="nn-bare-range"
          style={{ position: 'absolute', inset: '-3px 0', width: '100%', height: 22, margin: 0, cursor: 'pointer' }} />
        <div style={{ position: 'absolute', top: '50%', left: `${pct}%`, width: 16, height: 16, marginLeft: -8, transform: 'translateY(-50%)', borderRadius: '50%', background: '#fff', border: `2px solid ${accent}`, boxShadow: 'var(--shadow-sm)', pointerEvents: 'none' }} />
      </div>
    </div>
  )
}

function PrefRow({ title, desc, children, last }: { title: string; desc?: ReactNode; children: ReactNode; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 0', borderBottom: last ? 'none' : '1px solid var(--line-faint)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
        {desc && <div style={{ fontSize: 12.5, color: 'var(--faint)', marginTop: 2, lineHeight: 1.45 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div className="nn-disp" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{children}</div>
      {right}
    </div>
  )
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const WEEKDAYS = [0, 1, 2, 3, 4]
const WEEKEND = [5, 6]
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

// "How Nube reacts": the two rate knobs are per-weekday — pick a day and edit, or
// apply the day's values to a whole group. Grace stays a single global knob.
function HowNubeReacts({ sens, save }: { sens: Sensitivity; save: (patch: Partial<SettingsT>) => Promise<void> }) {
  const [day, setDay] = useState(() => (new Date().getDay() + 6) % 7) // 0=Mon … 6=Sun
  const overrides = sens.dayOverrides ?? []
  const ovr = (wd: number) => overrides.find((o) => o.weekday === wd)
  const ttdFor = (wd: number) => ovr(wd)?.timeToDeathMin ?? sens.timeToDeathMin
  const ratioFor = (wd: number) => ovr(wd)?.healDrainRatio ?? sens.healDrainRatio
  const differs = (wd: number) =>
    Math.round(ttdFor(wd)) !== Math.round(sens.timeToDeathMin) ||
    Math.round(ratioFor(wd) * 100) !== Math.round(sens.healDrainRatio * 100)

  const writeOverrides = (next: DayOverride[]) =>
    void save({ sensitivity: { ...sens, dayOverrides: next.sort((a, b) => a.weekday - b.weekday) } })
  const upsertDay = (wd: number, patch: Partial<DayOverride>) =>
    writeOverrides([
      ...overrides.filter((o) => o.weekday !== wd),
      { weekday: wd, timeToDeathMin: ttdFor(wd), healDrainRatio: ratioFor(wd), ...patch },
    ])
  const applyToDays = (wds: number[]) => {
    const ttd = ttdFor(day)
    const ratio = ratioFor(day)
    writeOverrides([
      ...overrides.filter((o) => !wds.includes(o.weekday)),
      ...wds.map((wd) => ({ weekday: wd, timeToDeathMin: ttd, healDrainRatio: ratio })),
    ])
  }

  const chip = (wd: number) => {
    const on = wd === day
    const weekend = wd >= 5
    return (
      <button
        key={wd}
        onClick={() => setDay(wd)}
        className="nn-ui"
        style={{
          position: 'relative', padding: '6px 11px', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          border: `1px solid ${on ? 'var(--accent-border)' : 'var(--line)'}`,
          background: on ? 'var(--accent-surface)' : 'var(--surface-faint)',
          color: on ? 'var(--accent-text)' : weekend ? 'var(--teal)' : 'var(--text)',
        }}
      >
        {DAY_LABELS[wd]}
        {differs(wd) && <span style={{ position: 'absolute', top: 4, right: 5, width: 4, height: 4, borderRadius: '50%', background: on ? 'var(--accent-text)' : 'var(--accent)' }} />}
      </button>
    )
  }

  return (
    <Card pad={20}>
      <SectionTitle>How Nube reacts</SectionTitle>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{WEEKDAYS.map(chip)}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>{WEEKEND.map(chip)}</div>
      <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 10 }}>
        Editing <b style={{ color: 'var(--ink)' }}>{DAY_FULL[day]}</b> · a dot marks days that differ from the default.
      </div>
      <SliderRow title="Nube dies after" value={Math.round(ttdFor(day))} min={1} max={60} step={1} onChange={(v) => upsertDay(day, { timeToDeathMin: v })} accent="var(--warning)" fmt={(v) => `${v} mins of drift`} />
      <SliderRow title="Health restoration" value={Math.round(ratioFor(day) * 100)} min={1} max={50} step={1} onChange={(v) => upsertDay(day, { healDrainRatio: v / 100 })} accent="var(--success)" fmt={(v) => `factor of ${v}%`} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '2px 0 16px', borderBottom: '1px solid var(--line-faint)' }}>
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>Apply values to:</span>
        <Btn variant="line" size="sm" onClick={() => applyToDays(WEEKDAYS)}>Weekdays</Btn>
        <Btn variant="line" size="sm" onClick={() => applyToDays(WEEKEND)}>Weekends</Btn>
        <Btn variant="line" size="sm" onClick={() => applyToDays(ALL_DAYS)}>All</Btn>
      </div>
      <SliderRow title="Grace period before draining" value={sens.graceSecs} min={1} max={60} step={1} onChange={(v) => void save({ sensitivity: { ...sens, graceSecs: v } })} accent="var(--warning)" fmt={(v) => `${v}s`} last />
    </Card>
  )
}

export function Settings() {
  const settings = useSettings((s) => s.settings)
  const save = useSettings((s) => s.save)
  const loadSettings = useSettings((s) => s.load)
  const settingsLoaded = useSettings((s) => s.loaded)
  const connection = useUsage((s) => s.connection)
  const rescan = useUsage((s) => s.rescan)
  const theme = usePrefs((s) => s.theme)
  const sound = usePrefs((s) => s.sound)
  const chimeVoice = usePrefs((s) => s.chimeVoice)
  const chimeVolume = usePrefs((s) => s.chimeVolume)
  const companion = usePrefs((s) => s.companion)
  const updateChannel = usePrefs((s) => s.updateChannel)
  const setPref = usePrefs((s) => s.set)
  const [checking, setChecking] = useState(false)
  const onCheckUpdates = async () => {
    setChecking(true)
    try { await checkForUpdates({ manual: true }) } finally { setChecking(false) }
  }

  useEffect(() => { armChimeUnlock() }, [])

  const notifSoundInput = useRef<HTMLInputElement>(null)
  const [notifSoundError, setNotifSoundError] = useState<string | null>(null)
  const [notifSoundInstalling, setNotifSoundInstalling] = useState(false)

  const onNotifSoundPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    setNotifSoundError(null)
    setNotifSoundInstalling(true)
    try {
      const buf = await file.arrayBuffer()
      const result = await api.installNotificationSound(new Uint8Array(buf), ext)
      if (!result.live) { setNotifSoundError('Custom sounds require the desktop app.'); return }
      await loadSettings()
    } catch (err) {
      setNotifSoundError(String(err))
    } finally {
      setNotifSoundInstalling(false)
    }
  }

  const removeNotifSound = async () => {
    await api.removeNotificationSound()
    await loadSettings()
  }

  const previewNotifSound = (path: string) => {
    // convertFileSrc not needed here — we use a regular Audio element with the
    // asset:// protocol that Tauri sets up for local files in the webview.
    const a = new Audio(`asset://localhost/${encodeURIComponent(path).replace(/%2F/g, '/')}`)
    void a.play().catch(() => {
      // If asset:// doesn't work in this context, fall back to a fetch+blob.
      fetch(`asset://localhost/${encodeURIComponent(path).replace(/%2F/g, '/')}`)
        .then((r) => r.blob())
        .then((b) => { new Audio(URL.createObjectURL(b)).play() })
        .catch(() => {})
    })
  }

  const [discovered, setDiscovered] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)

  useEffect(() => { if (!settingsLoaded) void loadSettings() }, [settingsLoaded, loadSettings])
  useEffect(() => { void api.getKnownApps().then((r) => setDiscovered(r.data.map((a) => a.name))) }, [])

  if (!settings) return <div style={{ color: 'var(--faint)', fontSize: 13 }}>Loading…</div>

  const tagged = settings.distractionApps
  const isOn = (name: string) => tagged.some((d) => d.toLowerCase() === name.toLowerCase())

  // union of discovered + tagged apps (tagged always show), draining ones first
  const seen = new Map<string, string>()
  for (const n of [...discovered, ...tagged]) {
    if (!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n)
  }
  const apps = [...seen.values()].sort((a, b) => {
    const oa = isOn(a) ? 0 : 1, ob = isOn(b) ? 0 : 1
    return oa - ob || a.localeCompare(b)
  })

  const toggleApp = (name: string) => {
    const next = isOn(name) ? tagged.filter((d) => d.toLowerCase() !== name.toLowerCase()) : [...tagged, name]
    void save({ distractionApps: next })
  }

  const scan = async () => {
    setScanning(true)
    const [known, running] = await Promise.all([api.getKnownApps(), api.listRunningApps()])
    const names = new Set([...known.data.map((a) => a.name), ...running.data])
    setDiscovered((prev) => [...new Set([...prev, ...names])])
    setTimeout(() => setScanning(false), 600)
  }

  const sens = settings.sensitivity

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14, alignItems: 'start' }}>
        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card pad={20}>
            <SectionTitle right={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Pill tone="amber" style={{ fontSize: 11.5 }}>{tagged.length} draining</Pill><Btn variant="line" size="sm" onClick={scan}>{scanning ? 'Scanning…' : 'Scan apps'}</Btn></div>}>
              Distractions
            </SectionTitle>
            {apps.length === 0 && !scanning && (
              <div style={{ textAlign: 'center', padding: '20px 0 6px', color: 'var(--faint)', fontSize: 13 }}>No apps detected yet — run a scan.</div>
            )}
            <div style={{ maxHeight: 248, overflow: 'auto', margin: '0 -2px', paddingRight: 2 }}>
              {apps.map((name, i) => <AppRow key={name} name={name} on={isOn(name)} onToggle={() => toggleApp(name)} last={i === apps.length - 1} />)}
            </div>
          </Card>

          <Card pad={20}>
            <SectionTitle right={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: connection?.connected ? 'var(--success)' : 'var(--faint)' }}><Dot tone={connection?.connected ? 'var(--success)' : 'var(--faint)'} size={7} pulse={connection?.connected} /> {connection?.connected ? 'Connected' : 'Not connected'}</span>}>
              Claude Code
            </SectionTitle>
            <div className="nn-mono" style={{ fontSize: 12, color: 'var(--faint)', marginBottom: 14 }}>{connection?.projectsDetected ?? 0} projects · {(connection?.sessionsScanned ?? 0).toLocaleString()} sessions scanned</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="line" size="sm" onClick={() => void api.uninstallHooks()}>Remove hook</Btn>
              <Btn variant="soft" size="sm" onClick={() => void rescan()}>Rescan logs</Btn>
            </div>
            <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.5, marginTop: 14 }}>
              The hook tells Nube the moment Claude finishes a turn, so drift only counts while Claude is actually idle.
            </div>
          </Card>
        </div>

        {/* RIGHT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <HowNubeReacts sens={sens} save={save} />

          <Card pad={20}>
            <SectionTitle>Preferences</SectionTitle>
            <PrefRow title="Theme" desc="Configure your preferred theme.">
              <SegTabs<Theme> tabs={[{ key: 'dark', label: 'Dark' }, { key: 'light', label: 'Light' }]} value={theme} onChange={(v) => setPref('theme', v)} size="sm" />
            </PrefRow>
            <PrefRow title="Desktop companion" desc="A floating widget that watches over you.">
              <Toggle on={companion} onChange={(v) => setPref('companion', v)} />
            </PrefRow>
            <PrefRow title="Sound" desc="A chime when Claude finishes and is waiting on you; a notification when you drift.">
              <Toggle on={sound} onChange={(v) => setPref('sound', v)} />
            </PrefRow>
            {sound && (
              <PrefRow title="Chime" desc="Pick a voice for the finish chime, then preview it.">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => playChime(chimeVoice, chimeVolume)}
                    title="Preview chime"
                    style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 'var(--r-md)', border: '1px solid var(--line)', background: 'var(--surface-faint)', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.8v8.4L10 6z" /></svg>
                  </button>
                  <select
                    value={chimeVoice}
                    onChange={(e) => { const v = e.target.value as ChimeVoice; setPref('chimeVoice', v); playChime(v, chimeVolume) }}
                    className="nn-ui"
                    style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', background: 'var(--surface-faint)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: '7px 11px', cursor: 'pointer', colorScheme: theme }}
                  >
                    {CHIME_VOICES.map((v) => <option key={v} value={v}>{VOICE_LABEL[v]}</option>)}
                  </select>
                </div>
              </PrefRow>
            )}
            {sound && (
              <SliderRow title="Chime volume" value={Math.round(chimeVolume * 100)} min={0} max={100} step={5} onChange={(v) => setPref('chimeVolume', v / 100)} accent="var(--accent)" fmt={(v) => `${v}%`} />
            )}
            {sound && (
              <PrefRow title="Notification sound" desc="Plays when you drift to a distraction app.">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {settings.notificationSoundName && settings.notificationSoundPath ? (
                    <>
                      <span style={{ fontSize: 12.5, color: 'var(--faint)', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {settings.notificationSoundPath.split('/').pop()}
                      </span>
                      <button onClick={() => previewNotifSound(settings.notificationSoundPath!)} title="Preview" style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 'var(--r-md)', border: '1px solid var(--line)', background: 'var(--surface-faint)', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.8v8.4L10 6z" /></svg>
                      </button>
                      <button onClick={() => void removeNotifSound()} title="Remove" style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 'var(--r-md)', border: '1px solid var(--line)', background: 'var(--surface-faint)', color: 'var(--faint)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, lineHeight: 1 }}>×</button>
                    </>
                  ) : (
                    <span style={{ fontSize: 12.5, color: 'var(--faint)' }}>System default</span>
                  )}
                  <input ref={notifSoundInput} type="file" accept="audio/*" style={{ display: 'none' }} onChange={(e) => void onNotifSoundPicked(e)} />
                  <Btn variant="line" size="sm" onClick={() => notifSoundInput.current?.click()} disabled={notifSoundInstalling}>
                    {notifSoundInstalling ? 'Installing…' : 'Browse…'}
                  </Btn>
                </div>
                {notifSoundError && <div style={{ fontSize: 12, color: 'var(--critical)', marginTop: 6 }}>{notifSoundError}</div>}
              </PrefRow>
            )}
            <PrefRow title="Updates" desc={`v${version}`} last>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <SegTabs<UpdateChannel> tabs={[{ key: 'stable', label: 'Stable' }, { key: 'beta', label: 'Beta' }]} value={updateChannel} onChange={(v) => setPref('updateChannel', v)} size="sm" />
                <Btn variant="line" size="sm" onClick={() => void onCheckUpdates()} disabled={checking}>{checking ? 'Checking…' : 'Check'}</Btn>
              </div>
            </PrefRow>
          </Card>
        </div>
      </div>
    </div>
  )
}
