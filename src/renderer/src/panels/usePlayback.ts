import { useEffect, useRef, useState } from 'react'
import type { AudioEngine, PlayOptions } from '../audio/engine'
import type { Song } from '../model/song'
import type { GetEngine } from '../App'

export type Playback = ReturnType<typeof usePlayback>

/** Play/stop a song and expose the playback position for the score cursor. */
export function usePlayback(getEngine: GetEngine): {
  playing: boolean
  positionRef: React.RefObject<number | null>
  play: (song: Song, from?: number, options?: PlayOptions) => Promise<void>
  stop: () => void
  /** Volume, mute and solo changes while playing. */
  updateMix: (song: Song) => void
  /** The song position heard at a performance.now() time (see AudioEngine.positionAt). */
  positionAt: (performanceMs: number) => number | null
  setMetronome: (on: boolean) => void
  /** Playback speed for practicing (PLAY-08); songs play at it unless `play` is given another. Applies from the next `play`. */
  speed: number
  setSpeed: (speed: number) => void
} {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeedState] = useState(1)
  const speedRef = useRef(1)
  const positionRef = useRef<number | null>(null)
  const engineRef = useRef<AudioEngine | null>(null)

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = (): void => {
      positionRef.current = engineRef.current?.position() ?? null
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      positionRef.current = null
    }
  }, [playing])

  useEffect(() => () => engineRef.current?.stop(), [])

  const play = async (song: Song, from = 0, options?: PlayOptions): Promise<void> => {
    const engine = await getEngine()
    engineRef.current = engine
    engine.onEnded = () => setPlaying(false)
    await engine.play(song, from, { speed: speedRef.current, ...options })
    setPlaying(true)
  }

  const updateMix = (song: Song): void => engineRef.current?.updateMix(song)

  const setMetronome = (on: boolean): void => engineRef.current?.setMetronome(on)

  const stop = (): void => {
    engineRef.current?.stop()
    setPlaying(false)
  }

  const positionAt = (performanceMs: number): number | null => engineRef.current?.positionAt(performanceMs) ?? null

  const setSpeed = (value: number): void => {
    speedRef.current = value
    setSpeedState(value)
  }

  return { playing, positionRef, play, stop, updateMix, setMetronome, positionAt, speed, setSpeed }
}
