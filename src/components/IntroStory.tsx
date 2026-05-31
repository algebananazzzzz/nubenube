// IntroStory — first-launch whimsical storybook overlay. Ported from intro.jsx.

import { useState } from 'react'
import { NubeCreature } from './NubeCreature'
import { Sky, Cloud, Sun, Twinkles, Rain } from './Biome'
import { Btn, SUB, FAINT } from './ui'
import { hueClay } from '../lib/clay'
import type { NubeMood, SkyState } from '../lib/derive'

type Panel = { sky: SkyState; mood: NubeMood; hue: number; scale: number; sun?: boolean; rain?: boolean; title: string; lines: string[] }

const STORY: Panel[] = [
  { sky: 'calm', mood: 'content', hue: 270, scale: 0.8, title: 'meet Nube', lines: ['This little cloud is Nube.', 'Nube lives inside your projects — and feeds on your focus.'] },
  { sky: 'working', mood: 'thriving', hue: 205, scale: 1.0, sun: true, title: 'it drinks your tokens', lines: ['Every time Claude Code works for you, Nube drinks the tokens', 'and evaporates them into water. The more it drinks, the bigger it grows.'] },
  { sky: 'worried', mood: 'worried', hue: 45, scale: 0.95, rain: true, title: 'but it gets lonely', lines: ['The moment Claude finishes and waits for you —', 'if you wander off to YouTube, Nube starts to weep its water away.'] },
  { sky: 'faint', mood: 'faint', hue: 270, scale: 1.0, title: "don't let it fade", lines: ['Drift too long and Nube faints clean away.', 'Revive it by getting back to work — 1 litre is about 10 minutes of focus.'] },
  { sky: 'mint', mood: 'thriving', hue: 155, scale: 1.05, title: 'keep your bloops happy', lines: ['Respond fast, stay in flow, and watch your little clouds thrive.', "Ready? Let's meet yours."] },
]

export function IntroStory({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0)
  const s = STORY[i]
  const last = i === STORY.length - 1
  const c = hueClay(s.hue)

  return (
    <div className="nn-ui" style={{ position: 'absolute', inset: 0, zIndex: 200, borderRadius: 'inherit', overflow: 'hidden' }}>
      <Sky state={s.sky}>
        {s.sun && <Sun x={'72%'} y={40} size={70} />}
        <Cloud x={-30} y={56} scale={0.7} health={1} dur={18} anim="drift1" />
        <Cloud x={'64%'} y={'62%'} scale={0.62} health={1} dur={24} delay={1} anim="drift2" />
        {s.sky === 'working' && <Twinkles count={9} area={{ w: 900, h: 460 }} />}
        {s.rain && <Rain count={14} area={{ w: 900, h: 360 }} color={c.mid} />}
      </Sky>

      <div key={i} style={{ position: 'absolute', left: '50%', top: '35%', transform: 'translate(-50%,-50%)', animation: 'nnPop .5s ease both' }}>
        <NubeCreature mood={s.mood} hue={s.hue} size={210} scale={s.scale} />
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '34px 40px 30px', background: 'linear-gradient(to top, rgba(255,255,255,.96) 60%, rgba(255,255,255,0))', textAlign: 'center' }}>
        <div key={`t${i}`} style={{ animation: 'nnFadeUp .5s ease both' }}>
          <div className="nn-disp" style={{ fontWeight: 800, fontSize: 30, color: c.ink, lineHeight: 1.05 }}>{s.title}</div>
          <div style={{ maxWidth: 540, margin: '10px auto 0', fontWeight: 600, fontSize: 15.5, color: SUB, lineHeight: 1.5 }}>
            {s.lines.map((l, k) => (
              <div key={k}>{l}</div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 7, margin: '20px 0 18px' }}>
          {STORY.map((_, k) => (
            <button key={k} onClick={() => setI(k)} style={{ width: k === i ? 22 : 8, height: 8, borderRadius: 99, border: 'none', cursor: 'pointer', padding: 0, background: k === i ? c.deep : 'rgba(120,100,170,.25)', transition: 'all .25s ease' }} />
          ))}
        </div>

        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14 }}>
          {i > 0 && (
            <Btn hue={s.hue} kind="ghost" size="md" onClick={() => setI(i - 1)}>
              back
            </Btn>
          )}
          <Btn hue={s.hue} size="lg" onClick={() => (last ? onDone() : setI(i + 1))}>
            {last ? 'meet your Nube →' : 'next'}
          </Btn>
          {!last && (
            <button onClick={onDone} style={{ position: 'absolute', right: 0, bottom: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: FAINT, fontFamily: 'var(--font-disp)', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
              skip intro
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
