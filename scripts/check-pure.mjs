#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename -- CI script reading paths inside the repository */
/**
 * PL-06#AC6: domain modules stay pure so they can run in the browser, in functions and later in Forge.
 * Checks the files below and everything they import relatively: no react / react-dom, no Node built-ins,
 * no @netlify/* or @neondatabase/*, and no DOM globals (window, document, localStorage, sessionStorage, navigator).
 */
import { builtinModules } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const ROOTS = [
  'utils/craftEngine.ts',
  'utils/quarters.ts',
  'utils/viewModels',
  'shared',
  'netlify/functions/_lib/jira/aggregate.ts',
  'netlify/functions/_lib/jira/fields.ts',
];
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const BANNED_PREFIX = ['react', 'react-dom', '@netlify/', '@neondatabase/'];
const DOM_GLOBALS = /(?<![.\w$])(window|document|localStorage|sessionStorage|navigator)\s*[.[(]/;

function* expand(p) {
  if (!existsSync(p)) return;
  if (statSync(p).isDirectory()) {
    for (const name of readdirSync(p)) yield* expand(join(p, name));
  } else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) yield normalize(p);
}

function resolveRelative(from, spec) {
  const base = join(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(c) && statSync(c).isFile()) return normalize(c);
  }
  return null;
}

/** Strips comments and string/template contents so globals in docs or messages don't count. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""');
}

const queue = ROOTS.flatMap((r) => [...expand(r)]);
const seen = new Set();
const problems = [];
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec.startsWith('.')) {
      const target = resolveRelative(file, spec);
      if (target) queue.push(target);
      else problems.push(`${file}: cannot resolve ${spec}`);
      continue;
    }
    const bare = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (BUILTINS.has(spec) || BUILTINS.has(bare)) problems.push(`${file}: imports Node built-in "${spec}"`);
    else if (BANNED_PREFIX.some((p) => spec === p || spec.startsWith(p.endsWith('/') ? p : `${p}/`))) {
      problems.push(`${file}: imports "${spec}"`);
    }
  }
  const lines = codeOnly(src).split('\n');
  lines.forEach((line, i) => {
    const g = line.match(DOM_GLOBALS);
    if (g) problems.push(`${file}:${i + 1}: uses DOM global "${g[1]}"`);
  });
}

if (problems.length) {
  console.error('check-pure: impure imports in domain modules:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-pure: ${seen.size} files clean.`);
