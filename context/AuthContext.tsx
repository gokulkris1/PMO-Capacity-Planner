import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types — 5-tier RBAC hierarchy
// ---------------------------------------------------------------------------

/** Platform-level role stored on the users table */
export type PlatformRole = 'SUPERUSER' | 'ORG_ADMIN' | 'PMO_ADMIN' | 'WORKSPACE_OWNER' | 'USER';

/** Workspace-scoped role stored in workspace_members */
export type WorkspaceRole = 'PMO_ADMIN' | 'WORKSPACE_OWNER' | 'USER';

export interface User {
    id: string;
    email: string;
    name?: string;
    role: PlatformRole;
    plan?: 'BASIC' | 'PRO' | 'MAX';
    orgId?: string;
    orgSlug?: string;
}

export interface WorkspaceInfo {
    id: string;
    name: string;
    org_id: string;
    org_name: string;
    org_slug: string;
    role: WorkspaceRole;
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface AuthContextType {
    user: User | null;
    token: string | null;
    /** Role the current user holds in the *active* workspace */
    workspaceRole: WorkspaceRole | null;
    /** All workspaces this user is a member of */
    availableWorkspaces: WorkspaceInfo[];
    /** The currently active workspace */
    activeWorkspace: WorkspaceInfo | null;

    login: (token: string, user: User) => void;
    logout: () => void;
    /** Switch to a different workspace by id */
    switchWorkspace: (workspaceId: string) => void;
    /** Called after workspace data loads to set the scoped role */
    setWorkspaceRole: (role: WorkspaceRole | null) => void;
    /** Called after fetching available workspaces */
    setAvailableWorkspaces: (workspaces: WorkspaceInfo[]) => void;

    isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [workspaceRole, setWorkspaceRoleState] = useState<WorkspaceRole | null>(null);
    const [availableWorkspaces, setAvailableWorkspacesState] = useState<WorkspaceInfo[]>([]);
    const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Rehydrate from localStorage
    useEffect(() => {
        const storedToken = localStorage.getItem('pcp_token');
        const storedUser = localStorage.getItem('pcp_user');
        if (storedToken && storedUser) {
            try {
                setToken(storedToken);
                setUser(JSON.parse(storedUser));
            } catch { console.error('Failed to parse stored user'); }
        }
        setIsLoading(false);
    }, []);

    // Persist active workspace
    useEffect(() => {
        if (activeWorkspace) {
            localStorage.setItem('pcp_active_workspace', JSON.stringify(activeWorkspace));
        }
    }, [activeWorkspace]);

    const login = useCallback((newToken: string, newUser: User) => {
        setToken(newToken);
        setUser(newUser);
        localStorage.setItem('pcp_token', newToken);
        localStorage.setItem('pcp_user', JSON.stringify(newUser));
    }, []);

    const logout = useCallback(() => {
        setToken(null);
        setUser(null);
        setWorkspaceRoleState(null);
        setAvailableWorkspacesState([]);
        setActiveWorkspace(null);
        localStorage.removeItem('pcp_token');
        localStorage.removeItem('pcp_user');
        localStorage.removeItem('pcp_resources');
        localStorage.removeItem('pcp_projects');
        localStorage.removeItem('pcp_allocations');
        localStorage.removeItem('pcp_active_workspace');
    }, []);

    const setWorkspaceRole = useCallback((role: WorkspaceRole | null) => {
        setWorkspaceRoleState(role);
    }, []);

    const setAvailableWorkspaces = useCallback((workspaces: WorkspaceInfo[]) => {
        setAvailableWorkspacesState(workspaces);

        // Try to restore previously active workspace
        const stored = localStorage.getItem('pcp_active_workspace');
        if (stored) {
            try {
                const prev = JSON.parse(stored) as WorkspaceInfo;
                const match = workspaces.find(w => w.id === prev.id);
                if (match) {
                    setActiveWorkspace(match);
                    setWorkspaceRoleState(match.role);
                    return;
                }
            } catch { /* ignore */ }
        }

        // Default to first workspace
        if (workspaces.length > 0) {
            setActiveWorkspace(workspaces[0]);
            setWorkspaceRoleState(workspaces[0].role);
        }
    }, []);

    const switchWorkspace = useCallback((workspaceId: string) => {
        const ws = availableWorkspaces.find(w => w.id === workspaceId);
        if (ws) {
            setActiveWorkspace(ws);
            setWorkspaceRoleState(ws.role);
            localStorage.setItem('pcp_active_workspace', JSON.stringify(ws));
        }
    }, [availableWorkspaces]);

    return (
        <AuthContext.Provider value={{
            user, token, workspaceRole, availableWorkspaces, activeWorkspace,
            login, logout, switchWorkspace, setWorkspaceRole, setAvailableWorkspaces,
            isLoading,
        }}>
            {children}
        </AuthContext.Provider>
    );
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
};

// ---------------------------------------------------------------------------
// Permission helpers — 5-tier RBAC
// ---------------------------------------------------------------------------

/** Can this user write (add/edit/delete resources, projects, allocations)? */
export function canWrite(user: User | null, workspaceRole: WorkspaceRole | null): boolean {
    if (!user) return false;
    if (['SUPERUSER', 'ORG_ADMIN'].includes(user.role)) return true;
    return workspaceRole === 'PMO_ADMIN' || workspaceRole === 'WORKSPACE_OWNER';
}

/** Can the user manage workspace members (invite/remove)? */
export function canManageMembers(user: User | null): boolean {
    if (!user) return false;
    return ['SUPERUSER', 'ORG_ADMIN', 'PMO_ADMIN'].includes(user.role);
}

/** Can the user create workspaces? */
export function canCreateWorkspace(user: User | null): boolean {
    if (!user) return false;
    return ['SUPERUSER', 'ORG_ADMIN', 'PMO_ADMIN'].includes(user.role);
}

/** Can the user access the admin/settings panel? */
export function canAccessSettings(user: User | null): boolean {
    if (!user) return false;
    return ['SUPERUSER', 'ORG_ADMIN'].includes(user.role);
}

/** Is this user a superuser (tool owner)? */
export function isSuperuser(user: User | null): boolean {
    return user?.role === 'SUPERUSER';
}
