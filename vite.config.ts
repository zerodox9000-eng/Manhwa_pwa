import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/ml-preview/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png', 'maskable-512.png'],
      manifest: {
        name: 'Manhwa Lib',
        short_name: 'Manhwa Lib',
        description: 'Local-first manhwa discovery grids powered by MangaBaka and AniList exports.',
        theme_color: '#ff006e',
        background_color: '#0d0d12',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/ml-preview/',
        start_url: '/ml-preview/',
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
        navigateFallback: '/ml-preview/index.html',
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
