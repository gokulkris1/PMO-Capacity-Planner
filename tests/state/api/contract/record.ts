/* eslint-disable security/detect-non-literal-fs-filename -- the output path is a developer-supplied constant/env var */
/**
 * Re-records `http-contract.json` from a live API (run by hand, not by Jest):
 *
 *   CONTRACT_BASE_URL=https://deploy-preview-123--pmocapacityplanner.netlify.app \
 *   CONTRACT_EMAIL=planner@example.com CONTRACT_PASSWORD=… \
 *   npx tsx tests/state/api/contract/record.ts
 *
 * The user must be a Planner (or above) in a workspace with at least one person and one allocation
 * (e.g. after "Install sample data"). The scenario edits one person's target and one allocation.
 */
import { writeFileSync } from 'node:fs';
import { HttpTransport } from '../../../../services/api/httpTransport';
import { runScenario } from './scenario';

export interface Interaction {
  request: { method: string; path: string; body: unknown; csrf: boolean };
  response: { status: number; headers: Record<string, string>; body: unknown };
}

async function main(): Promise<void> {
  const base = process.env.CONTRACT_BASE_URL;
  const email = process.env.CONTRACT_EMAIL;
  const password = process.env.CONTRACT_PASSWORD;
  if (!base || !email || !password) throw new Error('Set CONTRACT_BASE_URL, CONTRACT_EMAIL and CONTRACT_PASSWORD.');
  const jar = new Map<string, string>();
  const interactions: Interaction[] = [];
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const transport = new HttpTransport({
    baseUrl: base,
    getCookies: cookieHeader,
    fetchImpl: async (url, init) => {
      const headers = new Headers(init.headers);
      if (jar.size) headers.set('Cookie', cookieHeader());
      const res = await globalThis.fetch(url, { ...init, headers });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(';');
        const [k, ...rest] = pair.split('=');
        const value = rest.join('=');
        if (value) jar.set(k.trim(), value);
        else jar.delete(k.trim());
      }
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      interactions.push({
        request: {
          method: String(init.method ?? 'GET'),
          path: url.slice(base.length),
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
          csrf: headers.has('X-CSRF-Token'),
        },
        response: {
          status: res.status,
          headers: {
            'content-type': res.headers.get('content-type') ?? '',
            ...(res.headers.get('x-request-id') ? { 'x-request-id': res.headers.get('x-request-id')! } : {}),
          },
          body,
        },
      });
      return new Response(text || null, { status: res.status, headers: res.headers });
    },
  });
  const passed = await runScenario((m, p, b) => transport.request(m, p, b), { email, password });
  const out = process.env.CONTRACT_OUT ?? 'tests/state/api/contract/http-contract.json';
  writeFileSync(
    out,
    JSON.stringify(
      {
        recordedFrom: base,
        recordedAt: new Date().toISOString(),
        credentials: { email, password: '<redacted>' },
        interactions,
      },
      null,
      2,
    ),
  );
  console.log(`Recorded ${interactions.length} interactions (${passed.length} steps) to ${out}`);
}

void main();
