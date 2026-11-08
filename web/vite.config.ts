/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH sets the public path for sub-folder hosting, e.g. "/chess-analyser/" on
// https://<user>.github.io/chess-analyser/. Defaults to "/" for local dev and root hosting.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: base.endsWith('/') ? base : `${base}/`,
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
