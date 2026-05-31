// sound.ts — tiny synthesized chimes (no audio assets). 'danger' when a rescue
// fires, 'relief' when you come back. Gated by the caller on prefs.sound.

let ctx: AudioContext | null = null

function ac(): AudioContext | null {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = ctx || new Ctor()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(c: AudioContext, freq: number, start: number, dur: number, gain = 0.12) {
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(gain, start + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(g).connect(c.destination)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

export function playChime(kind: 'danger' | 'relief') {
  const c = ac()
  if (!c) return
  const t = c.currentTime
  if (kind === 'danger') {
    // two soft, slightly urgent descending notes
    tone(c, 622, t, 0.18, 0.1)
    tone(c, 466, t + 0.16, 0.26, 0.1)
  } else {
    // gentle rising "all better" two-note
    tone(c, 587, t, 0.16, 0.09)
    tone(c, 880, t + 0.13, 0.3, 0.09)
  }
}
