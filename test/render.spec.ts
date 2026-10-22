import { test, expect } from '@playwright/test';
import { MASK, highlightJson, renderApiReportPage, renderApiTransactionHtml, renderCallSection, type ApiTransaction } from '../src/index.js';

/** The renderer: escaping, status colours, JSON colouring, and committed snapshots of both page layouts. */

const okTx: ApiTransaction = {
    sequence: 1,
    client: 'orders-api',
    startedAt: '2026-10-22T00:00:00.000Z',
    durationMs: 12,
    request: {
        method: 'POST',
        url: 'https://host.test/a?x=<script>',
        path: '/a',
        headers: { '<h>': '"v"', Accept: 'application/json' },
        query: { x: '<script>' },
        body: { kind: 'json', text: '{\n  "a": "<b>",\n  "n": -1.5e3,\n  "t": true,\n  "z": null\n}', bytes: 10, contentType: 'application/json' },
        options: { timeout: '1' },
    },
    response: {
        status: 302,
        statusText: '',
        ok: false,
        headers: { Location: '/x' },
        body: { kind: 'empty', text: '' },
        url: 'https://host.test/x',
    },
};

const errorTx: ApiTransaction = {
    sequence: 3,
    durationMs: 30001,
    startedAt: '2026-10-22T00:00:00.000Z',
    request: { method: 'GET', url: 'https://host.test/slow', path: '/slow', headers: {}, query: {}, body: { kind: 'empty', text: '' }, options: {} },
    error: { name: 'TimeoutError', message: 'Request timed out after 30000ms\n  - token: ***' },
};

test('escapes everything it is given and colours JSON tokens', () => {
    const html = renderApiTransactionHtml(okTx);
    expect(html).not.toContain('<script>');
    expect(html).toContain('x=&lt;script&gt;');
    expect(html).toContain('<th>&lt;h&gt;</th><td>&quot;v&quot;</td>');
    expect(html).toContain('class="status s3"');
    expect(html).toContain('302 Found');
    expect(html).toContain('<th>Final URL</th><td>https://host.test/x</td>');
    expect(html).toContain('<span class="n">-1.5e3</span>');
    expect(html).toContain('<span class="s">&quot;&lt;b&gt;&quot;</span>');
    expect(html).toContain('<span class="b">null</span>');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('orders-api');
});

test('an error transaction renders the error in place of the response', () => {
    const html = renderApiTransactionHtml(errorTx);
    expect(html).toContain('✖ TimeoutError');
    expect(html).toContain('<div class="error-name">TimeoutError</div>');
    expect(html).toContain('Request timed out after 30000ms');
    expect(html).toContain(MASK);
});

test('a call section is collapsed when the call succeeded and open otherwise', () => {
    const ok: ApiTransaction = { ...okTx, response: { ...okTx.response!, status: 200, ok: true } };
    expect(renderCallSection(ok)).toContain('<details class="call" id="call-1">');
    expect(renderCallSection(okTx)).toContain('<details class="call" id="call-1" open>');
    expect(renderCallSection(errorTx)).toContain('<details class="call" id="call-3" open>');
    // Tab ids are prefixed per section so radio groups never collide on one page.
    expect(renderCallSection(okTx)).toContain('name="c1-req"');
    expect(renderCallSection(errorTx)).not.toContain('name="c3-res"');
});

test('the per-test page escapes its heading and index and carries every section', () => {
    const html = renderApiReportPage(
        { title: 'TC <b>x</b> & "y"', subtitle: 'proj · file.spec.ts' },
        [{ sequence: 1, method: 'GET', path: '/a<b>', status: 200, durationMs: 3 }, { sequence: 2, method: 'POST', path: '/b', errorName: 'TimeoutError', durationMs: 9 }],
        ['<details class="call" id="call-1"></details>', '<details class="call" id="call-2" open></details>'],
    );
    expect(html).toContain('<h1>TC &lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;</h1>');
    expect(html).toContain('<code>/a&lt;b&gt;</code>');
    expect(html).toContain('2 API calls');
    expect(html).toContain('1 failed');
    expect(html).toContain('⏱ 12 ms in requests');
    expect(html).toContain('✖ TimeoutError');
    expect(html).toContain('id="call-2" open');
    expect(html).not.toMatch(/<script/i);
});

test('highlightJson leaves non-JSON text intact but escaped', () => {
    expect(highlightJson('plain & "quoted"')).toBe('plain &amp; <span class="s">&quot;quoted&quot;</span>');
});

test('rendered pages match their committed snapshots', () => {
    expect(renderApiTransactionHtml(okTx)).toMatchSnapshot('call-page.html');
    expect(renderApiTransactionHtml(errorTx)).toMatchSnapshot('error-page.html');
    expect(renderApiReportPage(
        { title: 'checkout flow', subtitle: 'api-tests · checkout.spec.ts' },
        [
            { sequence: 1, method: 'POST', path: '/a', status: 302, durationMs: 12 },
            { sequence: 3, method: 'GET', path: '/slow', errorName: 'TimeoutError', durationMs: 30001, bodiesOmitted: true },
        ],
        [renderCallSection(okTx), renderCallSection(errorTx)],
    )).toMatchSnapshot('test-page.html');
});
