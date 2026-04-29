import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base so the built bundle works under capacitor:// (iOS) and
  // file:// — absolute '/assets/...' paths fail in native shells.
  base: './',
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
})
