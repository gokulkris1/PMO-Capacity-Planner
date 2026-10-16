import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

/** Vendor chunks (SH-08#AC3): Recharts and the PDF stack load only with the pages that use them. */
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (/node_modules\/(recharts|d3-[^/]+|victory-vendor|decimal\.js-light|internmap|es-toolkit|immer|reselect|@reduxjs|react-redux|redux)\//.test(id)) {
    return 'vendor-charts';
  }
  if (/node_modules\/(jspdf|jspdf-autotable|html2canvas|canvg|dompurify|fflate|core-js|raf|rgbcolor|stackblur-canvas|svg-pathdata)\//.test(id)) {
    return 'vendor-pdf';
  }
  if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run|cookie|set-cookie-parser)\//.test(id)) {
    return 'vendor-react';
  }
  if (/node_modules\/lucide-react\//.test(id)) return 'vendor-icons';
  if (/node_modules\/@tanstack\//.test(id)) return 'vendor-table';
  return undefined;
}

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    // `npm run dev` (netlify dev) serves functions itself; this proxy is for `npm run dev:vite` against a local API.
    proxy: { '/api': { target: 'http://localhost:8888', changeOrigin: true } },
  },
  plugins: [react()],
  define: {
    // SH-10: version shown in Help › What's new. No secrets are ever defined here (HS-15).
    // package.json stays 0.0.0 until I sets 2.0.0 (SH-10#AC3); this codebase is Release 2.0.
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(
      process.env.VITE_APP_VERSION ?? (pkg.version === '0.0.0' ? '2.0.0' : pkg.version),
    ),
  },
  resolve: {
    alias: { '@': root },
  },
  build: {
    // SH-08: manifest for scripts/check-bundle-size.mjs (A) and per-route chunks.
    manifest: true,
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: { manualChunks },
    },
  },
});
