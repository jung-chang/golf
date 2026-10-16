import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Separate from vite.config.ts so tests don't spin up the Cloudflare/PWA plugins.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [react()],
  test: { include: ['test/**/*.test.{ts,tsx}'] },
});
