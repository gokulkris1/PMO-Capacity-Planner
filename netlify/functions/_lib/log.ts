/**
 * Structured JSON logs (PL-13#AC2). Never log emails, request bodies, tokens or secrets: only ids.
 * `LOG_LEVEL=silent` mutes output (tests).
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const l = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (l === 'silent') return 100;
  return ORDER[l as Level] ?? ORDER.info;
}

export function log(level: Level, fields: Record<string, unknown>): void {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function errorFields(err: unknown): { message: string; stack?: string; name?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack, name: err.name };
  return { message: String(err) };
}
