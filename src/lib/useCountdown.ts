import { useEffect, useState } from 'react'

// Smooth real-time countdown shared by Home + Companion so they stay identical.
// Re-anchors to the backend value (`target`) whenever it changes, and — while
// `active` — ticks down locally every second so the number moves smoothly between
// the ~2s backend ticks. When `target` is null (not drifting) it shows nothing.
export function useCountdown(target: number | null, active: boolean): number | null {
  const [shown, setShown] = useState<number | null>(target)
  useEffect(() => { setShown(target) }, [target])
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setShown((s) => (s == null ? s : Math.max(0, s - 1))), 1000)
    return () => clearInterval(id)
  }, [active])
  return shown
}

// Smooth count-UP for the live Home timers. Re-anchors to the backend total
// (`base`) whenever it updates (~2s), and between updates adds `perSecond` each
// second so the clock ticks smoothly. `perSecond` may be >1 (the work timer adds
// the running-session count, so it speeds up with more concurrent sessions).
export function useCountUp(base: number, perSecond: number): number {
  const [shown, setShown] = useState(base)
  useEffect(() => { setShown(base) }, [base])
  useEffect(() => {
    if (perSecond <= 0) return
    const id = setInterval(() => setShown((s) => s + perSecond), 1000)
    return () => clearInterval(id)
  }, [perSecond])
  return shown
}
