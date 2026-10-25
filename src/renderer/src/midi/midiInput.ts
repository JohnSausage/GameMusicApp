export interface MidiNoteMessage {
  type: 'on' | 'off'
  pitch: number
  velocity: number
  /** Milliseconds between the MIDI event's timestamp and our handler running. */
  handlerDelayMs: number
  inputName: string
}

export type MidiListener = (message: MidiNoteMessage) => void

/** Listens to note on/off messages from all connected MIDI inputs (hot-plugging included). */
export class MidiKeyboard {
  private access: MIDIAccess | null = null
  onNote: MidiListener | null = null
  onDevicesChanged: ((names: string[]) => void) | null = null

  async connect(): Promise<string[]> {
    this.access = await navigator.requestMIDIAccess()
    this.access.onstatechange = () => {
      this.attach()
      this.onDevicesChanged?.(this.inputNames())
    }
    this.attach()
    return this.inputNames()
  }

  inputNames(): string[] {
    return this.access ? [...this.access.inputs.values()].map((i) => i.name ?? 'Unknown device') : []
  }

  private attach(): void {
    for (const input of this.access?.inputs.values() ?? []) {
      input.onmidimessage = (event) => this.handle(event, input.name ?? 'Unknown device')
    }
  }

  private handle(event: MIDIMessageEvent, inputName: string): void {
    const data = event.data
    if (!data || data.length < 3) return
    const status = data[0] & 0xf0
    const handlerDelayMs = performance.now() - event.timeStamp
    if (status === 0x90 && data[2] > 0) {
      this.onNote?.({ type: 'on', pitch: data[1], velocity: data[2], handlerDelayMs, inputName })
    } else if (status === 0x80 || (status === 0x90 && data[2] === 0)) {
      this.onNote?.({ type: 'off', pitch: data[1], velocity: 0, handlerDelayMs, inputName })
    }
  }
}

/** Computer keyboard fallback: A W S E D F T G Y H U J K = C4 … C5. */
export const COMPUTER_KEYS: Record<string, number> = {
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72
}
