import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
    worker: { format: 'es' },
    // Pre-bundle the transcription libraries at startup; discovering them on first use makes
    // the dev server reload the page, which would lose an unsaved project.
    optimizeDeps: { include: ['@tensorflow/tfjs', '@spotify/basic-pitch', '@spotify/basic-pitch/esm/toMidi'] }
  }
})
