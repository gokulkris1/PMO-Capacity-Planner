/* eslint-disable security/detect-non-literal-fs-filename -- paths are built from the repository tree, not user input */
/**
 * PL-06#AC6 / §1.5: the domain core and view-models import nothing from React, the DOM, Node
 * built-ins, Netlify/Neon, the client state or the API layer — including everything they import
 * transitively. (A's `scripts/check-pure.mjs` runs the same rule in CI.)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const ENTRY_POINTS = [
  'utils/craftEngine.ts',
  'utils/quarters.ts',
  'utils/clock.ts',
  'utils/csv.ts',
  'utils/csvPeople.ts',
  'utils/search.ts',
  'utils/reports.ts',
  'utils/qbrPack.ts',
  ...readdirSync(join(ROOT, 'utils/viewModels')).map((f) => `utils/viewModels/${f}`),
  ...readdirSync(join(ROOT, 'shared'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `shared/${f}`),
  ...readdirSync(join(ROOT, 'shared/contracts')).map((f) => `shared/contracts/${f}`),
];

const FORBIDDEN_IMPORT =
  /^(react|react-dom|jspdf|jspdf-autotable|papaparse|@netlify\/|@neondatabase\/|node:|fs$|path$|crypto$|http$|https$|os$|child_process$)/;
const FORBIDDEN_LOCAL = /(^|\/)(state|services|components|pages|context)\//;
const FORBIDDEN_GLOBAL =
  /\b(window|document|localStorage|sessionStorage|navigator)\s*\.|\bfetch\s*\(|\bXMLHttpRequest\b/;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function importsOf(src: string): string[] {
  const out: string[] = [];
  const re =
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of src.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(join(ROOT, from)), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return relative(ROOT, candidate);
  }
  return null;
}

describe('pure domain core (PL-06#AC6)', () => {
  const seen = new Map<string, string[]>();
  const queue = [...ENTRY_POINTS];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file) || file.endsWith('.d.ts')) continue;
    const src = readFileSync(join(ROOT, file), 'utf8');
    const problems: string[] = [];
    for (const spec of importsOf(src)) {
      if (spec.startsWith('.')) {
        const target = resolveLocal(file, spec);
        if (!target) problems.push(`unresolved import ${spec}`);
        else if (FORBIDDEN_LOCAL.test(target)) problems.push(`imports ${target}`);
        else queue.push(target);
      } else if (FORBIDDEN_IMPORT.test(spec)) {
        problems.push(`imports ${spec}`);
      }
    }
    const code = stripComments(src);
    const g = FORBIDDEN_GLOBAL.exec(code);
    if (g) problems.push(`uses ${g[0].trim()}`);
    seen.set(file, problems);
  }

  it('reaches the expected modules', () => {
    expect([...seen.keys()]).toEqual(
      expect.arrayContaining(['utils/viewModels/index.ts', 'constants.ts', 'types.ts', 'shared/contracts/dto.ts']),
    );
  });

  it.each([...ENTRY_POINTS])('%s and its imports are pure', (entry) => {
    const offenders = [...seen.entries()].filter(([, p]) => p.length > 0).map(([f, p]) => `${f}: ${p.join(', ')}`);
    expect({ entry, offenders }).toEqual({ entry, offenders: [] });
  });

  it('only services/api/httpTransport.ts calls fetch( in client code (PL-05#AC1)', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${name.name}`;
        if (name.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(name.name) && /\bfetch\s*\(/.test(stripComments(readFileSync(join(ROOT, rel), 'utf8'))))
          offenders.push(rel);
      }
    };
    ['state', 'services', 'utils', 'shared'].forEach(walk);
    expect(offenders).toEqual(['services/api/httpTransport.ts']);
  });

  it('no client module reads VITE_OPENAI_API_KEY (HS-15#AC1)', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${name.name}`;
        if (name.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(name.name) && readFileSync(join(ROOT, rel), 'utf8').includes('VITE_OPENAI_API_KEY'))
          offenders.push(rel);
      }
    };
    ['state', 'services', 'utils'].forEach(walk);
    expect(offenders).toEqual([]);
  });
});
