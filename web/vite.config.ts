/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH sets the public path for sub-folder hosting, e.g. "/chess-analyser/" on
// https://<user>.github.io/chess-analyser/. Defaults to "/" for local dev and root hosting.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: base.endsWith('/') ? base : `${base}/`,
  plugins: [
    react(),
    // Installable app that works offline: the app, the opening names and the lite engine are
    // precached. The 95 MB full engine is cached only once the user has chosen and downloaded it.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Chess on the Fly',
        short_name: 'Chess on the Fly',
        description: 'Review your chess games and train your opening repertoire, in the browser.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#2f4858',
        theme_color: '#2f4858',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json,webmanifest}', 'engines/stockfish-19-lite-single.{js,wasm}', 'engines/*.txt'],
        globIgnores: ['engines/stockfish-19-single.*'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/engines\/stockfish-19-single\.(js|wasm)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'engine-full', expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
