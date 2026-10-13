// Settings: appearance, companion, chimes, updates. The economy's numbers live
// on the Rules page.

import { useState } from 'react'
import { checkForUpdates } from '../lib/updater'
import { CHIME_VOICES, playChime, type ChimeVoice } from '../lib/chime'
import { usePrefs, type Theme, type UpdateChannel } from '../store/prefs'
import { Btn, Card, Pill, PrefRow, SegTabs, Section, Slider, Toggle } from '../components/ui'
import { version } from '../../package.json'

export function Settings() {
  const prefs = usePrefs()
  const setPref = prefs.set
  const [checking, setChecking] = useState(false)
  const check = async () => {
    setChecking(true)
    await checkForUpdates({ manual: true })
    setChecking(false)
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14, alignItems: 'stretch', maxWidth: 1100 }}>
      <Card pad={20}>
        <Section>General</Section>
        <PrefRow title="Theme">
          <SegTabs<Theme> tabs={[{ key: 'dark', label: 'Dark' }, { key: 'light', label: 'Light' }]} value={prefs.theme} onChange={(v) => setPref('theme', v)} size="sm" />
        </PrefRow>
        <PrefRow title="Desktop companion" desc="A floating Nube that shows your timer and rest." last>
          <Toggle on={prefs.companion} onChange={(v) => setPref('companion', v)} />
        </PrefRow>
      </Card>
      <Card pad={20}>
        <Section>Sound</Section>
        <PrefRow title="Chimes" desc="Plays when a timer ends or you start resting." last={!prefs.sound}>
          <Toggle on={prefs.sound} onChange={(v) => setPref('sound', v)} />
        </PrefRow>
        {prefs.sound && (
          <PrefRow title="Voice">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Btn variant="line" size="sm" onClick={() => playChime(prefs.chimeVoice, prefs.chimeVolume)}>Preview</Btn>
              <select value={prefs.chimeVoice} onChange={(e) => { const v = e.target.value as ChimeVoice; setPref('chimeVoice', v); playChime(v, prefs.chimeVolume) }} className="nn-ui"
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', background: 'var(--surface-faint)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: '6px 10px', cursor: 'pointer', colorScheme: prefs.theme }}>
                {CHIME_VOICES.map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
              </select>
            </div>
          </PrefRow>
        )}
        {prefs.sound && (
          <Slider title="Volume" value={Math.round(prefs.chimeVolume * 100)} min={0} max={100} step={5} onChange={(v) => setPref('chimeVolume', v / 100)} fmt={(v) => `${v}%`} last />
        )}
      </Card>
      <Card pad={20}>
        <Section right={<Pill style={{ fontSize: 11.5 }}>{`v${version}`}</Pill>}>Updates</Section>
        <PrefRow title="Release channel" desc="Beta gets new features first." last>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SegTabs<UpdateChannel> tabs={[{ key: 'stable', label: 'Stable' }, { key: 'beta', label: 'Beta' }]} value={prefs.updateChannel} onChange={(v) => setPref('updateChannel', v)} size="sm" />
            <Btn variant="line" size="sm" onClick={() => void check()} disabled={checking}>{checking ? 'Checking…' : 'Check'}</Btn>
          </div>
        </PrefRow>
      </Card>
    </div>
  )
}
