// Collects mono input samples and posts them to the main thread in chunks.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunk = new Float32Array(4096)
    this.filled = 0
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (input) {
      let offset = 0
      while (offset < input.length) {
        const count = Math.min(input.length - offset, this.chunk.length - this.filled)
        this.chunk.set(input.subarray(offset, offset + count), this.filled)
        this.filled += count
        offset += count
        if (this.filled === this.chunk.length) {
          this.port.postMessage(this.chunk)
          this.chunk = new Float32Array(4096)
          this.filled = 0
        }
      }
    }
    return true
  }
}

registerProcessor('recorder', RecorderProcessor)
