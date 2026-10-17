/** Outbound HTTP is always mocked in backend tests. */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    type: 'basic',
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

export function installFetch(): jest.Mock {
  const mock = jest.fn(async () => {
    throw new Error('unexpected fetch');
  });
  (globalThis as { fetch: unknown }).fetch = mock;
  return mock;
}
