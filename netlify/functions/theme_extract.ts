import { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { url } = JSON.parse(event.body || '{}');
        if (!url) {
            return { statusCode: 400, body: JSON.stringify({ error: 'URL is required' }) };
        }

        // Normalize URL to start with https://
        let targetUrl = url.trim().toLowerCase();
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }

        const domainUrl = new URL(targetUrl);
        const domain = domainUrl.hostname;

        // Default orbit generic theme
        let extractedTheme = {
            primary_color: '#007aff',
            logo_url: `https://logo.clearbit.com/${domain}`
        };

        try {
            // Attempt a lightweight fetch to scrape meta tags
            const response = await fetch(targetUrl, {
                headers: {
                    'User-Agent': 'OrbitThemeExtractor/1.0',
                    'Accept': 'text/html'
                }
            });

            if (response.ok) {
                const html = await response.text();

                // Regex search for meta theme-color
                const themeMatch = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["'][^>]*>/i);
                if (themeMatch && themeMatch[1]) {
                    extractedTheme.primary_color = themeMatch[1];
                }

                // Try to find apple-touch-icon or og:image if clearbit fails
                const iconMatch = html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["'][^>]*>/i);
                if (iconMatch && iconMatch[1]) {
                    const iconUrl = iconMatch[1].startsWith('http') ? iconMatch[1] : `${domainUrl.origin}${iconMatch[1].startsWith('/') ? '' : '/'}${iconMatch[1]}`;
                    extractedTheme.logo_url = iconUrl;
                }
            }
        } catch (fetchErr) {
            console.log('Scraper request failed, falling back to defaults:', fetchErr);
        }

        return {
            statusCode: 200,
            body: JSON.stringify(extractedTheme)
        };
    } catch (error) {
        console.error('Theme Extraction Error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
    }
};
