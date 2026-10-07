import { EventEmitter } from 'node:events';

const requestMock = jest.fn();

jest.mock('node:https', () => ({ request: requestMock }));

import { fetchPinnedPublicHttps, type PinnedPublicHttpsTarget, PublicHttpsError } from '../../netlify/functions/publicHttps';

describe('pinned public HTTPS requests', () => {
    beforeEach(() => {
        requestMock.mockReset();
    });

    it('enforces a wall-clock deadline even when a response trickles data', async () => {
        const requestHandle = new EventEmitter() as EventEmitter & {
            destroy: jest.Mock;
            end: jest.Mock;
        };
        requestHandle.destroy = jest.fn((error: Error) => requestHandle.emit('error', error));
        requestHandle.end = jest.fn();

        const response = new EventEmitter() as EventEmitter & {
            headers: Record<string, string>;
            statusCode: number;
        };
        response.headers = {};
        response.statusCode = 200;

        let respond: (() => void) | undefined;
        requestMock.mockImplementation((_options: unknown, callback: (value: typeof response) => void) => {
            respond = () => callback(response);
            return requestHandle;
        });

        jest.useFakeTimers();
        try {
            const target: PinnedPublicHttpsTarget = {
                url: new URL('https://example.com/'),
                hostname: 'example.com',
                address: '93.184.216.34',
                family: 4,
            };
            const result = fetchPinnedPublicHttps(target, '/', { timeoutMs: 100, maxBytes: 1_000 });

            respond?.();
            response.emit('data', Buffer.from('a'));
            jest.advanceTimersByTime(100);

            await expect(result).rejects.toMatchObject<Partial<PublicHttpsError>>({
                message: 'Outbound request timed out',
                statusCode: 504,
            });
            expect(requestHandle.destroy).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });
});
