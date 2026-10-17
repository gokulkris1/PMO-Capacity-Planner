/**
 * DEPRECATED /api/jira (PL-09#AC1): took Jira credentials in the request body. Replaced by workspace-scoped,
 * encrypted credentials (/api/integrations/*) and the v2 sync. Kept as a 410 for this release only.
 */
import { withApi } from './_lib/api';
import { gone } from './_lib/errors';

export const handler = withApi({ fn: 'jira', auth: 'none', schemaCheck: false, csrf: false }, async () => {
  throw gone('Moved to /api/v2/workspaces/:wsId/sync/jira');
});
