import { Handler } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is missing');

const getDb = () => {
    const url = process.env.NEON_DATABASE_URL || process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL;
    if (!url) throw new Error('No DB URL');
    return neon(url);
};

class PublicUrlError extends Error {}

function isPrivateAddress(address: string): boolean {
    const normalizedAddress = address.toLowerCase();
    if (isIP(normalizedAddress) === 6) {
        if (normalizedAddress === '::' || normalizedAddress === '::1' ||
            normalizedAddress.startsWith('fc') || normalizedAddress.startsWith('fd') ||
            /^fe[89ab]/.test(normalizedAddress) || normalizedAddress.startsWith('ff') ||
            normalizedAddress.startsWith('2001:db8:')) return true;
        const mappedIpv4 = normalizedAddress.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        return mappedIpv4 ? isPrivateAddress(mappedIpv4[1]) : false;
    }
    if (isIP(normalizedAddress) !== 4) return true;
    const [a, b] = normalizedAddress.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && [0, 2, 168].includes(b)) ||
        (a === 198 && [18, 19, 51].includes(b)) ||
        (a === 203 && b === 0) ||
        a >= 224;
}

async function safePublicUrl(rawUrl: string): Promise<URL> {
    if (rawUrl.length > 2_048) throw new PublicUrlError('Website URL is too long');
    let url: URL;
    try {
        const candidate = rawUrl.trim().match(/^https?:\/\//i) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
        url = new URL(candidate);
    } catch {
        throw new PublicUrlError('A valid public HTTPS URL is required');
    }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
        throw new PublicUrlError('Only public HTTPS websites are supported');
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw new PublicUrlError('Private network targets are not allowed');
    let addresses: Array<{ address: string }>;
    try {
        addresses = await lookup(hostname, { all: true }) as Array<{ address: string }>;
    } catch {
        throw new PublicUrlError('The website domain could not be resolved');
    }
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new PublicUrlError('Private network targets are not allowed');
    }
    return url;
}

async function readTextWithinLimit(response: Response, maxBytes: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel();
            throw new Error('Website response is too large');
        }
        chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(body);
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const authHeader = event.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
        }
        let userId: string;
        try {
            userId = (jwt.verify(authHeader.slice(7), JWT_SECRET) as { id: string }).id;
        } catch {
            return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
        }
        const sql = getDb();
        const [caller] = await sql`SELECT id, org_id FROM users WHERE id = ${userId}`;
        if (!caller || !caller.org_id) {
            return { statusCode: 403, body: JSON.stringify({ error: 'Tenant access required' }) };
        }

        const { url } = JSON.parse(event.body || '{}');
        if (!url) {
            return { statusCode: 400, body: JSON.stringify({ error: 'URL is required' }) };
        }

        const domainUrl = await safePublicUrl(url);
        const targetUrl = domainUrl.href;
        const domain = domainUrl.hostname;

        // Default orbit generic theme
        let extractedTheme = {
            primary_color: '#007aff',
            logo_url: `https://logo.clearbit.com/${domain}`
        };

        try {
            // Attempt a lightweight fetch to scrape meta tags
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8_000);
            const response = await fetch(targetUrl, {
                signal: controller.signal,
                redirect: 'manual',
                headers: {
                    'User-Agent': 'OrbitThemeExtractor/1.0',
                    'Accept': 'text/html'
                }
            }).finally(() => clearTimeout(timeout));

            if (response.status >= 300 && response.status < 400) {
                throw new PublicUrlError('Redirected websites are not supported');
            }
            if (response.ok) {
                const contentLength = Number(response.headers.get('content-length') || 0);
                if (contentLength > 1_000_000) throw new Error('Website response is too large');
                const html = await readTextWithinLimit(response, 1_000_000);

                // Regex search for meta theme-color
                const themeMatch = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["'][^>]*>/i);
                if (themeMatch && /^#[0-9a-f]{6}$/i.test(themeMatch[1])) {
                    extractedTheme.primary_color = themeMatch[1];
                }

                // Try to find apple-touch-icon or og:image if clearbit fails
                const iconMatch = html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["'][^>]*>/i);
                if (iconMatch && iconMatch[1]) {
                    try {
                        const iconUrl = new URL(iconMatch[1], domainUrl);
                        if (iconUrl.protocol === 'https:' && iconUrl.origin === domainUrl.origin) {
                            extractedTheme.logo_url = iconUrl.href;
                        }
                    } catch {
                        // Keep the safe default logo when the page contains an invalid icon URL.
                    }
                }
            }
        } catch (fetchErr: any) {
            if (fetchErr instanceof PublicUrlError) throw fetchErr;
            console.warn('Theme extraction fetch failed:', fetchErr?.message);
        }

        return {
            statusCode: 200,
            body: JSON.stringify(extractedTheme)
        };
    } catch (error) {
        if (error instanceof PublicUrlError) {
            return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
        }
        console.error('Theme Extraction Error:', error instanceof Error ? error.message : 'Unknown error');
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
    }
};
