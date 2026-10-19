/**
 * Outbound email (HS-07, SH-10). Called directly by functions; there is no public send endpoint.
 * Every interpolated value is HTML-escaped. The provider is Twilio (TWILIO_API_KEY + TWILIO_API_SECRET, or
 * TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN) or else Resend (RESEND_API_KEY). With neither, a send is skipped with a
 * structured log and the business action still succeeds. Sends are bounded to 5 s so the request stays under
 * Netlify's limit.
 */
import { Resend } from 'resend';
import { optionalEnv } from './env';
import { log, errorFields } from './log';
import { safeFetch } from './net';

export const PRODUCT_NAME = 'PMO Capacity Planner';
/** v1.1 sender address, kept only so 2FA/reset mail keeps flowing until FROM_EMAIL is set (CA-4). */
const LEGACY_FROM_ADDRESS = 'noreply@orbitspace.io';

export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const TWILIO_EMAIL_URL = 'https://comms.twilio.com/v1/Emails';
const SEND_TIMEOUT_MS = 5000;

/** Twilio basic-auth pair: an API key (preferred, revocable) or the account SID and auth token. */
function twilioCredentials(): [string, string] | null {
  const key = optionalEnv('TWILIO_API_KEY');
  const secret = optionalEnv('TWILIO_API_SECRET');
  if (key && secret) return [key, secret];
  const sid = optionalEnv('TWILIO_ACCOUNT_SID');
  const token = optionalEnv('TWILIO_AUTH_TOKEN');
  return sid && token ? [sid, token] : null;
}

export type EmailProvider = 'twilio' | 'resend';

export function emailProvider(): EmailProvider | null {
  if (twilioCredentials()) return 'twilio';
  return optionalEnv('RESEND_API_KEY') ? 'resend' : null;
}

export function emailConfigured(): boolean {
  return emailProvider() !== null;
}

/** "Name <address>" or a bare address. */
export function parseSender(from: string): { address: string; name?: string } {
  const m = /^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/.exec(from);
  if (!m) return { address: from.trim() };
  const name = m[1].replace(/^"|"$/g, '').trim();
  return name ? { address: m[2], name } : { address: m[2] };
}

async function twilioSend(m: EmailMessage & { from: string }, [user, pass]: [string, string]) {
  const res = await safeFetch(
    TWILIO_EMAIL_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
      },
      body: JSON.stringify({
        from: parseSender(m.from),
        to: [{ address: m.to }],
        content: { subject: m.subject, html: m.html, text: m.text },
      }),
    },
    { label: 'Email service', timeoutMs: SEND_TIMEOUT_MS },
  );
  // 202 Accepted: queued. The body of an error may echo request details, so only the status is logged.
  return res.ok ? {} : { error: `Twilio email ${res.status}` };
}

let client: { send: (m: EmailMessage & { from: string }) => Promise<{ error?: unknown }> } | null = null;

/** Tests replace the transport. */
export function setEmailTransport(t: typeof client): void {
  client = t;
}

function transport() {
  if (client) return client;
  const twilio = twilioCredentials();
  if (twilio) return { send: (m: EmailMessage & { from: string }) => twilioSend(m, twilio) };
  const resend = new Resend(optionalEnv('RESEND_API_KEY'));
  return {
    send: async (m: EmailMessage & { from: string }) => {
      const r = await resend.emails.send({ from: m.from, to: m.to, subject: m.subject, html: m.html, text: m.text });
      return { error: r.error ?? undefined };
    },
  };
}

