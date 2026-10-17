/**
 * HS-16#AC2: a destructive script (TRUNCATE/DROP/DELETE without WHERE) must call `assertDestructiveAllowed(url)`
 * before it connects. It exits 1 unless ALLOW_DESTRUCTIVE=yes, and always when the URL points at PROD_DB_HOST.
 */
export function assertDestructiveAllowed(url: string, env: Record<string, string | undefined> = process.env): void {
  if (env.ALLOW_DESTRUCTIVE !== 'yes') {
    console.error('Refusing to run: set ALLOW_DESTRUCTIVE=yes to run a destructive script.');
    process.exit(1);
  }
  if (!url) {
    console.error('Refusing to run: no database URL.');
    process.exit(1);
  }
  const prod = (env.PROD_DB_HOST || '').trim().toLowerCase();
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    console.error('Refusing to run: the database URL cannot be parsed.');
    process.exit(1);
  }
  if (!prod) {
    console.error('Refusing to run: set PROD_DB_HOST to the production database host so it can be excluded.');
    process.exit(1);
  }
  if (host === prod || host.endsWith(`.${prod}`) || url.toLowerCase().includes(prod)) {
    console.error(`Refusing to run against the production database host (${prod}).`);
    process.exit(1);
  }
}
