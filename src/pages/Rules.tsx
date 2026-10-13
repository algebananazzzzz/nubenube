// Rules: the numbers behind the economy (work:rest ratio, finish multiplier,
// quick-start lengths, daily target bonus).

import { useEffect, useState } from 'react'
import { hueSwatch } from '../lib/clay'
import { FINISH, WARMTH } from '../lib/economy'
import { fmtHM } from '../lib/format'
import { usePrefs } from '../store/prefs'
import { useSettings } from '../store/settings'
import { Card, PrefRow, SegTabs, Section, Slider } from '../components/ui'

const STEP_OPTIONS = ['10', '15', '20', '30'] as const
const PRESET_MIN = 5, PRESET_MAX = 180, PRESET_STEP = 5

const clampPreset = (v: number) => Math.max(PRESET_MIN, Math.min(PRESET_MAX, Math.round(v)))

const stepBtn = {
  width: 26, height: 26, flexShrink: 0, borderRadius: 'var(--r-sm)', border: '1px solid var(--line-faint)',
  background: 'var(--surface)', color: 'var(--text)', fontSize: 15, fontWeight: 600, lineHeight: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer',
} as const

// Typing commits on blur/Enter: clamping per keystroke would turn the "1" of "120" into 5.
function PresetField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const v = clampPreset(Number(draft) || value)
    setDraft(String(v))
    if (v !== value) onCommit(v)
  }
  const step = (d: number) => onCommit(clampPreset(value + d))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 6, borderRadius: 'var(--r-md)', background: 'var(--surface-faint)', border: '1px solid var(--line)' }}>
      <button title="Shorter" disabled={value <= PRESET_MIN} onClick={() => step(-PRESET_STEP)} style={{ ...stepBtn, opacity: value <= PRESET_MIN ? .4 : 1 }}>−</button>
      <label style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 3 }}>
        <input value={draft} inputMode="numeric" onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} className="nn-num"
          style={{ width: `${Math.max(2, draft.length)}ch`, flexShrink: 0, fontSize: 17, fontWeight: 700, color: 'var(--ink)', background: 'transparent', border: 'none', outline: 'none', padding: 0, textAlign: 'right', userSelect: 'text' }} />
        <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>min</span>
      </label>
      <button title="Longer" disabled={value >= PRESET_MAX} onClick={() => step(PRESET_STEP)} style={{ ...stepBtn, opacity: value >= PRESET_MAX ? .4 : 1 }}>+</button>
    </div>
  )
}

export function Rules() {
  const s = useSettings((st) => st.settings)
  const save = useSettings((st) => st.save)
  const dark = usePrefs((p) => p.theme) === 'dark'
  if (!s) return null

  const setPreset = (i: number, v: number) => {
    const presets = s.presets.slice()
    presets[i] = v
    void save({ presets })
  }
  const col = { display: 'flex', flexDirection: 'column', gap: 14 } as const

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 14, alignItems: 'start', maxWidth: 1100 }}>
      <div style={col}>
        <Card pad={20}>
          <Section sub="How much work earns a minute of rest.">Work : rest ratio</Section>
          <div className="nn-num" style={{ fontSize: 44, fontWeight: 700, color: 'var(--ink)', lineHeight: 1, margin: '6px 0 2px' }}>
            {s.ratio} <span style={{ color: 'var(--faint)' }}>:</span> 1
          </div>
          <Slider title="Ratio" value={s.ratio} min={2} max={10} step={1} onChange={(v) => void save({ ratio: v })} fmt={(v) => `${v} min work → 1 min rest`} last />
        </Card>
        <Card pad={20}>
          <Section sub="The longer you stay focused, the more you earn.">Focus multiplier</Section>
          <PrefRow title="Goes up every">
            <SegTabs tabs={STEP_OPTIONS.map((m) => ({ key: m, label: `${m}m` }))} value={String(s.finishEvery) as (typeof STEP_OPTIONS)[number]} onChange={(v) => void save({ finishEvery: Number(v) })} size="sm" />
          </PrefRow>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 6, marginTop: 12 }}>
            {FINISH.map((m, i) => (
              <div key={i} style={{ padding: '10px 10px 9px', borderRadius: 'var(--r-md)', background: 'var(--surface-faint)', border: '1px solid var(--line-faint)' }}>
                <div className="nn-num" style={{ fontSize: 17, color: hueSwatch(WARMTH[i].hue, dark) }}>×{m}</div>
                <div className="nn-num" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3 }}>{i === 0 ? 'start' : `from ${i * s.finishEvery}m`}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card pad={20}>
          <Section sub="Your go-to session lengths on Home.">Quick starts</Section>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
            {s.presets.map((m, i) => <PresetField key={i} value={m} onCommit={(v) => setPreset(i, v)} />)}
          </div>
        </Card>
      </div>
      <div style={col}>
        <Card pad={20}>
          <Section sub="Hit your daily target to earn extra rest for the weekend.">Daily target bonus</Section>
          <Slider title="Bonus" value={s.targetBonusMin} min={0} max={90} step={5} onChange={(v) => void save({ targetBonusMin: v })} accent="var(--success)"
            fmt={(v) => (v ? `+${fmtHM(v * 60)} rest` : 'none')} last />
        </Card>
      </div>
    </div>
  )
}
