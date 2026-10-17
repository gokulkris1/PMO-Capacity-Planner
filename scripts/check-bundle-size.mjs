#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename -- CI script reading paths inside the repository */
/**
 * SH-08#AC1 / PL-08: the JS loaded for /o/:org/w/:ws/home (entry chunk + its static imports + the Home page chunk
 * and its static imports) must be ≤ 350 KB gzip.
 *
 * Input: dist/.vite/manifest.json (vite `build.manifest: true`). Without a manifest it falls back to the scripts
 * and modulepreload links in dist/index.html (entry closure only) and says so.
 *
 * Usage: node scripts/check-bundle-size.mjs [--budget-kb 350] [--route pages/Home]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DIST = 'dist';
const BUDGET_KB = Number(arg('--budget-kb', '350'));
const ROUTE = arg('--route', 'pages/Home');

if (!existsSync(DIST)) {
  console.error('check-bundle-size: dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

const gz = (file) => gzipSync(readFileSync(join(DIST, file))).length;
const files = new Set();
let mode;

const manifestPath = join(DIST, '.vite', 'manifest.json');
if (existsSync(manifestPath)) {
  mode = 'manifest';
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const visit = (key) => {
    const chunk = manifest[key];
    if (!chunk || files.has(chunk.file)) return;
    if (chunk.file.endsWith('.js')) files.add(chunk.file);
    for (const dep of chunk.imports ?? []) visit(dep);
  };
  const entries = Object.keys(manifest).filter((k) => manifest[k].isEntry);
  if (!entries.length) {
    console.error('check-bundle-size: manifest has no entry chunk.');
    process.exit(1);
  }
  entries.forEach(visit);
  const routeKey = Object.keys(manifest).find((k) => k.toLowerCase().includes(ROUTE.toLowerCase()));
  if (routeKey) visit(routeKey);
  else console.warn(`check-bundle-size: no chunk matching "${ROUTE}"; measuring the entry closure only.`);
} else {
  mode = 'index.html';
  console.warn(
    'check-bundle-size: dist/.vite/manifest.json missing (set build.manifest: true); using dist/index.html.',
  );
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="\/?([^"]+\.js)"/g)) files.add(m[1]);
}

let total = 0;
const rows = [...files].map((f) => {
  const size = gz(f);
  total += size;
  return [f, size];
});
rows.sort((a, b) => b[1] - a[1]);
for (const [f, size] of rows) console.log(`${(size / 1024).toFixed(1).padStart(8)} KB  ${f}`);
const totalKb = total / 1024;
console.log(`Home JS (${mode}): ${totalKb.toFixed(1)} KB gzip, budget ${BUDGET_KB} KB`);
if (totalKb > BUDGET_KB) {
  console.error(`check-bundle-size: over budget by ${(totalKb - BUDGET_KB).toFixed(1)} KB.`);
  process.exit(1);
}
