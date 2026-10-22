import http from 'http';
import type { AddressInfo } from 'net';
import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { DEFAULT_ATTACHMENT_NAME, apiReportConfig, withApiReporting } from '../src/index.js';
import { attachedPages, clearEnv } from './helpers/attachments.js';
import { JWT, startServer, type TestServer } from './helpers/server.js';

/** The default layout: one page per test, attached once and rewritten in place as calls arrive. */

let server: TestServer;
let base: string;

test.beforeAll(async () => {
    server = await startServer();
    base = server.base;
});

test.afterAll(async () => {
    await server.close();
});

test.describe('one page per test', () => {
    let raw: APIRequestContext;
    let api: APIRequestContext;

    test.beforeEach(async () => {
        clearEnv();
        raw = await playwrightRequest.newContext({ baseURL: base });
        api = withApiReporting(raw, { client: 'UnitClient[test]' });
    });

    test.afterEach(async () => {
        clearEnv();
        await raw.dispose();
    });

    test('every call of a test lands on one page, attached once and rewritten as calls arrive', async () => {
        expect(apiReportConfig().layout).toBe('test');
        await api.get(`${base}/json`, { headers: { token: JWT } });
        const afterFirst = attachedPages();
        expect(afterFirst).toHaveLength(1);
        expect(afterFirst[0].name).toBe(DEFAULT_ATTACHMENT_NAME);
        expect(afterFirst[0].path.startsWith(test.info().outputDir)).toBe(true);
        expect(afterFirst[0].html.match(/<details class="call"/g)).toHaveLength(1);

        await api.post(`${base}/notfound`, { data: { q: 1 } });
        await api.get('http://127.0.0.1:1/unreachable').catch(() => undefined);
        await api.get(`${base}/xml`);

        const pages = attachedPages();
        expect(pages).toHaveLength(1);
        expect(pages[0].path).toBe(afterFirst[0].path);
        const html = pages[0].html;
        expect(html).toContain(`<title>API calls — ${test.info().title}</title>`);
        expect(html).toContain('4 API calls');
        expect(html).toContain('2 failed');
        expect(html.match(/<details class="call"/g)).toHaveLength(4);
        // Index rows link to the sections; failures open by default, successes collapsed.
        expect(html).toContain('<a href="#call-1">#1</a>');
        expect(html).toContain('<a href="#call-4">#4</a>');
        expect(html).toContain('<details class="call" id="call-1">');
        expect(html).toContain('<details class="call" id="call-2" open>');
        expect(html).toContain('<details class="call" id="call-3" open>');
        expect(html).toContain('<details class="call" id="call-4">');
        // Each section keeps its own tabs, bodies and masking.
        expect(html).toContain('id="c1-req-body"');
        expect(html).toContain('id="c2-res-body"');
        expect(html).toContain('<th>token</th><td>***</td>');
        expect(html).not.toContain(JWT);
        expect(html).toContain('NF001');
        expect(html).toContain('ECONNREFUSED');
        expect(html).toContain('&lt;item id=&quot;1&quot;&gt;one&lt;/item&gt;');
        expect(html).toContain('<span class="k">&quot;q&quot;</span>: <span class="n">1</span>');
        // Self-contained: no script, a locked-down CSP, dark mode via the media query.
        expect(html).not.toMatch(/<script/i);
        expect(html).toContain("default-src 'none'");
        expect(html).toContain('prefers-color-scheme:dark');
    });

    test('past maxPageBytes later calls keep their row and headers but lose their bodies', async () => {
        const capped = withApiReporting(raw, { maxPageBytes: 30_000 });
        await capped.get(`${base}/big`);
        await capped.post(`${base}/json`, { data: { after: 'cap' } });
        const [page] = attachedPages();
        expect(page.html.match(/<details class="call"/g)).toHaveLength(2);
        expect(page.html).toContain('<a href="#call-2">#2</a>');
        expect(page.html).toContain('Body left out: the page reached API_REPORT_MAX_PAGE_BYTES.');
        expect(page.html).toContain('Later calls are listed without bodies');
        expect(page.html).not.toContain('&quot;after&quot;');
        expect(page.html).toContain('&quot;rows&quot;');
    });

    test('maxPerTest bounds the sections too', async () => {
        const capped = withApiReporting(raw, { maxPerTest: 2 });
        await capped.get(`${base}/json`);
        await capped.get(`${base}/json`);
        await capped.get(`${base}/xml`);
        const [page] = attachedPages();
        expect(attachedPages()).toHaveLength(1);
        expect(page.html.match(/<details class="call"/g)).toHaveLength(2);
        expect(page.html).not.toContain('/xml');
    });

    test('the attachment name is configurable by option', async () => {
        const named = withApiReporting(raw, { attachmentName: 'Orders API traffic.html' });
        await named.get(`${base}/json`);
        expect(attachedPages().map(p => p.name)).toEqual(['Orders API traffic.html']);
        // The page is attached once per test: a second wrapped context joins it under the name already used.
        await api.get(`${base}/json`);
        expect(attachedPages().map(p => p.name)).toEqual(['Orders API traffic.html']);
    });

    test('the attachment name is configurable by environment', async () => {
        process.env.API_REPORT_ATTACHMENT_NAME = 'From env.html';
        await api.get(`${base}/json`);
        expect(attachedPages().map(p => p.name)).toEqual(['From env.html']);
    });

    test('concurrent calls in one test all reach the published page', async () => {
        const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => api.get(`${base}/echo?n=${i + 1}`)));
        expect(responses.every(r => r.status() === 200)).toBe(true);
        const [page] = attachedPages();
        expect(attachedPages()).toHaveLength(1);
        expect(page.html).toContain('12 API calls');
        expect(page.html.match(/<details class="call"/g)).toHaveLength(12);
        for (let i = 1; i <= 12; i++) expect(page.html).toContain(`id="call-${i}"`);
    });

    test('two wrapped contexts in one test share the page and the sequence', async () => {
        const second = await playwrightRequest.newContext({ baseURL: base });
        try {
            const other = withApiReporting(second, { client: 'Other' });
            await api.get(`${base}/json`);
            await other.get(`${base}/xml`);
            await api.get(`${base}/empty`);
            const [page] = attachedPages();
            expect(attachedPages()).toHaveLength(1);
            expect(page.html).toContain('3 API calls');
            expect(page.html).toContain('id="call-3"');
            expect(page.html).toContain('UnitClient[test]');
            expect(page.html).toContain('>Other<');
        } finally {
            await second.dispose();
        }
    });

    test('disabled by option attaches no page', async () => {
        const plain = withApiReporting(raw, { enabled: false });
        expect(plain).toBe(raw);
        await plain.get(`${base}/json`);
        expect(attachedPages()).toHaveLength(0);
    });
});

