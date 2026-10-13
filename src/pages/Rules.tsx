// Rules: the numbers behind the economy (work:rest ratio, finish multiplier,
// quick-start lengths, daily target bonus).

import { hueSwatch } from '../lib/clay'
import { FINISH, WARMTH } from '../lib/economy'
import { fmtHM } from '../lib/format'
import { usePrefs } from '../store/prefs'
import { useSettings } from '../store/settings'
import { Card, PrefRow, SegTabs, Section, Slider } from '../components/ui'

const STEP_OPTIONS = ['10', '15', '20', '30'] as const

export function Rules() {
  const s = useSettings((st) => st.settings)
  const save = useSettings((st) => st.save)
  const dark = usePrefs((p) => p.theme) === 'dark'
  if (!s) return null

  const setPreset = (i: number, v: number) => {
    const presets = s.presets.slice()
    presets[i] = Math.max(5, Math.min(180, v || 5))
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8 }}>
            {s.presets.map((m, i) => (
              <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 'var(--r-md)', background: 'var(--surface-faint)', border: '1px solid var(--line)' }}>
                <input type="number" value={m} min={5} max={180} step={5} onChange={(e) => setPreset(i, +e.target.value)} className="nn-num"
                  style={{ width: '100%', minWidth: 0, fontSize: 14, color: 'var(--ink)', background: 'transparent', border: 'none', outline: 'none', userSelect: 'text' }} />
                <span style={{ fontSize: 12, color: 'var(--faint)' }}>min</span>
              </label>
            ))}
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
