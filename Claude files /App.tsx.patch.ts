/**
 * App.tsx — PATCH GUIDE
 * =====================
 * This file shows only the parts of App.tsx you need to change.
 * Look for // ── CHANGE: comments to find the exact lines to update.
 *
 * You do NOT need to replace the whole file — just apply these changes.
 */

// ── CHANGE 1: Import workspaceRole helpers from AuthContext ──────────────────
// Add to your existing AuthContext import:
//   import { useAuth, canWrite } from './context/AuthContext';
// Remove any direct references to user.role === 'USER' or user.role === 'ADMIN'


// ── CHANGE 2: Pull workspaceRole + switchWorkspace from useAuth ──────────────
// Inside your App component, update the useAuth destructure:
/*
const {
    user,
    token,
    workspaceRole,          // ← ADD
    activeWorkspace,        // ← ADD
    availableWorkspaces,    // ← ADD
    setAvailableWorkspaces, // ← ADD
    switchWorkspace,        // ← ADD
    setWorkspaceRole,
    login,
    logout,
} = useAuth();
*/


// ── CHANGE 3: Load available workspaces after login ──────────────────────────
// After a successful login (or on mount when token exists), fetch workspaces:
/*
useEffect(() => {
    if (!token) return;

    fetch('/.netlify/functions/my_workspaces', {
        headers: { Authorization: `Bearer ${token}` },
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.workspaces) {
                setAvailableWorkspaces(data.workspaces); // sets activeWorkspace + workspaceRole too
            }
        })
        .catch(console.error);
}, [token, setAvailableWorkspaces]);
*/


// ── CHANGE 4: Pass workspaceId when loading workspace data ──────────────────
// Update your workspace fetch to include the active workspace id:
/*
useEffect(() => {
    if (!token || !activeWorkspace) return;

    const url = `/.netlify/functions/workspace?orgSlug=${activeWorkspace.orgSlug}&workspaceId=${activeWorkspace.id}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((data) => {
            setResources(data.resources ?? []);
            setProjects(data.projects ?? []);
            setAllocations(data.allocations ?? []);
            // workspaceRole is already set via setAvailableWorkspaces above
        });
}, [token, activeWorkspace]);
*/


// ── CHANGE 5: Update authGate ─────────────────────────────────────────────────
// Replace your current authGate with this version:
/*
const authGate = useCallback(
    (action: () => void, requireWrite = false) => {
        if (!user) {
            setShowLogin(true);
            return;
        }

        if (requireWrite) {
            const allowed =
                user.role === 'SUPERUSER' ||
                user.role === 'ORG_ADMIN' ||
                workspaceRole === 'WORKSPACE_ADMIN';

            if (!allowed) {
                alert('You need Workspace Admin permissions for this action.');
                return;
            }
        }

        action();
    },
    [user, workspaceRole],
);
*/


// ── CHANGE 6: Add WorkspaceSwitcher to sidebar ────────────────────────────────
// In your sidebar JSX, replace the static workspace name display with:
/*
import WorkspaceSwitcher from './components/WorkspaceSwitcher';

// Inside sidebar JSX (where you previously showed workspaceName):
<WorkspaceSwitcher />
*/


// ── CHANGE 7: Pass workspaceId to save function ───────────────────────────────
// Update your save/POST call to include workspaceId:
/*
const saveWorkspace = useCallback(async () => {
    if (!token || !activeWorkspace) return;

    await fetch('/.netlify/functions/workspace', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            workspaceId: activeWorkspace.id,  // ← ADD THIS
            resources,
            projects,
            allocations,
        }),
    });
}, [token, activeWorkspace, resources, projects, allocations]);
*/
