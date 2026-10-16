#!/usr/bin/env node
/**
 * UI design guardrails (DS-06, DS-07). Run: `npm run check:guardrails` (add `-- --all` to include the v1.1
 * files still listed in LEGACY_FILES of eslint.config.js; `-- --json` for machine output).
 *
 * Scans App.tsx, index.html, components/** and pages/** for:
 *   1. emoji (Unicode Extended_Pictographic) anywhere in source or markup            DS-06#AC1, DS-07#AC4
 *   2. hex colour literals (#rgb … #rrggbbaa) in TS/TSX/CSS                             DS-07#AC1
 *   3. inline theme-colour styles: style={{ color | background | backgroundColor |
 *      borderColor | fill | stroke: … }}                                                 DS-07#AC2
 *   4. native dialogs: window.alert/confirm/prompt, bare alert()/prompt(), and bare confirm() in files that do
 *      not define their own `confirm` (useConfirm)                                       DS-03#AC1, DS-07#AC3
 *   5. icon libraries other than lucide-react                                           DS-06#AC2
 * Exempt: styles/** (token definitions), utils/pdfExport.ts (PDF palette), public/** (favicon), docs.
 * Prints file:line and exits 1 on any violation.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- paths come from walking the repository itself */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const includeLegacy = args.has('--all');
const asJson = args.has('--json');

const TARGETS = ['App.tsx', 'index.html', 'components', 'pages'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.html']);
const EXEMPT = [/^styles\//, /^utils\/pdfExport\.ts$/, /^public\//, /^docs\//];

/** LEGACY_FILES from eslint.config.js (plain parse, no plugin loading). */
function legacyPatterns() {
  const cfg = join(ROOT, 'eslint.config.js');
  if (!existsSync(cfg)) return [];
  const src = readFileSync(cfg, 'utf8');
  const m = src.match(/export const LEGACY_FILES\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map(([, p]) =>
    p.endsWith('/**') ? { dir: p.slice(0, -3) + '/' } : { file: p },
  );
}

const legacy = includeLegacy ? [] : legacyPatterns();
const isLegacy = (rel) => legacy.some((l) => (l.file ? l.file === rel : rel.startsWith(l.dir)));

function walk(path, out) {
  if (!existsSync(path)) return out;
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      walk(join(path, name), out);
    }
  } else if (EXTENSIONS.has(extname(path))) out.push(path);
  return out;
}

const files = TARGETS.flatMap((t) => walk(join(ROOT, t), []))
  .map((abs) => ({ abs, rel: relative(ROOT, abs).split(sep).join('/') }))
  .filter(({ rel }) => !EXEMPT.some((re) => re.test(rel)) && !isLegacy(rel));

const EMOJI = /\p{Extended_Pictographic}/u;
const HEX = /(^|[^&\w])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const INLINE_COLOUR = /style=\{\{[^}]*\b(color|background|backgroundColor|borderColor|fill|stroke)\s*:/;
const WINDOW_DIALOG = /\bwindow\.(alert|confirm|prompt)\s*\(/;
const BARE_ALERT = /(^|[^.\w$])(alert|prompt)\s*\(/;
const BARE_CONFIRM = /(^|[^.\w$])confirm\s*\(/;
const DEFINES_CONFIRM = /\b(const|let|var|function)\s+confirm\b|\bconfirm\s*[,}]\s*=|useConfirm\s*\(/;
const ICON_LIBS =
  /from\s+['"](react-icons[^'"]*|@heroicons\/[^'"]+|@mui\/icons-material[^'"]*|react-feather|@fortawesome\/[^'"]+|phosphor-react|@phosphor-icons\/[^'"]+|@tabler\/icons[^'"]*|@radix-ui\/react-icons|react-bootstrap-icons|@ant-design\/icons)['"]/;

/** Strips line and block comments while keeping line structure (comments may cite characters). */
function stripComments(text, ext) {
  if (ext === '.html') return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  if (ext !== '.css') out = out.replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
  return out;
}

const violations = [];
const report = (rel, line, rule, text) => violations.push({ file: rel, line, rule, text: text.trim().slice(0, 140) });

for (const { abs, rel } of files) {
  const ext = extname(abs);
  const raw = readFileSync(abs, 'utf8');
  const code = stripComments(raw, ext);
  const lines = code.split('\n');
  const rawLines = raw.split('\n');
  const definesConfirm = DEFINES_CONFIRM.test(code);
  lines.forEach((line, i) => {
    const n = i + 1;
    // Emoji are checked on the raw line: an emoji in a comment still ships in source maps and reviews.
    if (EMOJI.test(rawLines[i])) report(rel, n, 'emoji', rawLines[i]);
    if (ext === '.html') return;
    if (HEX.test(line)) report(rel, n, 'hex-colour', line);
    if (ext === '.css') return;
    if (INLINE_COLOUR.test(line)) report(rel, n, 'inline-colour-style', line);
    if (WINDOW_DIALOG.test(line) || BARE_ALERT.test(line) || (!definesConfirm && BARE_CONFIRM.test(line)))
      report(rel, n, 'native-dialog', line);
    if (ICON_LIBS.test(line)) report(rel, n, 'icon-library', line);
  });
}

const RULE_TEXT = {
  emoji: 'Emoji are not allowed in the UI; use a lucide-react icon (DESIGN_SYSTEM §10).',
  'hex-colour': 'Use a design token (var(--…)) instead of a hex colour.',
  'inline-colour-style': 'Theme colours belong in CSS classes, not inline styles.',
  'native-dialog': 'Use ConfirmDialog/useConfirm, Dialog, Toast or Banner instead of alert/confirm/prompt.',
  'icon-library': 'Icons come from lucide-react only.',
};

if (asJson) {
  console.log(JSON.stringify({ checked: files.length, violations }, null, 2));
} else if (violations.length) {
  for (const v of violations) console.log(`${v.file}:${v.line}  ${v.rule}  ${RULE_TEXT[v.rule]}\n    ${v.text}`);
  console.log(`\n✖ ${violations.length} UI guardrail violation(s) in ${files.length} files checked.`);
} else {
  console.log(
    `✔ UI guardrails: ${files.length} files clean (emoji, hex colours, inline colour styles, native dialogs, icon libraries)` +
      (includeLegacy ? '.' : `; ${legacy.length} LEGACY_FILES entries skipped (use --all to include them).`),
  );
}
process.exitCode = violations.length ? 1 : 0;
