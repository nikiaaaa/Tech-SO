/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

const BACKEND = process.env.TECHSO_BACKEND ?? 'http://127.0.0.1:8000'

// `--mode https` serves a self-signed certificate. Browsers only expose GPS (navigator.geolocation) on
// https:// or localhost, so a phone on the LAN needs this mode to use real GPS.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: false },
      '/ws': {
        target: BACKEND.replace('http', 'ws'),
        ws: true,
        // The API only accepts WebSocket origins from its allow-list; behind this dev proxy the page origin
        // can be a LAN address, so present the canonical dev origin to the backend.
        configure: (proxy) => proxy.on('proxyReqWs', (req) => req.setHeader('origin', 'http://localhost:5173')),
      },
    },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'], css: false },
}))
