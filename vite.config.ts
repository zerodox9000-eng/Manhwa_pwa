import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/Manhwa_pwa/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png', 'maskable-512.png'],
      manifest: {
        name: 'Aeon',
        short_name: 'Aeon',
        description: 'Explore focused manhwa feeds, meaningful rankings, powerful search, and personal title collections.',
        theme_color: '#11131a',
        background_color: '#08090d',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/Manhwa_pwa/',
        start_url: '/Manhwa_pwa/',
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/Manhwa_pwa/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === 'https://raw.githubusercontent.com' || url.origin === 'https://zerodox9000-eng.github.io',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'manhwa-export-data-v2',
              networkTimeoutSeconds: 12,
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname.includes('mangabaka.dev') || url.hostname.includes('anilist.co'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'manhwa-covers',
              expiration: {
                maxEntries: 800,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],
})
