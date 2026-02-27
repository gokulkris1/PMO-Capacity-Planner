# Workspace Hierarchy RBAC — Implementation Guide

## Overview

This implements a **4-level role hierarchy** for the project:

```
SUPERUSER  (platform admin — manages orgs, billing, everything)
  └── ORG_ADMIN  (per org — creates workspaces, invites users)
        └── WORKSPACE_ADMIN  (per workspace — manages resources/projects/allocations)
              └── USER  (per workspace — read-only + own capacity updates)
```

A user can be `WORKSPACE_ADMIN` on Workspace A and `USER` on Workspace B simultaneously, and can switch between them via the sidebar dropdown.

---

## Step 1 — Create the git branch

```bash
git checkout -b feature/workspace-hierarchy
```

---

## Step 2 — Copy files into your project

| File in this folder | Copy to |
|---|---|
| `scripts/migrate_workspace_members.sql` | Run directly in Neon console (once) |
| `context/AuthContext.tsx` | Replace `src/context/AuthContext.tsx` |
| `netlify/functions/workspace.ts` | Replace `netlify/functions/workspace.ts` |
| `netlify/functions/auth.ts` | Replace `netlify/functions/auth.ts` |
| `netlify/functions/my_workspaces.ts` | New file → `netlify/functions/my_workspaces.ts` |
| `components/WorkspaceSwitcher.tsx` | New file → `src/components/WorkspaceSwitcher.tsx` |
| `components/MemberManagement.tsx` | New file → `src/components/MemberManagement.tsx` |
| `App.tsx.patch.ts` | Read this — contains the 7 specific changes to make in App.tsx |

---

## Step 3 — Run the migration

Open your **Neon console → SQL Editor** and paste in `migrate_workspace_members.sql`.

> ⚠️ Run this only once. It is idempotent (`ON CONFLICT DO NOTHING`) so re-running is safe.

What it does:
1. Renames `ADMIN` → `ORG_ADMIN` and `USER` → `MEMBER` on the users table
2. Creates the `workspace_members` junction table
3. Backfills every existing user into `workspace_members` for all workspaces in their org

---

## Step 4 — Apply App.tsx changes

Open `App.tsx.patch.ts` — it lists 7 numbered changes. Apply them one by one.

The key changes:
- Pull `workspaceRole` and `activeWorkspace` from `useAuth()`
- After login, fetch `/.netlify/functions/my_workspaces` and call `setAvailableWorkspaces()`
- Pass `workspaceId` to workspace fetch and save calls
- Update `authGate` to check `workspaceRole === 'WORKSPACE_ADMIN'` instead of `user.role`
- Add `<WorkspaceSwitcher />` in the sidebar

---

## Step 5 — Update SettingsHub

Replace (or wrap) your existing member invite UI with `<MemberManagement initialMembers={members} />`.

The `members` array comes from the workspace GET response — it's included when `workspaceRole === 'WORKSPACE_ADMIN'`.

---

## Step 6 — Test

```bash
# 1. Create two test users
# 2. As ORG_ADMIN, invite user2 to Workspace A as WORKSPACE_ADMIN
# 3. Invite user2 to Workspace B as USER
# 4. Log in as user2 — workspace switcher should show both
# 5. On Workspace A, user2 should be able to add/edit resources
# 6. On Workspace B, user2 should be read-only
```

---

## Step 7 — Commit & push

```bash
git add .
git commit -m "feat: workspace hierarchy RBAC with workspace_members table"
git push origin feature/workspace-hierarchy
```

Then open a PR on GitHub.

---

## Role permission matrix

| Action | SUPERUSER | ORG_ADMIN | WORKSPACE_ADMIN | USER |
|---|---|---|---|---|
| Manage orgs | ✅ | ❌ | ❌ | ❌ |
| Create workspaces | ✅ | ✅ | ❌ | ❌ |
| Invite to workspace | ✅ | ✅ | ❌ | ❌ |
| Remove from workspace | ✅ | ✅ | ❌ | ❌ |
| Add/edit resources | ✅ | ✅ | ✅ | ❌ |
| Add/edit projects | ✅ | ✅ | ✅ | ❌ |
| Edit allocations | ✅ | ✅ | ✅ | ❌ |
| View dashboard | ✅ | ✅ | ✅ | ✅ |
| Update own capacity | ✅ | ✅ | ✅ | ✅ |
| Switch workspaces | ✅ | ✅ | ✅ | ✅ |
