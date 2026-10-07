import { Handler } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { fetchPinnedPublicHttps, PublicHttpsError, resolvePinnedPublicHttpsUrl } from './publicHttps';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is missing');

const getDb = () => {
    const url = process.env.NEON_DATABASE_URL || process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL;
    if (!url) throw new Error('No DB URL');
    return neon(url);
};

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

        const websiteTarget = await resolvePinnedPublicHttpsUrl(url, 'website URL');
        const domainUrl = websiteTarget.url;
        const domain = websiteTarget.hostname;

        // Default orbit generic theme
        let extractedTheme = {
            primary_color: '#007aff',
            logo_url: `https://logo.clearbit.com/${domain}`
        };

        try {
            // Attempt a lightweight fetch to scrape meta tags
            const response = await fetchPinnedPublicHttps(
                websiteTarget,
                `${domainUrl.pathname}${domainUrl.search}`,
                {
                    timeoutMs: 8_000,
                    maxBytes: 1_000_000,
                    headers: {
                        'User-Agent': 'OrbitThemeExtractor/1.0',
                        'Accept': 'text/html',
                    },
                },
            );

            if (response.status >= 300 && response.status < 400) {
                throw new PublicHttpsError('Redirected websites are not supported');
            }
            if (response.status >= 200 && response.status < 300) {
                const html = response.body.toString('utf8');

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
            if (fetchErr instanceof PublicHttpsError) throw fetchErr;
            console.warn('Theme extraction fetch failed:', fetchErr?.message);
        }

        return {
            statusCode: 200,
            body: JSON.stringify(extractedTheme)
        };
    } catch (error) {
        if (error instanceof PublicHttpsError) {
            return { statusCode: error.statusCode, body: JSON.stringify({ error: error.message }) };
        }
        console.error('Theme Extraction Error:', error instanceof Error ? error.message : 'Unknown error');
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
    }
};
