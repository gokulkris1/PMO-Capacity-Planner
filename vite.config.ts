import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

/** Vendor chunks (SH-08#AC3): Recharts and the PDF stack load only with the pages that use them. */
function manualChunks(id: string): string | undefined {
  // Vite's preload helper and Rollup's CommonJS helpers are shared by every lazy import. Without this rule Rollup
  // hoists them into whichever vendor chunk asks first (jsPDF's own dynamic imports), which then drags the whole
  // PDF stack into the entry chunk (SH-08).
  if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) return 'runtime';
  if (!id.includes('node_modules')) return undefined;
  if (
    /node_modules\/(recharts|d3-[^/]+|victory-vendor|decimal\.js-light|internmap|es-toolkit|immer|reselect|@reduxjs|react-redux|redux)\//.test(
      id,
    )
  ) {
    return 'vendor-charts';
  }
  if (
    /node_modules\/(jspdf|jspdf-autotable|html2canvas|canvg|dompurify|fflate|core-js|raf|rgbcolor|stackblur-canvas|svg-pathdata)\//.test(
      id,
    )
  ) {
    return 'vendor-pdf';
  }
  if (
    /node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run|cookie|set-cookie-parser)\//.test(
      id,
    )
  ) {
    return 'vendor-react';
  }
  if (/node_modules\/lucide-react\//.test(id)) return 'vendor-icons';
  if (/node_modules\/@tanstack\//.test(id)) return 'vendor-table';
  return undefined;
}

/** The Content-Security-Policy value from netlify.toml's `/*` headers (single source of truth). */
function netlifyCsp(): string {
  const toml = readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  const m = /^\s*Content-Security-Policy(?:-Report-Only)?\s*=\s*"([^"]+)"/m.exec(toml);
  if (!m) throw new Error('netlify.toml: no Content-Security-Policy header');
  return m[1];
}

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    // `npm run dev` (netlify dev) serves functions itself; this proxy is for `npm run dev:vite` against a local API.
    proxy: { '/api': { target: `http://localhost:${process.env.LOCAL_API_PORT ?? 8888}`, changeOrigin: false } },
  },
  // `vite preview` (e2e): same proxy, so a production build can run against the local API host
  // (scripts/local-api.ts). Netlify serves /api/* itself; this block is never used in production.
  // The preview also serves netlify.toml's CSP, ENFORCED (whichever header name netlify.toml uses), so every e2e run
  // proves the production policy breaks nothing: a violation is a console error, which fails the test (HS-12#AC2).
  preview: {
    headers: { 'Content-Security-Policy': netlifyCsp() },
    proxy: { '/api': { target: `http://localhost:${process.env.LOCAL_API_PORT ?? 8888}`, changeOrigin: false } },
  },
  plugins: [react()],
  define: {
    // SH-10: version shown in Help › What's new. No secrets are ever defined here (HS-15).
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.VITE_APP_VERSION ?? pkg.version),
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
