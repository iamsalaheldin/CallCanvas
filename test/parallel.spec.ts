import { test, expect, request as playwrightRequest } from '@playwright/test';
import { fromFetchResponse, reportApiCall, withApiReporting } from '../src/index.js';
import { attachedPages } from './helpers/attachments.js';
import { startServer, type TestServer } from './helpers/server.js';

/**
 * Isolation under parallelism: these tests run fully parallel across workers (see playwright.config.ts),
 * each with its own server and context, and each must see exactly its own page. Also the hand-made
 * call path for traffic that never went through an APIRequestContext.
 */

test.describe.configure({ mode: 'parallel' });

let server: TestServer;

test.beforeAll(async () => { server = await startServer(); });
test.afterAll(async () => { await server.close(); });

for (const n of [1, 2, 3, 4]) {
    test(`parallel test ${n} gets a page with only its own ${n} call(s)`, async () => {
        const raw = await playwrightRequest.newContext();
        try {
            const api = withApiReporting(raw, { client: `p${n}` });
            await Promise.all(Array.from({ length: n }, (_, i) => api.get(`${server.base}/echo?test=${n}&call=${i + 1}`)));
            const pages = attachedPages();
            expect(pages).toHaveLength(1);
            expect(pages[0].html).toContain(`${n} API call${n === 1 ? '<' : 's'}`);
            expect(pages[0].html.match(/<details class="call"/g)).toHaveLength(n);
            expect(pages[0].html).toContain(`test=${n}&amp;call=1`);
            for (const other of [1, 2, 3, 4].filter(o => o !== n)) expect(pages[0].html).not.toContain(`test=${other}&amp;`);
            expect(pages[0].html).toContain(`<title>API calls — ${test.info().title}</title>`);
        } finally {
            await raw.dispose();
        }
    });
}

test('a call made with fetch is reported by hand through reportApiCall', async () => {
    const url = `${server.base}/json?via=fetch`;
    const startedAt = new Date();
    const started = Date.now();
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer abc' }, body: JSON.stringify({ q: 1, password: 'p' }) });
    const bytes = Buffer.from(await res.arrayBuffer());
    await reportApiCall({
        method: 'fetch',
        args: [url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer abc' }, data: { q: 1, password: 'p' } }],
        response: fromFetchResponse(res, bytes),
        startedAt,
        durationMs: Date.now() - started,
    }, { client: 'node-fetch' });

    const [page] = attachedPages();
    expect(attachedPages()).toHaveLength(1);
    expect(page.html).toContain('class="method post">POST<');
    expect(page.html).toContain('via=fetch');
    expect(page.html).toContain('node-fetch');
    expect(page.html).toContain('<th>authorization</th><td>***</td>');
    expect(page.html).toContain('<span class="k">&quot;password&quot;</span>: <span class="s">&quot;***&quot;</span>');
    expect(page.html).toContain('<span class="k">&quot;ok&quot;</span>: <span class="b">true</span>');
    expect(page.html).toContain('<th>x-trace</th><td>trace-1</td>');
    expect(page.html).toContain('<th>set-cookie</th><td>***</td>');
});

test('a record for a test that is no longer current is dropped, not misattached', async () => {
    const foreign = { ...test.info() } as typeof test.info extends () => infer T ? T : never;
    await reportApiCall({ method: 'get', args: ['http://example.test/'], startedAt: new Date(), durationMs: 1, testInfo: foreign });
    await reportApiCall({ method: 'get', args: ['http://example.test/'], startedAt: new Date(), durationMs: 1, testInfo: null });
    expect(attachedPages()).toHaveLength(0);
});
