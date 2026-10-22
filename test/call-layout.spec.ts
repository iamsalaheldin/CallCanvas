import fs from 'fs';
import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { MASK, defineRules, leakCheck, reportApiCall, textRule, withApiReporting } from '../src/index.js';
import { attachedPages, clearEnv } from './helpers/attachments.js';
import { JWT, PDF, startServer, type TestServer } from './helpers/server.js';

/**
 * One page per call (`layout: 'call'`): what gets attached, what the page shows, what it never shows,
 * and that reporting can neither change a call's outcome nor run when it is switched off.
 */

let server: TestServer;
let base: string;
let raw: APIRequestContext;
let api: APIRequestContext;

test.beforeAll(async () => {
    server = await startServer();
    base = server.base;
});

test.afterAll(async () => {
    await server.close();
});

test.beforeEach(async () => {
    server.seen.length = 0;
    clearEnv();
    raw = await playwrightRequest.newContext({ baseURL: base });
    api = withApiReporting(raw, { client: 'UnitClient[test]', layout: 'call' });
});

test.afterEach(async () => {
    clearEnv();
    await raw.dispose();
});

test('a successful call attaches one HTML page with method, URL, status, duration and both bodies', async () => {
    const response = await api.get(`${base}/json?tenantId=7`, { headers: { token: JWT, lang: 'en' }, timeout: 5000 });
    expect(response.status()).toBe(200);
    // The caller still reads the body after the report did.
    expect((await response.json()).ok).toBe(true);

    const pages = attachedPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].name).toMatch(/^API #1 GET \/json → 200 \(\d+ ms\)\.html$/);
    // Attached by path, as a .html file under the test's output directory (Playwright keeps its own
    // copy under attachments/) — not as an inline body.
    expect(pages[0].path).toMatch(/\.html$/);
    expect(pages[0].path.startsWith(test.info().outputDir)).toBe(true);
    expect(fs.existsSync(pages[0].path)).toBe(true);
    expect(fs.existsSync(test.info().outputPath('api-report', '001-get.html'))).toBe(true);
    const html = pages[0].html;
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('class="method get">GET<');
    expect(html).toContain(`${base}/json?tenantId=7`);
    expect(html).toContain('class="status s2"');
    expect(html).toMatch(/⏱ \d+ ms/);
    expect(html).toContain('UnitClient[test]');
    expect(html).toContain('<th>token</th><td>***</td>');
    expect(html).toContain('<th>lang</th><td>en</td>');
    expect(html).toContain('<th>timeout</th><td>5000</td>');
    expect(html).toContain('<th>tenantId</th><td>7</td>');
    expect(html).toContain('<span class="k">&quot;ok&quot;</span>: <span class="b">true</span>');
    expect(html).toContain('<th>X-Trace</th><td>trace-1</td>');
    expect(html).toContain('<th>Set-Cookie</th><td>***</td>');
    expect(html).toContain('<th>Status</th><td>200 OK</td>');
    // The response's `token` field is masked by name; the e-mail by the default text rule.
    expect(html).not.toContain('response-secret-token');
    expect(html).not.toContain('someone@example.com');
    expect(html).toContain('&lt;email&gt;');
});

