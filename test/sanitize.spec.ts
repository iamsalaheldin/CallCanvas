import { test, expect } from '@playwright/test';
import {
    LeakError,
    MASK,
    assertNoSecrets,
    clearRegisteredSecrets,
    defaultRules,
    defineRules,
    emptyRules,
    fieldRule,
    leakCheck,
    registerSecrets,
    registeredSecretCount,
    resolveConfig,
    sanitizeBody,
    sanitizeErrorMessage,
    sanitizeHeaderMap,
    sanitizeJson,
    sanitizeQuery,
    sanitizeRequestUrl,
    sanitizeText,
    textRule,
    withoutRules,
} from '../src/index.js';
import { JWT } from './helpers/server.js';

/** The sanitizer on its own: rules as data, the secrets registry, and the three layers over each input kind. */

test.afterEach(() => clearRegisteredSecrets());

test.describe('default rules', () => {
    test('replace JWTs, base64 blobs and e-mails in free text', () => {
        const text = `Bearer ${JWT} sent to a.b@example.co.uk with ${'A'.repeat(220)}== and JVBERi0xLjQK${'Q'.repeat(50)}`;
        const out = sanitizeText(text, defaultRules);
        expect(out).not.toContain(JWT);
        expect(out).toContain('<jwt>');
        expect(out).toContain('<email>');
        expect(out).toMatch(/<base64 \d+ chars>/);
        expect(out).toMatch(/<pdf base64 \d+ chars>/);
        expect(out).toContain('Bearer ');
    });

    test('mask credential-like keys in structured data under any spelling, keeping other fields', () => {
        const out = sanitizeJson({
            Password: 'p', clientSecret: 's', refresh_token: 'r', 'x-api-key': 'k', sessionId: 'i', otp: '1', PIN: '2',
            tokenType: 'Bearer', note: `see ${JWT}`, nested: [{ privateKey: 'pk', keep: 'yes' }], count: 3, flag: true, nothing: null,
        }, defaultRules) as Record<string, unknown>;
        expect(out).toEqual({
            Password: MASK, clientSecret: MASK, refresh_token: MASK, 'x-api-key': MASK, sessionId: MASK, otp: MASK, PIN: MASK,
            tokenType: 'Bearer', note: 'see <jwt>', nested: [{ privateKey: MASK, keep: 'yes' }], count: 3, flag: true, nothing: null,
        });
    });

    test('the e-mail regex is linear on a long run of local-part characters', () => {
        const hostile = 'a.'.repeat(100_000);
        const started = Date.now();
        expect(sanitizeText(hostile, defaultRules)).toBe(hostile);
        expect(() => assertNoSecrets(hostile, defaultRules)).not.toThrow();
        expect(Date.now() - started).toBeLessThan(2_000);
    });

    test('leak checks name the rule that tripped', () => {
        expect(() => assertNoSecrets('clean text', defaultRules)).not.toThrow();
        let caught: unknown;
        try {
            assertNoSecrets(`x ${JWT}`, defaultRules);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(LeakError);
        expect((caught as LeakError).rule).toBe('jwt');
        expect((caught as LeakError).message).toBe('Text still contains a JWT.');
        expect(() => assertNoSecrets('%PDF-1.4', defaultRules)).toThrow('raw PDF');
        expect(() => assertNoSecrets('me@example.com', defaultRules)).toThrow('e-mail');
    });
});

test.describe('rule sets', () => {
    test('defineRules appends to the defaults; withoutRules drops by name across all three kinds', () => {
        const mine = defineRules({
            text: [textRule('iban', /\bSA\d{2}[A-Z0-9]{20}\b/, '<iban>')],
            fields: [fieldRule('national-id', ['nationalId', 'iqama'])],
            leaks: [leakCheck('iban', /\bSA\d{2}[A-Z0-9]{20}\b/, 'Text still contains an IBAN.')],
        });
        expect(mine.text.map(r => r.name)).toEqual(['jwt', 'base64-pdf', 'long-base64', 'email', 'iban']);
        expect(mine.fields.map(r => r.name)).toEqual(['credential-keys', 'national-id']);
        expect(mine.leaks.map(r => r.name)).toEqual(['jwt', 'base64-pdf', 'raw-pdf', 'email', 'iban']);
        expect(sanitizeText('pay SA0380000000608010167519 now', mine)).toBe('pay <iban> now');
        expect(sanitizeJson({ nationalId: '1', IQAMA: '2', name: 'n' }, mine)).toEqual({ nationalId: MASK, IQAMA: MASK, name: 'n' });

        const noEmail = withoutRules(mine, 'email', 'iban');
        expect(noEmail.text.map(r => r.name)).toEqual(['jwt', 'base64-pdf', 'long-base64']);
        expect(noEmail.leaks.map(r => r.name)).toEqual(['jwt', 'base64-pdf', 'raw-pdf']);
        expect(sanitizeText('me@example.com', noEmail)).toBe('me@example.com');
        expect(() => assertNoSecrets('me@example.com', noEmail)).not.toThrow();
    });

    test('a set built from nothing applies only what it is given', () => {
        const bare = defineRules({ text: [textRule('digits', /\d/, '#')] }, emptyRules);
        expect(sanitizeText(`a1 ${JWT}`, bare)).toBe(`a# ${JWT.replace(/\d/g, '#')}`);
        expect(sanitizeJson({ password: 'p' }, bare)).toEqual({ password: 'p' });
    });

    test('a field rule can replace with a description instead of the mask', () => {
        const media = defineRules({ fields: [fieldRule('document-media', ['documentMedia'], value => `<media ${String(value).length} chars>`)] });
        expect(sanitizeJson({ documentMedia: 'JVBERi0xLjQ', other: 1 }, media)).toEqual({ documentMedia: '<media 11 chars>', other: 1 });
    });

    test('text rules get the global flag; a regex given with it is used as is', () => {
        expect(textRule('a', /x/, 'y').pattern.flags).toContain('g');
        expect(textRule('b', /x/gi, 'y').pattern.flags).toBe('gi');
        expect(sanitizeText('x x x', defineRules({ text: [textRule('c', /x/, 'y')] }, emptyRules))).toBe('y y y');
    });
});

test.describe('registered secrets', () => {
    test('are removed literally, longest first, and short values are ignored', () => {
        registerSecrets('hunter2', 'hunter22', 'ab', undefined, null);
        expect(registeredSecretCount()).toBe(2);
        expect(sanitizeText('hunter22 and hunter2 and ab', defaultRules)).toBe('*** and *** and ab');
        clearRegisteredSecrets();
        expect(registeredSecretCount()).toBe(0);
        expect(sanitizeText('hunter2', defaultRules)).toBe('hunter2');
    });

    test('apply inside structured values, headers, URLs and error messages', () => {
        registerSecrets('s3cr3t-value');
        const config = resolveConfig();
        expect(sanitizeJson({ note: 'is s3cr3t-value' }, defaultRules)).toEqual({ note: 'is ***' });
        expect(sanitizeHeaderMap({ 'X-Custom': 'v=s3cr3t-value' }, config)).toEqual({ 'X-Custom': 'v=***' });
        expect(sanitizeRequestUrl('https://h.test/p?x=s3cr3t-value', config)).toBe('https://h.test/p?x=***');
        expect(sanitizeErrorMessage(new Error('failed with s3cr3t-value'), config).message).toBe('failed with ***');
    });
});

test.describe('layers over each input', () => {
    const config = resolveConfig({ maskHeaders: ['x-mine'], maskQueryParams: ['q'], maskBodyFields: ['f'] });

    test('headers: by name, then text rules, then leak check', () => {
        expect(sanitizeHeaderMap({ Authorization: 'Bearer x', 'X-Mine': 'v', Plain: `p ${JWT}` }, config)).toEqual({
            Authorization: MASK, 'X-Mine': MASK, Plain: 'p <jwt>',
        });
    });

    test('query: URL and params merged, repeated names joined, masked by name', () => {
        expect(sanitizeQuery('https://h.test/?a=1&q=secret&a=2', { b: 3, q: 'again' }, config)).toEqual({ a: '1, 2', q: `${MASK}, ${MASK}`, b: '3' });
        expect(sanitizeQuery('https://h.test/?a=1', new URLSearchParams('c=4'), config)).toEqual({ a: '1', c: '4' });
        expect(sanitizeQuery('https://h.test/?a=1', 'd=5', config)).toEqual({ a: '1', d: '5' });
    });

    test('a masked query parameter is masked inside free text and JSON strings too', () => {
        expect(sanitizeHeaderMap({ Location: 'https://h.test/cb?q=secret&state=1' }, config)).toEqual({ Location: 'https://h.test/cb?q=***&state=1' });
        const view = sanitizeBody({ data: { next: '/page?Q=secret&keep=1', plain: 'q=notaquery' }, contentType: 'application/json' }, config);
        expect(view.text).toContain('&quot;next&quot;: &quot;/page?Q=***&amp;keep=1&quot;'.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        expect(view.text).toContain('"plain": "q=notaquery"');
    });

    test('URL: masked values keep their name, the rest of the URL is intact', () => {
        expect(sanitizeRequestUrl('https://h.test/a/b?q=secret&keep=1#frag', config)).toBe('https://h.test/a/b?q=***&keep=1#frag');
        expect(sanitizeRequestUrl('/relative?q=secret&keep=1', config)).toBe('/relative?q=***&keep=1');
        expect(sanitizeRequestUrl('not a url', config)).toBe('not a url');
    });

    test('body: JSON masked by name and rule before truncation; the truncated body cannot end inside a secret', () => {
        const small = resolveConfig({ maskBodyFields: ['f'], maxBodyChars: 40 });
        const view = sanitizeBody({ data: { f: 'secret-value-that-is-long', password: 'p', text: 'x'.repeat(100) }, contentType: 'application/json' }, small);
        expect(view.kind).toBe('json');
        expect(view.truncated).toBe(true);
        expect(view.text.length).toBe(40);
        expect(view.text).not.toContain('secret-value');
        expect(view.omittedChars).toBeGreaterThan(0);
    });

    test('body: kinds by content type and sniffing', () => {
        expect(sanitizeBody({ data: undefined }, config).kind).toBe('empty');
        expect(sanitizeBody({ data: '' }, config).kind).toBe('empty');
        expect(sanitizeBody({ data: '{"a":1}' }, config).kind).toBe('json');
        expect(sanitizeBody({ data: '<?xml version="1.0"?><a/>' }, config).kind).toBe('xml');
        expect(sanitizeBody({ data: '<p>hi</p>', contentType: 'text/html; charset=utf-8' }, config).kind).toBe('html');
        expect(sanitizeBody({ data: 'hello', contentType: 'text/plain' }, config).kind).toBe('text');
        expect(sanitizeBody({ data: Buffer.from([0, 1, 2, 3]) }, config).kind).toBe('binary');
        expect(sanitizeBody({ data: Buffer.from('abc'), contentType: 'image/png' }, config).kind).toBe('binary');
        expect(sanitizeBody({ data: '%PDF-1.4 ...' }, config)).toMatchObject({ kind: 'binary', contentType: 'application/pdf' });
        expect(sanitizeBody({ data: { a: 1 }, source: 'form' }, config)).toMatchObject({ kind: 'form', text: 'a=1' });
        expect(sanitizeBody({ data: { f: 'x', g: 'y' }, source: 'multipart' }, config)).toMatchObject({ kind: 'multipart', text: `f: ${MASK}\ng: y` });
    });

    test('body: a form field is masked by configured name or by a field rule', () => {
        expect(sanitizeBody({ data: { f: 'x', clientSecret: 'y', ok: 'z' }, source: 'form' }, config).text).toBe(`f=${MASK}\nclientSecret=${MASK}\nok=z`);
    });

    test('error messages lose their ANSI colours and masked header lines', () => {
        const config = resolveConfig();
        const message = `\u001b[2mRequest timed out\u001b[22m\n  - authorization: Bearer ${JWT}\n  - accept: */*`;
        expect(sanitizeErrorMessage({ name: 'TimeoutError', message }, config)).toEqual({
            name: 'TimeoutError',
            message: 'Request timed out\n  - authorization: ***\n  - accept: */*',
        });
        expect(sanitizeErrorMessage(undefined, config)).toEqual({ name: 'Error', message: 'undefined' });
        expect(sanitizeErrorMessage('plain string', config)).toEqual({ name: 'Error', message: 'plain string' });
    });
});
