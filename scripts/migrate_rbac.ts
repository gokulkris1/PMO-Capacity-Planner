/**
 * Retired entrypoint.
 *
 * This migration previously reduced the authorization model to ADMIN/USER.
 * Use migrate_v2_rbac.mjs only after reviewing its non-destructive SQL and
 * creating an approved database restore point.
 */
throw new Error('scripts/migrate_rbac.ts is retired. Use scripts/migrate_v2_rbac.mjs after review.');