/**
 * A context created ONCE in `beforeAll` and used by several tests: each test gets its own page with
 * only its own calls, because state is keyed by the running test, not by the context.
 */
test.describe('a context shared across tests', () => {
    let raw: APIRequestContext;
    let shared: APIRequestContext;

    test.beforeAll(async () => {
        raw = await playwrightRequest.newContext({ baseURL: base });
        shared = withApiReporting(raw, { client: 'shared' });
    });

    test.afterAll(async () => {
        await raw.dispose();
    });

    test('first test sees only its own calls', async () => {
        await shared.get(`${base}/json?who=first`);
        await shared.get(`${base}/xml?who=first`);
        const [page] = attachedPages();
        expect(attachedPages()).toHaveLength(1);
        expect(page.html).toContain('2 API calls');
        expect(page.html).toContain('who=first');
        expect(page.html).not.toContain('who=second');
        expect(page.html).toContain('id="call-1"');
        expect(page.html).toContain('id="call-2"');
    });

    test('second test starts its own page at call #1', async () => {
        await shared.get(`${base}/empty?who=second`);
        const [page] = attachedPages();
        expect(attachedPages()).toHaveLength(1);
        expect(page.html).toContain('1 API call<');
        expect(page.html).toContain('who=second');
        expect(page.html).not.toContain('who=first');
        expect(page.html).toContain('id="call-1"');
        expect(page.html).not.toContain('id="call-2"');
    });
});

/**
 * A wrapped context used from a worker-scoped fixture. Playwright sets such a fixture up while the FIRST
 * test that needs it is running, with that test's `TestInfo` current, so a call made there is attached
 * to that test — Playwright's own rule for anything attached during fixture setup. (Global setup has no
 * TestInfo at all; there the call simply runs and nothing is attached.)
 */
const workerTest = test.extend<{}, { workerApi: { api: APIRequestContext; calls: number } }>({
    workerApi: [async ({}, use) => {
        const own = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"worker":true}'); });
        await new Promise<void>(resolve => own.listen(0, '127.0.0.1', resolve));
        const raw = await playwrightRequest.newContext({ baseURL: `http://127.0.0.1:${(own.address() as AddressInfo).port}` });
        const api = withApiReporting(raw, { client: 'worker' });
        // Runs during the first test's setup: must not throw; attaches to that test.
        const response = await api.get('/from-worker-fixture');
        const calls = response.status() === 200 ? 1 : 0;
        await use({ api, calls });
        await raw.dispose();
        await new Promise<void>(resolve => own.close(() => resolve()));
    }, { scope: 'worker' }],
});

workerTest('a call made from a worker-scoped fixture runs normally and is attached to the test being set up', async ({ workerApi }) => {
    expect(workerApi.calls).toBe(1);
    expect(attachedPages()).toHaveLength(1);
    expect(attachedPages()[0].name).toBe(DEFAULT_ATTACHMENT_NAME);
    expect(attachedPages()[0].html).toContain('id="call-1"');
    expect(attachedPages()[0].html).toContain('/from-worker-fixture');
    // The same context, used inside the test, continues the sequence on the same page.
    const response = await workerApi.api.get('/inside-test');
    expect(response.status()).toBe(200);
    expect(attachedPages()).toHaveLength(1);
    expect(attachedPages()[0].html).toContain('id="call-2"');
    expect(attachedPages()[0].html).toContain('/inside-test');
});
