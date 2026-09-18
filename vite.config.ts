import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true }
    }
  },
  build: { outDir: 'dist/public' },
  test: {
    include: ['src/**/*.test.ts'],
    environmentMatchGlobs: [
      ['src/client/**', 'jsdom'],
      ['**', 'node']
    ]
  }
} as any);
