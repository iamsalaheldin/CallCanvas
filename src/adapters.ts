import type { APIResponse } from '@playwright/test';

/** The parts of a WHATWG `Response` (Node `fetch`, undici) the page reads. Structural, so no DOM lib is needed. */
export interface FetchResponseLike {
    status: number;
    statusText: string;
    ok: boolean;
    url: string;
    headers: { forEach(callback: (value: string, key: string) => void): void };
}

/**
 * Wraps a `fetch` response and its already-read body as the `APIResponse` getters {@link reportApiCall}
 * uses, for a call made outside an `APIRequestContext` that should still be on the page:
 *
 *   const res = await fetch(url, { method: 'POST', body });
 *   const bytes = Buffer.from(await res.arrayBuffer());
 *   await reportApiCall({ method: 'fetch', args: [url, { method: 'POST', data: body }], response: fromFetchResponse(res, bytes), startedAt, durationMs });
 */
export function fromFetchResponse(response: FetchResponseLike, body: Buffer): APIResponse {
    const headers: Array<{ name: string; value: string }> = [];
    response.headers.forEach((value, key) => { headers.push({ name: key, value }); });
    const like = {
        status: () => response.status,
        statusText: () => response.statusText,
        ok: () => response.ok,
        url: () => response.url,
        headers: () => Object.fromEntries(headers.map(h => [h.name, h.value])),
        headersArray: () => headers,
        body: async () => body,
        text: async () => body.toString('utf8'),
        json: async () => JSON.parse(body.toString('utf8')) as unknown,
        dispose: async () => undefined,
    };
    return like as unknown as APIResponse;
}
