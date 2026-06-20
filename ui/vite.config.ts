import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built output is served by the in-container GUI server from ui/dist. base:'./'
// keeps asset URLs relative so it serves from any path. Dev proxies /api to the
// running server (SSE works over the http proxy; ws stays off).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true, ws: false }
    }
  },
  build: { outDir: 'dist', emptyOutDir: true }
});
