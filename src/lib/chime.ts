// Synthesized chime for the "Claude finished, you're being waited on" bell.
// Built with WebAudio (no shipped audio asset) so the voice/volume are fully
// tweakable and nothing lands in the repo as a binary. Played by whichever
// window owns playback (the Companion); the `sound` pref is checked at the call
// site, not here.

export type ChimeVoice = 'bell' | 'marimba' | 'chord' | 'koto' | 'blip'

// A voice is a timbre: oscillator shape, decay length, and the relative
// amplitudes of its overtones (index 0 = fundamental).
type Voice = { type: OscillatorType; decay: number; harmonics: number[] }

const VOICES: Record<ChimeVoice, Voice> = {
  bell: { type: 'sine', decay: 1.2, harmonics: [1, 2.0, 3.01, 4.2] },
  marimba: { type: 'triangle', decay: 0.5, harmonics: [1, 4.0] },
  chord: { type: 'sine', decay: 0.95, harmonics: [1, 1.5, 2.0] }, // root + fifth + octave
  koto: { type: 'sawtooth', decay: 0.7, harmonics: [1] },
  blip: { type: 'square', decay: 0.16, harmonics: [1] },
}

export const CHIME_VOICES = Object.keys(VOICES) as ChimeVoice[]

// A note = [frequency Hz, start offset secs]. `finish` is a calm rising fourth
// (E5→A5); `drift` is a more insistent descending triad (kept for callers that
// want an in-app drift cue — the OS notification carries drift sound by default).
const EVENTS: Record<string, [number, number][]> = {
  finish: [[659.25, 0], [880.0, 0.11]],
  drift: [[587.33, 0], [440.0, 0.13], [329.63, 0.26]],
}

export type ChimeEvent = keyof typeof EVENTS

let ctx: AudioContext | null = null
let unlockBound = false

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) ctx = new AC()
  // Webviews hand back a 'suspended' context until a user gesture — nudge it.
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

// Webviews block audio until the first user gesture in that document. Resume the
// context on the first pointer/key event so later programmatic chimes are
// allowed. Idempotent — safe to call from every owner window's mount.
export function armChimeUnlock(): void {
  if (unlockBound || typeof window === 'undefined') return
  unlockBound = true
  const unlock = () => void audio()?.resume()
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock, { passive: true })
}

function strike(ac: AudioContext, voice: Voice, freq: number, t0: number, gain: number): void {
  const out = ac.createGain()
  out.connect(ac.destination)
  voice.harmonics.forEach((mult, i) => {
    const osc = ac.createOscillator()
    osc.type = voice.type
    osc.frequency.value = freq * mult
    const g = ac.createGain()
    const peak = Math.max(0.0002, gain * (i === 0 ? 1 : 0.3 / (i + 1)))
    // Fast attack, exponential decay — a struck-then-ringing envelope.
    g.gain.setValueAtTime(0.0002, t0)
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0002, t0 + voice.decay)
    osc.connect(g)
    g.connect(out)
    osc.start(t0)
    osc.stop(t0 + voice.decay + 0.05)
  })
}

export function playChime(voice: ChimeVoice, volume = 0.6, event: ChimeEvent = 'finish'): void {
  const ac = audio()
  if (!ac) return
  const v = VOICES[voice] ?? VOICES.bell
  const notes = EVENTS[event] ?? EVENTS.finish
  const t0 = ac.currentTime + 0.02
  const vol = Math.max(0, Math.min(1, volume)) * 0.5 // leave headroom against clipping
  for (const [freq, off] of notes) strike(ac, v, freq, t0 + off, vol)
}
