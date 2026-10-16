#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename -- CI script reading paths inside the repository */
/**
 * HS-15#AC2: fail when the browser build contains anything that looks like a server key.
 * Patterns: OpenAI (sk-…), Neon passwords (npg_…), Stripe webhook/live secrets, PEM private keys.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = process.argv[2] || 'dist';
const PATTERNS = [
  ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ['Neon password', /\bnpg_[A-Za-z0-9]{8,}/],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{8,}/],
  ['Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{8,}/],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Database URL with password', /postgres(?:ql)?:\/\/[^:\s"']+:[^@\s"']+@/],
];

if (!existsSync(DIST)) {
  console.error(`check-dist-secrets: ${DIST}/ not found. Run \`npm run build\` first.`);
  process.exit(1);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const hits = [];
for (const file of walk(DIST)) {
  if (!/\.(js|mjs|css|html|json|map|txt|svg)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const [label, re] of PATTERNS) {
    const m = text.match(re);
    if (m) hits.push(`${file}: ${label} (${m[0].slice(0, 8)}…)`);
  }
}

if (hits.length) {
  console.error('check-dist-secrets: possible secrets in the browser build:');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`check-dist-secrets: ${DIST}/ is clean.`);
