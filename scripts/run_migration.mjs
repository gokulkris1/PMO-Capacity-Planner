throw new Error(
    'scripts/run_migration.mjs is retired because it targeted an incompatible RBAC migration. ' +
    'Review and run scripts/migrate_v2_rbac.mjs only after creating an approved database restore point.'
);
