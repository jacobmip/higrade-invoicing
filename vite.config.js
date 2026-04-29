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
    // Proxy /api/* to the live Vercel deployment so the AI / email /
    // signature serverless functions work in `npm run dev` without
    // needing to run a local backend.
    proxy: {
      '/api': {
        target: 'https://higrade-invoicing.vercel.app',
        changeOrigin: true,
        secure: true
      }
    }
  }
})
