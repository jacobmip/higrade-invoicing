import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base so the built bundle works under capacitor:// (iOS) and
  // file:// — absolute '/assets/...' paths fail in native shells.
  base: './',
  server: {
    // Listen on all network interfaces so live-reload works from a phone
    // on the same Wi-Fi (Capacitor dev server).
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
})
