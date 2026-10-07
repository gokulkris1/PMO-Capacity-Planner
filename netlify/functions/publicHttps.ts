import { lookup } from 'node:dns/promises';
import { request, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';

export class PublicHttpsError extends Error {
    constructor(message: string, public readonly statusCode = 400) {
        super(message);
        this.name = 'PublicHttpsError';
    }
}

export type PinnedPublicHttpsTarget = {
    url: URL;
    hostname: string;
    address: string;
    family: 4 | 6;
};

type PinnedHttpsResponse = {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
};

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

/**
 * Resolves a public HTTPS target once and returns an address that must be used
 * by the later request. The request helper pins that address through Node's
 * `lookup` callback, preventing a second DNS resolution and DNS rebinding.
 */
export async function resolvePinnedPublicHttpsUrl(rawUrl: string, label: string): Promise<PinnedPublicHttpsTarget> {
    if (rawUrl.length > 2_048) throw new PublicHttpsError(`${label} is too long`);

    let url: URL;
    try {
        const candidate = rawUrl.trim().match(/^https?:\/\//i) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
        url = new URL(candidate);
    } catch {
        throw new PublicHttpsError(`A valid public HTTPS ${label} is required`);
    }

    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
        throw new PublicHttpsError(`Only public HTTPS ${label}s are supported`);
    }

    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw new PublicHttpsError('Private network targets are not allowed');
    }

    let addresses: Array<{ address: string; family: number }>;
    try {
        addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
        throw new PublicHttpsError(`The ${label} could not be resolved`);
    }

    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new PublicHttpsError('Private network targets are not allowed');
    }

    const target = addresses[0];
    if (target.family !== 4 && target.family !== 6) {
        throw new PublicHttpsError(`The ${label} could not be resolved`);
    }

    return { url, hostname, address: target.address, family: target.family };
}

/**
 * Issues a bounded HTTPS GET request using the address returned by
 * `resolvePinnedPublicHttpsUrl`. Hostname and TLS SNI stay intact while the
 * transport connection is pinned to the already validated public address.
 */
export function fetchPinnedPublicHttps(
    target: PinnedPublicHttpsTarget,
    path: string,
    options: { headers?: Record<string, string>; timeoutMs: number; maxBytes: number },
): Promise<PinnedHttpsResponse> {
    if (!path.startsWith('/')) throw new PublicHttpsError('Request path must be absolute');

    return new Promise((resolve, reject) => {
        let settled = false;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const settle = (callback: () => void) => {
            if (settled) return;
            settled = true;
            if (deadline) clearTimeout(deadline);
            callback();
        };

        const requestOptions: RequestOptions = {
            protocol: 'https:',
            hostname: target.hostname,
            port: 443,
            method: 'GET',
            path,
            headers: options.headers,
            servername: target.hostname,
            lookup: (_hostname, _lookupOptions, callback) => callback(null, target.address, target.family),
        };

        const requestHandle = request(requestOptions, response => {
            const contentLengthHeader = response.headers['content-length'];
            const contentLength = Number(Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader || 0);
            if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
                const error = new PublicHttpsError('Website response is too large', 502);
                requestHandle.destroy(error);
                settle(() => reject(error));
                return;
            }

            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > options.maxBytes) {
                    requestHandle.destroy(new PublicHttpsError('Website response is too large', 502));
                    return;
                }
                chunks.push(chunk);
            });
            response.once('error', () => settle(() => reject(new PublicHttpsError('Outbound HTTPS request failed', 502))));
            response.once('end', () => settle(() => resolve({
                status: response.statusCode || 0,
                headers: response.headers,
                body: Buffer.concat(chunks),
            })));
        });

        requestHandle.once('error', error => settle(() => reject(
            error instanceof PublicHttpsError ? error : new PublicHttpsError('Outbound HTTPS request failed', 502),
        )));
        deadline = setTimeout(() => {
            requestHandle.destroy(new PublicHttpsError('Outbound request timed out', 504));
        }, options.timeoutMs);
        requestHandle.end();
    });
}
