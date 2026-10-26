import { useEffect, useRef, useState } from 'react'
import type { AudioEngine, PlayOptions } from '../audio/engine'
import type { Song } from '../model/song'
import type { GetEngine } from '../App'

/** Play/stop a song and expose the playback position for the score cursor. */
export function usePlayback(getEngine: GetEngine): {
  playing: boolean
  positionRef: React.RefObject<number | null>
  play: (song: Song, from?: number, options?: PlayOptions) => Promise<void>
  stop: () => void
  /** Volume, mute and solo changes while playing. */
  updateMix: (song: Song) => void
  setMetronome: (on: boolean) => void
} {
  const [playing, setPlaying] = useState(false)
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
    await engine.play(song, from, options)
    setPlaying(true)
  }

  const updateMix = (song: Song): void => engineRef.current?.updateMix(song)

  const setMetronome = (on: boolean): void => engineRef.current?.setMetronome(on)

  const stop = (): void => {
    engineRef.current?.stop()
    setPlaying(false)
  }

  return { playing, positionRef, play, stop, updateMix, setMetronome }
}
