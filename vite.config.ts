import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' }, // maplibre's worker is an ES module
  build: { chunkSizeWarningLimit: 1200 }, // maplibre alone is ~1 MB (lazy-loaded with the Play screen)
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Tee Times',
        short_name: 'Tee Times',
        description: 'NYC tee times for the group: find, propose, play.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f8f6ee',
        theme_color: '#2f7d4f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        importScripts: ['push-sw.js'],
        // /api and Access's own pages (sign-in, sign-out) must reach the network, not the cached app.
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // maplibre is ~1 MB
        // Satellite tiles you've looked at stay on the phone, so the map still shows with no signal.
        runtimeCaching: [{
          urlPattern: /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\//,
          handler: 'CacheFirst',
          // MapLibre fetches tiles with CORS, so only real 200s are kept (opaque responses would eat storage quota).
          options: { cacheName: 'satellite', expiration: { maxEntries: 2500, maxAgeSeconds: 90 * 24 * 60 * 60 }, cacheableResponse: { statuses: [200] } },
        }],
      },
    }),
  ],
});