test('4xx and 5xx responses are attached with their status colour and body', async () => {
    const notFound = await api.get(`${base}/notfound`);
    const boom = await api.post(`${base}/boom`, { data: { why: 'test' } });
    expect(notFound.status()).toBe(404);
    expect(boom.status()).toBe(500);

    const [p1, p2] = attachedPages();
    expect(p1.name).toMatch(/^API #1 GET \/notfound → 404/);
    expect(p1.html).toContain('class="status s4"');
    expect(p1.html).toContain('NF001');
    expect(p2.name).toMatch(/^API #2 POST \/boom → 500/);
    expect(p2.html).toContain('class="status s5"');
    expect(p2.html).toContain('kaboom');
    expect(p2.html).toContain('<span class="k">&quot;why&quot;</span>: <span class="s">&quot;test&quot;</span>');
});

test('a followed redirect shows the final URL', async () => {
    const response = await api.get(`${base}/redirect`);
    expect(response.status()).toBe(200);
    const [page] = attachedPages();
    expect(page.html).toContain(`<th>Final URL</th><td>${base}/json</td>`);
});

test('a transport failure is attached as an error page and the original error is rethrown', async () => {
    let thrown: unknown;
    await api.get('http://127.0.0.1:1/unreachable', { headers: { token: JWT } }).catch(e => { thrown = e; });
    expect(thrown).toBeInstanceOf(Error);

    const pages = attachedPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].name).toMatch(/^API #1 GET \/unreachable ✖ Error \(\d+ ms\)\.html$/);
    expect(pages[0].html).toContain('class="status s-error"');
    expect(pages[0].html).toContain('the request failed before a response arrived');
    expect(pages[0].html).toContain('ECONNREFUSED');
    expect(pages[0].html).not.toContain(JWT);
});

test('a timeout is attached as an error page without the request headers', async () => {
    let thrown: Error | undefined;
    await api.get(`${base}/slow`, { headers: { token: JWT }, timeout: 300 }).catch(e => { thrown = e; });
    // Playwright >= 1.41 throws a TimeoutError 'Timeout 300ms exceeded'; 1.40 threw a plain Error 'Request timed out after 300ms'.
    expect(['TimeoutError', 'Error']).toContain(thrown?.name);
    expect(thrown?.message).toMatch(/Timeout 300ms exceeded|timed out after 300ms/);
    // Playwright's own error still carries the header — that is what the page must not repeat.
    expect(thrown?.message).toContain('token');

    const pages = attachedPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].name).toMatch(/^API #1 GET \/slow ✖ (TimeoutError|Error)/);
    expect(pages[0].html).toMatch(/Timeout 300ms exceeded|timed out after 300ms/);
    expect(pages[0].html).not.toContain(JWT);
    // The call log is shown without its terminal colours, and the header line itself is masked.
    expect(pages[0].html).not.toMatch(/\u001b\[|\[2m|\[22m/);
    // Newer Playwright appends the request headers as a call log; when it does, the header line is masked.
    expect(pages[0].html).not.toMatch(/- token: (?!\*\*\*)/);
    if (/Timeout 300ms exceeded/.test(thrown?.message ?? '')) expect(pages[0].html).toMatch(/- token: \*\*\*/);
});

test('every call in a test is attached on its own, in order, for every method', async () => {
    await api.get(`${base}/json`);
    await api.post(`${base}/echo`, { data: { a: 1 } });
    await api.put(`${base}/echo`, { data: 'plain text body', headers: { 'Content-Type': 'text/plain' } });
    await api.patch(`${base}/echo`, { data: { b: 2 } });
    await api.delete(`${base}/echo?id=3`);
    await api.fetch(`${base}/echo`, { method: 'POST', data: { c: 3 } });
    await api.head(`${base}/json`);

    const names = attachedPages().map(p => p.name.replace(/ \(\d+ ms\)\.html$/, ''));
    expect(names).toEqual([
        'API #1 GET /json → 200',
        'API #2 POST /echo → 200',
        'API #3 PUT /echo → 200',
        'API #4 PATCH /echo → 200',
        'API #5 DELETE /echo → 200',
        'API #6 POST /echo → 200',
        'API #7 HEAD /json → 200',
    ]);
    expect(server.seen.map(s => s.method)).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'POST', 'HEAD']);
    expect(attachedPages()[2].html).toContain('plain text body');
});

test('XML, HTML and plain text bodies are shown as escaped text, never rendered', async () => {
    await api.get(`${base}/xml`);
    await api.get(`${base}/html`);
    await api.get(`${base}/boom`);

    const [xml, html, text] = attachedPages();
    expect(xml.html).toContain('<label for="res-body">Body<small>xml</small></label>');
    expect(xml.html).toContain('&lt;item id=&quot;1&quot;&gt;one&lt;/item&gt;');
    expect(html.html).toContain('<label for="res-body">Body<small>html</small></label>');
    expect(html.html).not.toContain('<script>alert');
    expect(html.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(text.html).toContain('<label for="res-body">Body<small>text</small></label>');
});

test('missing request and response bodies read as empty', async () => {
    await api.get(`${base}/empty`);
    const [page] = attachedPages();
    expect(page.name).toMatch(/^API #1 GET \/empty → 204/);
    expect(page.html).toContain('<label for="req-body">Body<small>empty</small></label>');
    expect(page.html).toContain('<label for="res-body">Body<small>empty</small></label>');
    expect(page.html.match(/No body\./g)).toHaveLength(2);
});

test('a binary response is described by size and type, never decoded', async () => {
    const response = await api.get(`${base}/pdf`);
    expect((await response.body()).equals(PDF)).toBe(true);
    const [page] = attachedPages();
    expect(page.html).toContain(`&lt;binary application/pdf — ${PDF.length} bytes, not shown&gt;`);
    expect(page.html).not.toContain('%PDF');
});

test('raw PDF bytes inside a text body are withheld by the default leak check', async () => {
    await api.get(`${base}/pdf-in-text`);
    const [page] = attachedPages();
    expect(page.html).not.toContain('%PDF-1.7');
    expect(page.html).toContain('[withheld — Text still contains raw PDF bytes.]');
});

test('secrets are masked in headers, query, bodies and error text — by default names, configured names and rules', async () => {
    const phone = textRule('e164-phone', /(?<!\d)\+?[1-9]\d{7,14}(?!\d)/, '<phone>');
    const reported = withApiReporting(raw, {
        layout: 'call',
        maskBodyFields: ['customerId', 'loginId'],
        maskQueryParams: ['projectSecret', 'input'],
        maskHeaders: ['x-project-key'],
        rules: defineRules({ text: [phone] }),
    });
    const response = await reported.post(`${base}/json?input=SIGNEDVALUE12345&projectSecret=abc&keep=1`, {
        headers: { Authorization: `Bearer ${JWT}`, Cookie: 'session=xyz', 'X-Project-Key': 'k-123', lang: 'ar' },
        data: { loginId: 'someone', password: 'hunter2', otp: '123456', customerId: '1098765432', note: 'call +14155550123 or a@b.co', nested: { token: JWT } },
    });
    expect(response.status()).toBe(200);
    const [page] = attachedPages();
    const html = page.html;

    for (const leaked of [JWT, 'hunter2', '123456', 'SIGNEDVALUE12345', 'k-123', '1098765432', 'response-secret-token', '+14155550123', 'a@b.co', 'someone@example.com', 'session=xyz', 'projectSecret=abc']) {
        expect(html, `page must not contain ${leaked}`).not.toContain(leaked);
    }
    expect(html).toContain('<th>Authorization</th><td>***</td>');
    expect(html).toContain('<th>Cookie</th><td>***</td>');
    expect(html).toContain('<th>X-Project-Key</th><td>***</td>');
    expect(html).toContain('<th>lang</th><td>ar</td>');
    expect(html).toContain('<th>keep</th><td>1</td>');
    expect(html).toContain('<th>projectSecret</th><td>***</td>');
    expect(html).toContain('input=***');
    expect(html).toContain('<th>input</th><td>***</td>');
    expect(html).toContain('<span class="k">&quot;password&quot;</span>: <span class="s">&quot;***&quot;</span>');
    expect(html).toContain('<span class="k">&quot;customerId&quot;</span>: <span class="s">&quot;***&quot;</span>');
    expect(html).toContain('<span class="k">&quot;loginId&quot;</span>: <span class="s">&quot;***&quot;</span>');
    expect(html).toContain('&lt;phone&gt;');
    expect(html).toContain('&lt;email&gt;');
    // The server received the real values: masking happens on the report only.
    expect(server.seen[0].body).toContain('hunter2');
    expect(server.seen[0].url).toContain('input=SIGNEDVALUE12345');
});

test('the environment adds mask names too', async () => {
    process.env.API_REPORT_MASK_HEADERS = 'X-Env-Key';
    process.env.API_REPORT_MASK_QUERY_PARAMS = 'envSecret';
    process.env.API_REPORT_MASK_BODY_FIELDS = 'envField';
    await api.post(`${base}/json?envSecret=QV-1&open=2`, { headers: { 'x-env-key': 'HV-1' }, data: { envField: 'BV-1', open: 'b2' } });
    const [page] = attachedPages();
    expect(page.html).not.toContain('HV-1');
    expect(page.html).not.toContain('QV-1');
    expect(page.html).not.toContain('BV-1');
    expect(page.html).toContain('<th>x-env-key</th><td>***</td>');
    expect(page.html).toContain('<th>envSecret</th><td>***</td>');
    expect(page.html).toContain('<span class="k">&quot;envField&quot;</span>: <span class="s">&quot;***&quot;</span>');
    expect(page.html).toContain('<th>open</th><td>2</td>');
});

test('form and multipart bodies list their fields with secrets masked and files described', async () => {
    await api.post(`${base}/echo`, { form: { username: 'u', password: 'p', remember: 'yes' } });
    await api.post(`${base}/echo`, { multipart: { file: { name: 'sheet.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.alloc(10) }, otp: '9999', comment: 'hello' } });
    const [form, multipart] = attachedPages();
    expect(form.html).toContain('<label for="req-body">Body<small>form</small></label>');
    expect(form.html).toContain('password=***');
    expect(form.html).toContain('remember=yes');
    expect(form.html).not.toContain('password=p\n');
    expect(multipart.html).toContain('<label for="req-body">Body<small>multipart</small></label>');
    expect(multipart.html).toContain('file: &lt;file sheet.xlsx, application/vnd.ms-excel, 10 bytes&gt;');
    expect(multipart.html).toContain('otp: ***');
    expect(multipart.html).toContain('comment: hello');
});

test('bodies are cut at the configured size after masking', async () => {
    const reported = withApiReporting(raw, { layout: 'call', maxBodyChars: 500 });
    await reported.get(`${base}/big`);
    const [page] = attachedPages();
    expect(page.html).toContain('<label for="res-body">Body<small>json · truncated</small></label>');
    expect(page.html).toMatch(/…\[truncated \d+ more chars\]/);
    expect(page.html).toContain('API_REPORT_MAX_BODY_CHARS');
});

test('a body above maxRawBytes is described and never parsed', async () => {
    const reported = withApiReporting(raw, { layout: 'call', maxRawBytes: 1000 });
    const response = await reported.post(`${base}/big`, { data: { pad: 'x'.repeat(2000), password: 'p' } });
    expect(response.status()).toBe(200);
    const [page] = attachedPages();
    expect(page.html).toContain('larger than API_REPORT_MAX_RAW_BYTES (1000), not shown');
    expect(page.html).not.toContain('xxxxxxxxxx');
    expect(page.html).not.toContain('&quot;rows&quot;');
    expect(page.html).toContain('<label for="req-body">Body<small>hidden</small></label>');
    expect(page.html).toContain('<label for="res-body">Body<small>hidden</small></label>');
});

test('a relative URL with a malformed %-sequence is still reported, its masked parameter hidden', async () => {
    const response = await api.get('/echo?%E0=1&token=abc123&keep=2');
    expect(response.status()).toBe(200);
    const [page] = attachedPages();
    expect(page.name).toMatch(/^API #1 GET \/echo → 200/);
    expect(page.html).toContain('token=***');
    expect(page.html).toContain('<th>token</th><td>***</td>');
    expect(page.html).toContain('<th>keep</th><td>2</td>');
});

test('a value a consumer leak check catches under an unlisted header is withheld, not shown', async () => {
    const reported = withApiReporting(raw, {
        layout: 'call',
        rules: defineRules({ leaks: [leakCheck('ticket', /TICKET-\d{6}/, 'Text still contains a ticket id.')] }),
    });
    await reported.get(`${base}/json`, { headers: { 'X-Forwarded-Ticket': 'TICKET-123456; other=1' } });
    const [page] = attachedPages();
    expect(page.html).not.toContain('TICKET-123456');
    expect(page.html).toContain('<th>X-Forwarded-Ticket</th><td>[withheld — Text still contains a ticket id.]</td>');
});

test('showBodies: false hides every body', async () => {
    const reported = withApiReporting(raw, { layout: 'call', showBodies: false });
    await reported.post(`${base}/json`, { data: { secret: 'x' } });
    const [page] = attachedPages();
    expect(page.html).not.toContain('secret');
    expect(page.html).not.toContain('Someone');
    expect(page.html).toContain('hidden by API_REPORT_SHOW_BODIES=false');
});

test('after maxPerTest calls the rest are not attached, and the consumer is warned once', async () => {
    const warnings: string[] = [];
    const reported = withApiReporting(raw, { layout: 'call', maxPerTest: 2, onWarning: m => warnings.push(m) });
    await reported.get(`${base}/json`);
    await reported.get(`${base}/json`);
    const third = await reported.get(`${base}/json`);
    const fourth = await reported.get(`${base}/json`);
    expect(third.status()).toBe(200);
    expect(fourth.status()).toBe(200);
    expect(attachedPages()).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('API_REPORT_MAX_PER_TEST (2) reached');
});

test('concurrent calls in one test are each attached once, with distinct sequence numbers', async () => {
    const responses = await Promise.all([
        api.get(`${base}/json`),
        api.post(`${base}/echo`, { data: { n: 1 } }),
        api.get(`${base}/notfound`),
        api.get(`${base}/xml`),
        api.get(`${base}/empty`),
    ]);
    expect(responses.map(r => r.status())).toEqual([200, 200, 404, 200, 204]);
    const pages = attachedPages();
    expect(pages).toHaveLength(5);
    const sequences = pages.map(p => Number(/^API #(\d+) /.exec(p.name)![1])).sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3, 4, 5]);
    expect(pages.map(p => p.name.replace(/^API #\d+ /, '').replace(/ \(\d+ ms\)\.html$/, '')).sort()).toEqual([
        'GET /empty → 204', 'GET /json → 200', 'GET /notfound → 404', 'GET /xml → 200', 'POST /echo → 200',
    ]);
});

test('with reporting disabled the original context is used and nothing is attached', async () => {
    expect(withApiReporting(raw, { enabled: false })).toBe(raw);
    for (const value of ['false', 'False', '0', 'no', 'off']) {
        process.env.API_REPORT_ENABLED = value;
        expect(withApiReporting(raw), value).toBe(raw);
    }
    // An explicit option wins over the environment, both ways.
    expect(withApiReporting(raw, { enabled: true })).not.toBe(raw);
    process.env.API_REPORT_ENABLED = 'true';
    expect(withApiReporting(raw, { enabled: false })).toBe(raw);

    process.env.API_REPORT_ENABLED = 'false';
    const response = await withApiReporting(raw).get(`${base}/json`);
    expect(response.status()).toBe(200);
    expect(attachedPages()).toHaveLength(0);
});

test('the wrapped context keeps its other members and its errors', async () => {
    const boom = new Error('context refused');
    const fake = {
        get: async () => { throw boom; },
        dispose: async () => 'disposed',
        storageState: async () => ({ cookies: [], origins: [] }),
    } as unknown as APIRequestContext;
    const wrapped = withApiReporting(fake, { layout: 'call' });
    await expect(wrapped.get('http://example.test/x')).rejects.toBe(boom);
    // A falsy throw is rethrown as thrown, not turned into a resolved `undefined`.
    const falsy = withApiReporting({ get: async () => { throw undefined; } } as unknown as APIRequestContext, { layout: 'call' });
    await expect(falsy.get('http://example.test/y')).rejects.toBeUndefined();
    expect(await wrapped.dispose()).toBe('disposed');
    expect(attachedPages()).toHaveLength(2);
    expect(attachedPages()[0].html).toContain('context refused');
});

test('a response the report cannot read never fails the call', async () => {
    const broken = {
        status: () => 200,
        statusText: () => 'OK',
        ok: () => true,
        headers: () => ({ 'content-type': 'application/json' }),
        headersArray: () => [{ name: 'content-type', value: 'application/json' }],
        body: async () => { throw new Error('disposed'); },
        text: async () => { throw new Error('disposed'); },
        url: () => 'http://example.test/x',
    } as unknown as APIResponse;
    await reportApiCall({ method: 'get', args: ['http://example.test/x'], response: broken, startedAt: new Date(), durationMs: 1 }, { layout: 'call' });
    const [page] = attachedPages();
    expect(page.name).toMatch(/^API #1 GET \/x → 200/);
    expect(page.html).toContain('The response body could not be read.');
});

test('a reporting failure is one warning and leaves the call untouched', async () => {
    const warnings: string[] = [];
    const reported = withApiReporting(raw, {
        layout: 'call',
        onWarning: m => warnings.push(m),
        // A rule whose replace function throws: the sanitizer must swallow it, not the test.
        rules: defineRules({ text: [textRule('explodes', /Someone/, () => { throw new Error('rule exploded'); })] }),
    });
    const response = await reported.get(`${base}/json`);
    expect(response.status()).toBe(200);
    expect((await response.json()).ok).toBe(true);
    const [page] = attachedPages();
    expect(page.html).toContain('Body withheld: rule exploded');
    expect(page.html).not.toContain('response-secret-token');
    expect(page.html).toContain(MASK);
    expect(warnings).toEqual([]);
});
