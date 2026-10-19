import { chromium } from '@playwright/test';
import os from 'os';
export const EXE = os.homedir() + '/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
export const BASE = 'http://localhost:4174';
export const WS = '/o/acme-bank/w/a1000000-0000-4000-8000-0000000000a1/';
export const OUT = '/private/tmp/claude-501/e2e/agentC/';
export const USERS = {
  noma: ['Noma.Odigie@acme.example', 'noma-secret-77'],
  mel: ['mel.member@acme.example', 'Member-Mel-42'],
  victor: ['victor.lee@acme.example', 'Viewer!Pass9'],
  owen: ['owen.owner@acme.example', 'Owen-Owner-2025'],
  pat: ['pat.pmo@acme.example', 'Pat-PMO-Admin-1'],
};
export async function launch() { return chromium.launch({ executablePath: EXE, headless: true }); }
export async function ctxFor(browser, who, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, acceptDownloads: true, ...(opts.mobile ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  const log = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[${who}] console.${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => log.push(`[${who}] pageerror: ${e.message.slice(0, 300)}`));
  page.on('response', async (r) => { if (r.status() >= 400) { let b = ''; try { b = (await r.text()).slice(0, 200); } catch {} log.push(`[${who}] HTTP ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')} ${b}`); } });
  page._log = log;
  return { ctx, page, log };
}
export async function login(page, who) {
  const [e, p] = USERS[who];
  await page.goto(BASE + '/login');
  await page.getByLabel('Email', { exact: true }).fill(e);
  await page.getByLabel('Password', { exact: true }).fill(p);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}
export async function shot(page, name) { await page.screenshot({ path: OUT + name + '.png', fullPage: false }); }
export function flush(log) { for (const l of log.splice(0)) console.log('   LOG ' + l); }
const b = await launch();
for (const who of ['noma','mel','victor','owen','pat']) {
  const { ctx, page, log } = await ctxFor(b, who);
  const urls = new Set();
  page.on('response', async r => { const u = r.url(); if (u.includes('/api/')) urls.add(r.request().method()+' '+u.replace(BASE,'').split('?')[0]);
    if (/\/me(\?|$)/.test(u) || u.endsWith('/workspaces')) { try { const j = await r.json(); console.log(`  [${who}] ${u.replace(BASE,'')}:`, JSON.stringify({ws:j.workspace??j.workspaces, perms:j.permissions, w2: Object.keys(j)})); } catch {} } });
  await login(page, who); await page.waitForTimeout(1500);
  if (who==='noma') console.log('  urls', [...urls].join('\n   '));
  flush(log); await ctx.close();
}
await b.close();
