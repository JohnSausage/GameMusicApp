import { useEffect, useRef, useState } from 'react'
import { waveformPeaks } from '../audio/analysis'

interface Props {
  samples: Float32Array
  sampleRate: number
  /** Beat grid: seconds per click and clicks per bar. */
  secondsPerClick: number
  clicksPerBar: number
  firstDownbeat: number
  onPick: (seconds: number) => void
}

const HEIGHT = 150

/**
 * A take's waveform with the beat grid on top (REC-21): bar lines are stronger,
 * beat 1 is red, the grid before beat 1 is faint. Clicking sets beat 1.
 */
export function Waveform({ samples, sampleRate, secondsPerClick, clicksPerBar, firstDownbeat, onPick }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(800)
  const duration = samples.length / sampleRate

  useEffect(() => {
    const canvas = canvasRef.current!
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.floor(entry.contentRect.width))))
    observer.observe(canvas.parentElement!)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!
    const ratio = window.devicePixelRatio || 1
    canvas.width = width * ratio
    canvas.height = HEIGHT * ratio
    canvas.style.width = `${width}px`
    canvas.style.height = `${HEIGHT}px`
    const g = canvas.getContext('2d')!
    g.scale(ratio, ratio)
    const style = getComputedStyle(canvas)
    const color = (name: string): string => style.getPropertyValue(name).trim()

    g.fillStyle = color('--surface')
    g.fillRect(0, 0, width, HEIGHT)

    // Waveform, scaled up so quiet takes are still visible.
    const { min, max } = waveformPeaks(samples, width)
    const loudest = Math.max(0.05, ...max, ...min.map((v) => -v))
    const middle = HEIGHT / 2
    g.fillStyle = color('--accent')
    for (let x = 0; x < width; x++) {
      const top = middle - (max[x] / loudest) * (middle - 6)
      const bottom = middle - (min[x] / loudest) * (middle - 6)
      g.fillRect(x, top, 1, Math.max(1, bottom - top))
    }

    // Beat grid.
    const toX = (seconds: number): number => (seconds / duration) * width
    const firstIndex = Math.ceil(-firstDownbeat / secondsPerClick)
    for (let i = firstIndex; firstDownbeat + i * secondsPerClick <= duration; i++) {
      const x = Math.round(toX(firstDownbeat + i * secondsPerClick)) + 0.5
      const isBar = ((i % clicksPerBar) + clicksPerBar) % clicksPerBar === 0
      if (i === 0) {
        g.strokeStyle = '#dc2626'
        g.lineWidth = 2
      } else {
        g.strokeStyle = color('--text')
        g.globalAlpha = (i < 0 ? 0.3 : 1) * (isBar ? 0.7 : 0.25)
        g.lineWidth = isBar ? 1.5 : 1
      }
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, HEIGHT)
      g.stroke()
      g.globalAlpha = 1
    }

    // Seconds along the bottom.
    g.fillStyle = color('--muted')
    g.font = '10px system-ui, sans-serif'
    const step = duration > 30 ? 5 : 1
    for (let s = step; s < duration; s += step) g.fillText(`${s}s`, toX(s) + 2, HEIGHT - 4)
  }, [samples, sampleRate, secondsPerClick, clicksPerBar, firstDownbeat, width, duration])

  const pick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    onPick(Math.max(0, ((event.clientX - rect.left) / rect.width) * duration))
  }

  return (
    <div className="waveform">
      <canvas ref={canvasRef} onClick={pick} title="Click where beat 1 of the first bar is" />
    </div>
  )
}
