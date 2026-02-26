import type { Handler, HandlerEvent } from '@netlify/functions';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy_key');
const CORS = {
    'Access-Control-Allow-Origin': process.env.URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, POST',
    'Content-Type': 'application/json',
};

function fail(msg: string, status = 400) { return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) }; }

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    if (event.httpMethod !== 'POST') return fail('Method Not Allowed', 405);

    // We expect this to be called server-side securely or authenticated.
    // For MVP, we'll allow it via internal token logic handled in webhook or org_create,
    // but to be safe, we'll require an internal system secret if called over HTTP directly.
    const authHeader = event.headers.authorization;
    if (process.env.INTERNAL_API_SECRET && authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
        return fail('Unauthorized Internal Access', 401);
    }

    try {
        const { type, email, orgName, plan } = JSON.parse(event.body || '{}');

        if (!email || !type) return fail('email and type required');

        let subject = '';
        let htmlSnippet = '';

        if (type === 'WELCOME') {
            subject = 'Welcome to PMO Capacity Planner! 🎉';
            htmlSnippet = `
                <div style="font-family: sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #6366f1;">Workspace Created!</h2>
                    <p>Hi there,</p>
                    <p>Your B2B tenant for <b>${orgName || 'your organization'}</b> is provisioned and ready.</p>
                    <p>Log in at <a href="${process.env.URL || 'https://pmoplanner.netlify.app'}">pmoplanner.netlify.app</a> to start managing your resources intelligently.</p>
                    <br/>
                    <p>Best,<br/>The PMO Team</p>
                </div>
            `;
        } else if (type === 'UPGRADE') {
            subject = 'Your Workspace is Upgraded 🚀';
            htmlSnippet = `
                <div style="font-family: sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #10b981;">Upgrade Successful</h2>
                    <p>Hi there,</p>
                    <p>Your workspace <b>${orgName || ''}</b> has been upgraded to the <b>${plan || 'PRO'}</b> plan.</p>
                    <p>You can now add unlimited projects, resources, and invite team members to collaborate.</p>
                    <br/>
                    <p>Thank you for your business!<br/>The PMO Team</p>
                </div>
            `;
        } else {
            return fail('Unknown template type');
        }

        const data = await resend.emails.send({
            from: 'PMO Planner <noreply@pmoplanner.app>', // Using .app assuming verified domain
            to: [email],
            subject: subject,
            html: htmlSnippet,
        });

        return {
            statusCode: 200,
            headers: CORS,
            body: JSON.stringify({ success: true, id: data.data?.id })
        };
    } catch (e: any) {
        console.error('Email Dispatch Error:', e);
        return fail('Failed to dispatch email: ' + e.message, 500);
    }
};
