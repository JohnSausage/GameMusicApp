import { useEffect, useRef, useState } from 'react'
import type { GetEngine } from '../App'
import { CLIP_LEVEL, meterPosition, METER_FLOOR_DB, toDecibels } from '../audio/meter'

/** How fast the bars fall back, per frame (about 20 dB a second at 60 frames). */
const FALL = 0.94
/** How long the highest peak stays marked. */
const HOLD_MS = 1500

/**
 * Master level meter (REQUIREMENTS.md PLAY-06): the left and right peak of
 * what is heard, with the recent highest peak marked, and a light that stays
 * on once the mix clipped (click it to reset). Runs while something plays.
 */
export function MasterMeter({ getEngine, active }: { getEngine: GetEngine; active: boolean }): React.JSX.Element {
  const meterRef = useRef<HTMLDivElement>(null)
  const [clipped, setClipped] = useState(false)
  const [loudest, setLoudest] = useState(0)

  useEffect(() => {
    if (!active) return
    let frame = 0
    let stopped = false
    const shown = [0, 0]
    const held = [
      { peak: 0, at: 0 },
      { peak: 0, at: 0 }
    ]
    let highest = 0
    void getEngine().then((engine) => {
      if (stopped) return
      const fills = meterRef.current?.querySelectorAll<HTMLElement>('.master-meter-fill') ?? []
      const holds = meterRef.current?.querySelectorAll<HTMLElement>('.master-meter-hold') ?? []
      const tick = (): void => {
        const now = performance.now()
        engine.levels().forEach((peak, i) => {
          shown[i] = Math.max(peak, shown[i] * FALL)
          if (peak >= held[i].peak || now - held[i].at > HOLD_MS) held[i] = { peak, at: now }
          fills[i]?.style.setProperty('width', `${meterPosition(shown[i]) * 100}%`)
          holds[i]?.style.setProperty('left', `${meterPosition(held[i].peak) * 100}%`)
          if (peak > highest) highest = peak
        })
        if (highest >= CLIP_LEVEL) setClipped(true)
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    })
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      setLoudest(highest)
      meterRef.current?.querySelectorAll<HTMLElement>('.master-meter-fill').forEach((fill) => fill.style.setProperty('width', '0%'))
      meterRef.current?.querySelectorAll<HTMLElement>('.master-meter-hold').forEach((hold) => hold.style.setProperty('left', '0%'))
    }
  }, [active, getEngine])

  const db = toDecibels(loudest)
  const title = clipped
    ? 'The mix went over full scale and clipped: turn some tracks down. Click to reset.'
    : `Master level, left and right${loudest > 0 ? ` (last time up to ${db.toFixed(1)} dBFS)` : ''}. The scale goes from ${METER_FLOOR_DB} dB to 0 dB.`
  return (
    <div ref={meterRef} className="master-meter" title={title} aria-label="Master level meter">
      <div className="master-meter-bars">
        {['L', 'R'].map((side) => (
          <div key={side} className="master-meter-bar">
            <div className="master-meter-fill" />
            <div className="master-meter-hold" />
          </div>
        ))}
      </div>
      <button className={`master-meter-clip ${clipped ? 'on' : ''}`} aria-label={clipped ? 'Clipped: click to reset' : 'No clipping'} onClick={() => setClipped(false)} />
    </div>
  )
}
