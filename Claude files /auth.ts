/**
 * netlify/functions/auth.ts
 *
 * Changes from original:
 *  - /invite now inserts into workspace_members instead of setting role on users
 *  - /invite accepts workspaceId + workspaceRole in body
 *  - /remove-member removes from workspace_members (not deleting user)
 *  - Login/register flows unchanged except role values updated to new names
 */
import { Handler } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const sql = neon(process.env.DATABASE_URL!);

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
};

function ok(body: unknown, status = 200) {
    return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}
function fail(msg: string, status = 400) {
    return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) };
}

function makeToken(user: { id: string; email: string; role: string }) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET!,
        { expiresIn: '7d' },
    );
}

function verifyToken(authHeader: string | undefined) {
    if (!authHeader?.startsWith('Bearer ')) throw new Error('No token');
    return jwt.verify(authHeader.slice(7), process.env.JWT_SECRET!) as {
        id: string;
        email: string;
        role: string;
    };
}

// ── handler ──────────────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
    if (event.httpMethod !== 'POST') return fail('Method not allowed', 405);

    const path   = event.path.replace('/.netlify/functions/auth', '');
    let body: any = {};
    try { body = JSON.parse(event.body || '{}'); } catch { return fail('Invalid JSON'); }

    // ── /login ────────────────────────────────────────────────────────────────
    if (path === '/login' || path === '') {
        const { email, password } = body;
        if (!email || !password) return fail('Email and password required');

        const [user] = await sql`SELECT * FROM users WHERE email = ${email.toLowerCase()}`;
        if (!user) return fail('Invalid credentials', 401);

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return fail('Invalid credentials', 401);

        const token = makeToken(user);
        return ok({
            token,
            user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan },
        });
    }

    // ── /register ─────────────────────────────────────────────────────────────
    if (path === '/register') {
        const { email, password, name, orgId } = body;
        if (!email || !password) return fail('Email and password required');

        const [existing] = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
        if (existing) return fail('Email already registered', 409);

        const hash = await bcrypt.hash(password, 10);
        const [user] = await sql`
            INSERT INTO users (email, password_hash, name, role, plan, org_id)
            VALUES (${email.toLowerCase()}, ${hash}, ${name || null}, 'MEMBER', 'BASIC', ${orgId || null})
            RETURNING id, email, name, role, plan
        `;

        const token = makeToken(user);
        return ok({ token, user });
    }

    // ── /invite ───────────────────────────────────────────────────────────────
    // Invite an existing user (by email) to a workspace with a role.
    // Org Admin or Superuser only.
    if (path === '/invite') {
        let caller: ReturnType<typeof verifyToken>;
        try { caller = verifyToken(event.headers['authorization']); }
        catch { return fail('Unauthorized', 401); }

        if (caller.role !== 'SUPERUSER' && caller.role !== 'ORG_ADMIN') {
            return fail('Forbidden — Org Admin role required', 403);
        }

        const { email, workspaceId, workspaceRole = 'USER' } = body;
        if (!email || !workspaceId) return fail('email and workspaceId are required');
        if (!['WORKSPACE_ADMIN', 'USER'].includes(workspaceRole)) {
            return fail('workspaceRole must be WORKSPACE_ADMIN or USER');
        }

        // Look up the invited user
        const [invitee] = await sql`SELECT id, org_id FROM users WHERE email = ${email.toLowerCase()}`;
        if (!invitee) return fail('User not found — they must register first', 404);

        // Verify the workspace exists and belongs to a valid org
        const [workspace] = await sql`
            SELECT w.id, w.org_id FROM workspaces w WHERE w.id = ${workspaceId}
        `;
        if (!workspace) return fail('Workspace not found', 404);

        // ORG_ADMIN can only invite within their own org
        if (caller.role === 'ORG_ADMIN') {
            const [callerUser] = await sql`SELECT org_id FROM users WHERE id = ${caller.id}`;
            if (callerUser?.org_id !== workspace.org_id) {
                return fail('Forbidden — you can only invite to workspaces in your org', 403);
            }
        }

        // Upsert workspace_members (allow role upgrades/downgrades)
        await sql`
            INSERT INTO workspace_members (user_id, workspace_id, org_id, role, invited_by)
            VALUES (${invitee.id}, ${workspaceId}, ${workspace.org_id}, ${workspaceRole}, ${caller.id})
            ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = ${workspaceRole}
        `;

        // Also ensure the invitee's org_id is set if not already
        await sql`
            UPDATE users SET org_id = ${workspace.org_id}
            WHERE id = ${invitee.id} AND org_id IS NULL
        `;

        return ok({ success: true, message: `${email} added to workspace as ${workspaceRole}` });
    }

    // ── /remove-member ────────────────────────────────────────────────────────
    // Remove a user from a workspace (not from the platform).
    if (path === '/remove-member') {
        let caller: ReturnType<typeof verifyToken>;
        try { caller = verifyToken(event.headers['authorization']); }
        catch { return fail('Unauthorized', 401); }

        if (caller.role !== 'SUPERUSER' && caller.role !== 'ORG_ADMIN') {
            return fail('Forbidden — Org Admin role required', 403);
        }

        const { userId, workspaceId } = body;
        if (!userId || !workspaceId) return fail('userId and workspaceId are required');

        // Prevent self-removal
        if (userId === caller.id) return fail('You cannot remove yourself from a workspace');

        await sql`
            DELETE FROM workspace_members
            WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
        `;

        return ok({ success: true });
    }

    // ── /me ───────────────────────────────────────────────────────────────────
    if (path === '/me') {
        let caller: ReturnType<typeof verifyToken>;
        try { caller = verifyToken(event.headers['authorization']); }
        catch { return fail('Unauthorized', 401); }

        const [user] = await sql`
            SELECT id, email, name, role, plan FROM users WHERE id = ${caller.id}
        `;
        if (!user) return fail('User not found', 404);
        return ok({ user });
    }

    return fail('Not found', 404);
};
