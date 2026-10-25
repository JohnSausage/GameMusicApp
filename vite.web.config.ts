// Runs the renderer in a normal browser (no Electron), for quick UI checks.
// File saving falls back to browser downloads in this mode.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true }
})