export async function sendEmail(msg: EmailMessage): Promise<{ sent: boolean }> {
  if (!emailConfigured() && !client) {
    log('info', { event: 'email.skipped', reason: 'no email provider configured', subject: msg.subject });
    return { sent: false };
  }
  const from = optionalEnv('FROM_EMAIL') || `${PRODUCT_NAME} <${LEGACY_FROM_ADDRESS}>`;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      transport().send({ ...msg, from }),
      new Promise<{ error: unknown }>((resolve) => {
        timer = setTimeout(() => resolve({ error: 'timeout' }), SEND_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (result.error) {
      log('warn', {
        event: 'email.failed',
        subject: msg.subject,
        err: String((result.error as Error)?.message ?? result.error),
      });
      return { sent: false };
    }
    return { sent: true };
  } catch (e) {
    log('warn', { event: 'email.failed', subject: msg.subject, err: errorFields(e) });
    return { sent: false };
  }
}

function layout(title: string, bodyHtml: string): string {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#172b4d">
<p style="font-size:13px;font-weight:600;color:#0b3d91;margin:0 0 16px">${PRODUCT_NAME}</p>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
${bodyHtml}
<p style="color:#5e6c84;font-size:12px;margin:24px 0 0">You received this email from ${PRODUCT_NAME}.</p>
</div>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#0b3d91;color:#ffffff;padding:12px 20px;border-radius:4px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`;
}

export function otpEmail(to: string, otp: string, context: '2fa' | 'reset' | 'verify'): EmailMessage {
  const subject =
    context === 'reset'
      ? `Reset your ${PRODUCT_NAME} password`
      : context === 'verify'
        ? `Verify your email for ${PRODUCT_NAME}`
        : `Your ${PRODUCT_NAME} sign-in code`;
  const lead =
    context === 'reset'
      ? 'Use this code to reset your password:'
      : context === 'verify'
        ? 'Use this code to verify your email address:'
        : 'Use this code to finish signing in:';
  return {
    to,
    subject,
    html: layout(
      subject,
      `<p>${escapeHtml(lead)}</p><p style="font-size:28px;font-weight:700;letter-spacing:8px">${escapeHtml(otp)}</p><p style="color:#5e6c84">This code expires in 15 minutes. If you did not request it, ignore this email.</p>`,
    ),
    text: `${lead} ${otp}\nThis code expires in 15 minutes.`,
  };
}

export function invitationEmail(to: string, orgName: string, inviterName: string, url: string): EmailMessage {
  const subject = `Join ${orgName} on ${PRODUCT_NAME}`;
  return {
    to,
    subject,
    html: layout(
      subject,
      `<p>${escapeHtml(inviterName)} invited you to ${escapeHtml(orgName)}.</p>${button(url, 'Accept invitation')}<p style="color:#5e6c84">The link works once and expires in 7 days.</p>`,
    ),
    text: `${inviterName} invited you to ${orgName} on ${PRODUCT_NAME}. Accept: ${url} (works once, expires in 7 days)`,
  };
}

export function receiptEmail(to: string, orgName: string, plan: string): EmailMessage {
  const subject = `${orgName} is now on the ${plan} plan`;
  return {
    to,
    subject,
    html: layout(subject, `<p>Thank you. ${escapeHtml(orgName)} now has the ${escapeHtml(plan)} plan.</p>`),
    text: `${orgName} now has the ${plan} plan. Thank you.`,
  };
}

export function welcomeEmail(to: string, orgName: string, url: string): EmailMessage {
  const subject = `Welcome to ${PRODUCT_NAME}`;
  return {
    to,
    subject,
    html: layout(
      subject,
      `<p>Your organisation ${escapeHtml(orgName)} is ready.</p>${button(url, 'Open the planner')}`,
    ),
    text: `Your organisation ${orgName} is ready: ${url}`,
  };
}

export function proposalEmail(to: string, personName: string, projectName: string, url: string): EmailMessage {
  const subject = `You've been proposed for ${projectName}`;
  return {
    to,
    subject,
    html: layout(
      subject,
      `<p>${escapeHtml(personName)} has been proposed for ${escapeHtml(projectName)}. The booking is tentative until it is accepted.</p>${button(url, 'Review the proposal')}`,
    ),
    text: `${personName} has been proposed for ${projectName}. Review: ${url}`,
  };
}

export function registrationNoticeEmail(to: string): EmailMessage {
  const subject = `Someone tried to register with your email`;
  return {
    to,
    subject,
    html: layout(
      subject,
      `<p>Someone tried to create a ${PRODUCT_NAME} account with this email address. You already have an account; if this was you, sign in or reset your password. Otherwise you can ignore this email.</p>`,
    ),
    text: `Someone tried to create a ${PRODUCT_NAME} account with this email address. You already have an account.`,
  };
}
