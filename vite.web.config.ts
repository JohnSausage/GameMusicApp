// Runs the renderer in a normal browser (no Electron), for quick UI checks.
// File saving falls back to browser downloads in this mode.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  worker: { format: 'es' },
  // See electron.vite.config.ts.
  optimizeDeps: { include: ['@tensorflow/tfjs', '@spotify/basic-pitch', '@spotify/basic-pitch/esm/toMidi'] },
  server: { port: 5173, strictPort: true }
})
