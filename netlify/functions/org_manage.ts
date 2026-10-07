import type { Handler, HandlerEvent } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { Resend } from 'resend';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error("JWT_SECRET missing");
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Orbit Space <noreply@orbitspace.io>';

const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
};

function ok(body: unknown, status = 200) { return { statusCode: status, headers: CORS, body: JSON.stringify(body) }; }
function fail(msg: string, status = 400) { return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) }; }

const getDb = () => neon(
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NEON_DATABASE_URL || ''
);

function generateSlug(name: string) {
    const base = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'organization';
    return `${base}-${randomBytes(3).toString('hex')}`;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[character] || character));
}

type InvitationDelivery = { sent: true } | { sent: false; error: string };

async function sendAdminInvitation(email: string, orgName: string): Promise<InvitationDelivery> {
    if (!RESEND_API_KEY) {
        return { sent: false, error: 'Email delivery is not configured' };
    }
    const loginUrl = process.env.URL || 'https://orbitspace.io';
    const escapedOrgName = escapeHtml(orgName);
    const resend = new Resend(RESEND_API_KEY);
    try {
        const result = await resend.emails.send({
            from: FROM_EMAIL,
            to: email,
            subject: `You've been invited to administer ${orgName} on Orbit Space`,
            html: `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;color:#172b4d">
                <h1 style="font-size:22px;margin:0 0 12px">Welcome to Orbit Space</h1>
                <p>You have been invited to administer <strong>${escapedOrgName}</strong>.</p>
                <p>Use password reset to set your own password before signing in. No password is included in this invitation.</p>
                <p><a href="${loginUrl}" style="display:inline-block;background:#0052cc;color:#fff;padding:12px 16px;border-radius:4px;text-decoration:none;font-weight:700">Set password and sign in</a></p>
            </div>`,
        });
        if (!result || result.error || !result.data) {
            console.error('[org_manage] administrator invitation failed:', result?.error?.message || 'No delivery confirmation returned');
            return { sent: false, error: 'Email delivery failed' };
        }
        return { sent: true };
    } catch (error) {
        console.error('[org_manage] administrator invitation failed:', error instanceof Error ? error.message : 'Unknown error');
        return { sent: false, error: 'Email delivery failed' };
    }
}

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    const authHeader = event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return fail('Unauthorized', 401);

    let userId: string, userRole: string;
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as { id: string; role?: string };
        userId = decoded.id;
        userRole = decoded.role || 'USER';
    } catch { return fail('Invalid token', 401); }

    const sql = getDb();

    try {
        const [currentUser] = await sql`SELECT role, org_id FROM users WHERE id = ${userId}`;
        if (!currentUser) return fail('Unauthorized', 401);
        userRole = currentUser.role === 'ADMIN' ? 'ORG_ADMIN' : currentUser.role || 'USER';

        // ── GET: List all orgs (SUPERUSER only) ──────────────────────
        if (event.httpMethod === 'GET') {
            if (userRole !== 'SUPERUSER') return fail('Forbidden', 403);

            const orgs = await sql`
                SELECT o.id, o.name, o.slug, o.logo_url, o.primary_color, o.created_at,
                    (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id) as user_count,
                    (SELECT COUNT(*)::int FROM users u WHERE u.org_id = o.id AND u.role = 'ORG_ADMIN') as admin_count,
                    (SELECT COUNT(*)::int FROM workspaces w WHERE w.org_id = o.id) as workspace_count,
                    (SELECT COUNT(*)::int FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE w.org_id = o.id) as project_count,
                    (SELECT COUNT(*)::int FROM resources r JOIN workspaces w ON w.id = r.workspace_id WHERE w.org_id = o.id) as resource_count
                FROM organizations o ORDER BY o.created_at DESC
            `;

            // Get admins per org
            const admins = await sql`
                SELECT u.id, u.email, u.name, u.role, u.org_id 
                FROM users u WHERE u.role IN ('ORG_ADMIN', 'ADMIN') ORDER BY u.name
            `;

            // Get workspaces per org
            const workspaces = await sql`
                SELECT w.id, w.name, w.org_id,
                    (SELECT COUNT(*)::int FROM workspace_members wm WHERE wm.workspace_id = w.id) as member_count
                FROM workspaces w ORDER BY w.name
            `;

            return ok({
                orgs: orgs.map(o => ({
                    ...o,
                    admins: admins.filter(a => a.org_id === o.id),
                    workspaces: workspaces.filter(w => w.org_id === o.id),
                }))
            });
        }

        // ── POST: Create a new org ───────────────────────────────────
        // Can be called by SUPERUSER (top-down) or any user without an org (bottom-up)
        if (event.httpMethod === 'POST') {
            const subpath = event.path.replace(/^.*\/api\/org_manage/, '');

            // POST /api/org_manage/:orgId/workspace — create workspace in org
            if (subpath.match(/^\/[^/]+\/workspace$/)) {
                const orgId = subpath.split('/')[1];
                const { name } = JSON.parse(event.body || '{}');
                const workspaceName = typeof name === 'string' ? name.trim() : '';
                if (!workspaceName || workspaceName.length > 120) return fail('A workspace name of up to 120 characters is required');

                // Creating a workspace is organization-level administration.
                if (userRole !== 'SUPERUSER') {
                    const [caller] = await sql`SELECT org_id, role FROM users WHERE id = ${userId}`;
                    if (!caller || caller.org_id !== orgId || !['ORG_ADMIN', 'ADMIN'].includes(caller.role)) {
                        return fail('Forbidden', 403);
                    }
                }

                const [ws] = await sql`
                    INSERT INTO workspaces (id, org_id, name)
                    VALUES (gen_random_uuid(), ${orgId}, ${workspaceName})
                    RETURNING id, name
                `;

                // Add creator as PMO_ADMIN in the new workspace
                await sql`
                    INSERT INTO workspace_members (user_id, workspace_id, org_id, role, invited_by)
                    VALUES (${userId}, ${ws.id}, ${orgId}, 'PMO_ADMIN', ${userId})
                    ON CONFLICT DO NOTHING
                `;

                return ok({ success: true, workspace: ws }, 201);
            }

            // POST /api/org_manage/:orgId/admin/:adminId/workspace — add admin to workspace
            if (subpath.match(/^\/[^/]+\/admin\/[^/]+\/workspace$/)) {
                if (userRole !== 'SUPERUSER') return fail('Forbidden', 403);
                const [, orgId, , adminId] = subpath.split('/');
                const { workspaceId, role } = JSON.parse(event.body || '{}');
                if (!workspaceId) return fail('Workspace ID required');
                if (!['PMO_ADMIN', 'WORKSPACE_OWNER', 'USER'].includes(role || 'PMO_ADMIN')) return fail('Invalid workspace role');

                const [workspace] = await sql`SELECT org_id FROM workspaces WHERE id = ${workspaceId}`;
                const [admin] = await sql`SELECT org_id FROM users WHERE id = ${adminId}`;
                if (!workspace || !admin || workspace.org_id !== orgId || admin.org_id !== orgId) {
                    return fail('Administrator and workspace must belong to the selected organization', 400);
                }

                await sql`
                    INSERT INTO workspace_members (user_id, workspace_id, org_id, role, invited_by)
                    VALUES (${adminId}, ${workspaceId}, ${orgId}, ${role || 'PMO_ADMIN'}, ${userId})
                    ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = EXCLUDED.role
                `;
                return ok({ success: true });
            }

            // POST /api/org_manage/:orgId/admin/:adminId/workspace/:workspaceId — remove admin from workspace
            // handled in the DELETE section at the bottom of this file.

            // POST /api/org_manage — create org
            const { orgName, adminEmail, plan, logoUrl, primaryColor } = JSON.parse(event.body || '{}');
            const normalizedOrgName = typeof orgName === 'string' ? orgName.trim() : '';
            if (!normalizedOrgName || normalizedOrgName.length > 120) return fail('An organization name of up to 120 characters is required');
            if (plan && !['BASIC', 'PRO', 'MAX'].includes(plan)) return fail('Invalid plan');
            if (logoUrl && (typeof logoUrl !== 'string' || !/^https:\/\//i.test(logoUrl))) return fail('Logo URL must use HTTPS');
            if (primaryColor && (typeof primaryColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(primaryColor))) return fail('Primary color must be a six-digit hex color');
            if (adminEmail && (typeof adminEmail !== 'string' || !/^\S+@\S+\.\S+$/.test(adminEmail.trim()))) return fail('A valid administrator email is required');

            // Bottom-up: any user without org. Top-down: superuser only
            const [caller] = await sql`SELECT org_id, role FROM users WHERE id = ${userId}`;
            if (caller.org_id && userRole !== 'SUPERUSER') {
                return fail('You already belong to an organization', 400);
            }

            const cleanAdminEmail = userRole === 'SUPERUSER' && adminEmail
                ? adminEmail.toLowerCase().trim()
                : null;
            const [existingAdmin] = cleanAdminEmail
                ? await sql`SELECT id FROM users WHERE email = ${cleanAdminEmail}`
                : [];
            if (cleanAdminEmail && !existingAdmin && !RESEND_API_KEY) {
                return fail('Administrator invitation delivery is unavailable; organization was not created', 503);
            }

            const orgSlug = generateSlug(normalizedOrgName);

            // Create org
            const [org] = await sql`
                INSERT INTO organizations (id, name, slug, logo_url, primary_color)
                VALUES (gen_random_uuid(), ${normalizedOrgName}, ${orgSlug}, ${logoUrl || null}, ${primaryColor || null})
                RETURNING id, slug, name
            `;

            // Create default workspace
            const [ws] = await sql`
                INSERT INTO workspaces (id, org_id, name)
                VALUES (gen_random_uuid(), ${org.id}, 'Default Workspace')
                RETURNING id
            `;
            let invitationSent: boolean | null = null;

            if (userRole === 'SUPERUSER' && adminEmail) {
                // Top-down: assign admin to this org
                const cleanEmail = cleanAdminEmail!;
                let adminId: string;

                if (existingAdmin) {
                    adminId = existingAdmin.id;
                    await sql`UPDATE users SET org_id = ${org.id}, role = 'ORG_ADMIN' WHERE id = ${adminId}`;
                } else {
                    // Auto-create admin
                    const bcrypt = await import('bcryptjs');
                    const initialSecret = randomBytes(32).toString('base64url');
                    const hash = await bcrypt.hash(initialSecret, 10);
                    const [newUser] = await sql`
                        INSERT INTO users (email, password_hash, name, role, plan, org_id)
                        VALUES (${cleanEmail}, ${hash}, ${cleanEmail.split('@')[0]}, 'ORG_ADMIN', ${plan || 'BASIC'}, ${org.id})
                        RETURNING id
                    `;
                    adminId = newUser.id;
                    const invitation = await sendAdminInvitation(cleanEmail, org.name);
                    if (!invitation.sent) {
                        let rollbackFailed = false;
                        try {
                            await sql`DELETE FROM users WHERE id = ${adminId}`;
                            await sql`DELETE FROM organizations WHERE id = ${org.id}`;
                        } catch (cleanupError) {
                            rollbackFailed = true;
                            console.error('[org_manage] failed to roll back undelivered administrator invitation:', cleanupError instanceof Error ? cleanupError.message : 'Unknown error');
                        }
                        return fail(
                            rollbackFailed
                                ? 'Administrator invitation could not be delivered; provisioning requires administrator remediation'
                                : 'Administrator invitation could not be delivered; organization provisioning was rolled back',
                            503,
                        );
                    }
                    invitationSent = true;
                }

                // Add admin as PMO_ADMIN in default workspace
                await sql`
                    INSERT INTO workspace_members (user_id, workspace_id, org_id, role)
                    VALUES (${adminId}, ${ws.id}, ${org.id}, 'PMO_ADMIN')
                    ON CONFLICT DO NOTHING
                `;
            } else {
                // Bottom-up: creator becomes ORG_ADMIN
                await sql`UPDATE users SET org_id = ${org.id}, role = 'ORG_ADMIN' WHERE id = ${userId}`;
                await sql`
                    INSERT INTO workspace_members (user_id, workspace_id, org_id, role)
                    VALUES (${userId}, ${ws.id}, ${org.id}, 'PMO_ADMIN')
                    ON CONFLICT DO NOTHING
                `;
            }

            return ok({ success: true, orgSlug: org.slug, orgId: org.id, invitationSent }, 201);
        }

        // ── PUT: Update org (superuser) ──────────────────────────────
        if (event.httpMethod === 'PUT') {
            if (userRole !== 'SUPERUSER') return fail('Forbidden', 403);
            const subpath = event.path.replace(/^.*\/api\/org_manage/, '');
            const orgId = subpath.replace(/^\//, '');
            if (!orgId) return fail('Org ID required');

            const { plan, name } = JSON.parse(event.body || '{}');

            if (plan) {
                if (!['BASIC', 'PRO', 'MAX'].includes(plan)) return fail('Invalid plan');
                // Update all users in this org to the new plan
                await sql`UPDATE users SET plan = ${plan} WHERE org_id = ${orgId}`;
            }
            if (name) {
                const normalizedName = typeof name === 'string' ? name.trim() : '';
                if (!normalizedName || normalizedName.length > 120) return fail('An organization name of up to 120 characters is required');
                await sql`UPDATE organizations SET name = ${normalizedName} WHERE id = ${orgId}`;
            }

            return ok({ success: true });
        }

        // ── DELETE: Delete org (superuser) ────────────────────────────
        if (event.httpMethod === 'DELETE') {
            if (userRole !== 'SUPERUSER') return fail('Forbidden', 403);
            const subpath = event.path.replace(/^.*\/api\/org_manage/, '');
            // DELETE /api/org_manage/:orgId/admin/:adminId/workspace/:workspaceId — remove admin from workspace
            if (subpath.match(/^\/[^/]+\/admin\/[^/]+\/workspace\/[^/]+$/)) {
                if (userRole !== 'SUPERUSER') return fail('Forbidden', 403);
                const [, orgId, , adminId, , workspaceId] = subpath.split('/');

                const [workspace] = await sql`SELECT org_id FROM workspaces WHERE id = ${workspaceId}`;
                const [admin] = await sql`SELECT org_id FROM users WHERE id = ${adminId}`;
                if (!workspace || !admin || workspace.org_id !== orgId || admin.org_id !== orgId) {
                    return fail('Administrator and workspace must belong to the selected organization', 400);
                }

                await sql`DELETE FROM workspace_members WHERE user_id = ${adminId} AND workspace_id = ${workspaceId}`;
                return ok({ success: true });
            }

            const orgId = subpath.replace(/^\//, '');
            if (!orgId) return fail('Org ID required');
            return fail('Permanent organization deletion is disabled. Use an audited archive workflow instead.', 410);
        }

        return fail('Method not allowed', 405);
    } catch (e: any) {
        console.error('[org_manage]', e?.message);
        return fail('Server error', 500);
    }
};
