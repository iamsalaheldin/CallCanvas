/**
 * Traffic that never went through an `APIRequestContext` — Node `fetch`, axios — reported by hand so
 * it still lands on the test's page, in sequence with the proxied calls.
 */
import { fromFetchResponse, reportApiCall } from 'callcanvas';

export async function reportedFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
    const startedAt = new Date();
    const started = Date.now();
    const response = await fetch(url, init);
    const bytes = Buffer.from(await response.arrayBuffer());
    await reportApiCall({
        method: 'fetch',
        args: [url, { method: init.method ?? 'GET', headers: init.headers, data: init.body }],
        response: fromFetchResponse(response, bytes),
        startedAt,
        durationMs: Date.now() - started,
    }, { client: 'node-fetch' });
    // The body was consumed above; hand the caller a response it can still read.
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
}
