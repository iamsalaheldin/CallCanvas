import { test, type APIRequestContext, type APIResponse, type TestInfo } from '@playwright/test';
import { apiReportEnabled, resolveConfig, type ApiReportConfig, type ApiReportingOptions } from './config.js';
import { appendToTestPage, attachCallPage, nextSequence } from './collector.js';
import type { ApiTransaction, BodyView, RequestView, ResponseView } from './model.js';
import {
    sanitizeBody,
    sanitizeErrorMessage,
    sanitizeHeaderMap,
    sanitizeQuery,
    sanitizeRequestUrl,
    safeText,
} from './sanitize.js';

/**
 * API request/response reporting for the native Playwright HTML report.
 *
 * {@link withApiReporting} returns a Proxy of an `APIRequestContext` whose `get` / `post` / `put` /
 * `patch` / `delete` / `head` / `fetch` time the call, read the response, and put it on a self-contained
 * HTML page attached to the running test — by default ONE page per test holding every call
 * (`layout: 'test'`), or one page per call (`layout: 'call'`).
 *
 * Guarantees a consumer can rely on:
 *  - the call's result and error are returned / rethrown exactly as Playwright produced them;
 *  - the response body is read with `body()`, which Playwright serves again to the caller — nothing is
 *    consumed;
 *  - nothing in here can fail a test: every reporting step is wrapped, and a failure is one `onWarning` line;
 *  - with reporting disabled the ORIGINAL context is returned, so a disabled run has no proxy at all;
 *  - outside a test (global setup) there is nothing to attach to, so the call just runs; a call made while
 *    a worker-scoped fixture is set up is attached to the test whose setup ran it, as Playwright does
 *    for every attachment made during fixture setup;
 *  - only contexts explicitly wrapped are reported — never `page.request`, never browser traffic.
 *
 * Attachments land under whatever `test.step` is open when the call is made.
 */

const REQUEST_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch']);
const BODY_OPTION_KEYS = new Set(['headers', 'params', 'data', 'form', 'multipart']);

/** Wraps `context` so every request it makes is reported. Returns `context` itself when reporting is off. */
export function withApiReporting(context: APIRequestContext, options: ApiReportingOptions = {}): APIRequestContext {
    if (!apiReportEnabled(options)) return context;
    return new Proxy(context, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value !== 'function') return value;
            if (typeof property !== 'string' || !REQUEST_METHODS.has(property)) return value.bind(target);
            return (...args: unknown[]) => reportedCall(target, property, value as (...a: unknown[]) => Promise<APIResponse>, args, options);
        },
    });
}

async function reportedCall(
    target: APIRequestContext,
    method: string,
    fn: (...args: unknown[]) => Promise<APIResponse>,
    args: unknown[],
    options: ApiReportingOptions,
): Promise<APIResponse> {
    // The test this call belongs to is the one running when it STARTS: a call on a worker-scoped
    // context that outlives its test must not be attached to whichever test is current when it lands.
    const testInfo = currentTestInfo();
    const startedAt = new Date();
    const started = Date.now();
    let response: APIResponse | undefined;
    let error: unknown;
    let threw = false;
    try {
        response = await fn.apply(target, args);
    } catch (e) {
        threw = true;
        error = e;
    }
    const durationMs = Date.now() - started;
    try {
        await reportApiCall({ method, args, response, error, startedAt, durationMs, testInfo }, options);
    } catch (reportError) {
        warn(options, `API report skipped: ${(reportError as Error)?.message ?? reportError}`);
    }
    if (threw) throw error;
    return response!;
}

function warn(options: ApiReportingOptions, message: string): void {
    try {
        resolveConfig(options).onWarning(message);
    } catch {
        // A failing warning callback is the consumer's problem, not the test's.
    }
}

/** One call to report by hand: what {@link withApiReporting} records for every proxied request. */
export interface CallRecord {
    /** The context method called: `get`, `post`, …, or `fetch` (then `args[1].method` names the HTTP method). */
    method: string;
    /** The arguments as given to the context method: `[url, options?]`. */
    args: unknown[];
    response?: APIResponse;
    error?: unknown;
    startedAt: Date;
    durationMs: number;
    /** The test to attach to. Defaults to the one running now; `null` when the call began outside any test. */
    testInfo?: TestInfo | null;
}

/**
 * Builds, sanitizes, renders and attaches one call. Exposed for a client that makes a call outside an
 * `APIRequestContext` (Node `fetch`, axios) and still wants it on the report: build a `CallRecord` with
 * an object that offers the `APIResponse` getters the page reads (`status`, `statusText`, `ok`,
 * `headers` / `headersArray`, `body`, `url`).
 */
export async function reportApiCall(record: CallRecord, options: ApiReportingOptions = {}): Promise<void> {
    const testInfo = record.testInfo === undefined ? currentTestInfo() : record.testInfo;
    if (!testInfo || testInfo !== currentTestInfo()) return;
    const config = resolveConfig(options);
    if (!config.enabled) return;

    const sequence = nextSequence(testInfo, config);
    if (sequence === undefined) return;

    const tx = await buildTransaction(record, sequence, options.client, config);
    if (config.layout === 'call') {
        await attachCallPage(testInfo, tx);
    } else {
        await appendToTestPage(testInfo, tx, config);
    }
}

function currentTestInfo(): TestInfo | null {
    try {
        return test.info();
    } catch {
        return null;
    }
}

async function buildTransaction(record: CallRecord, sequence: number, client: string | undefined, config: ApiReportConfig): Promise<ApiTransaction> {
    const [urlOrRequest, rawOptions] = record.args as [unknown, Record<string, unknown> | undefined];
    const options = rawOptions ?? {};
    const request = buildRequestView(record.method, urlOrRequest, options, config);
    const tx: ApiTransaction = {
        sequence,
        client,
        startedAt: record.startedAt.toISOString(),
        durationMs: record.durationMs,
        request,
    };
    if (record.response) tx.response = await buildResponseView(record.response, request.url, request.method, config);
    if (record.error !== undefined || !record.response) tx.error = sanitizeErrorMessage(record.error ?? new Error('No response'), config);
    return tx;
}

function buildRequestView(
    contextMethod: string,
    urlOrRequest: unknown,
    options: Record<string, unknown>,
    config: ApiReportConfig,
): RequestView {
    const requestLike = urlOrRequest as { url?: () => string; method?: () => string; headers?: () => Record<string, string> } | undefined;
    const rawUrl = typeof urlOrRequest === 'string' ? urlOrRequest
        : urlOrRequest instanceof URL ? urlOrRequest.toString()
        : typeof requestLike?.url === 'function' ? requestLike.url() : String(urlOrRequest);
    const method = contextMethod === 'fetch'
        ? String(options.method ?? (typeof requestLike?.method === 'function' ? requestLike.method() : 'GET')).toUpperCase()
        : contextMethod.toUpperCase();
    const rawHeaders = (options.headers as Record<string, string> | undefined)
        ?? (typeof requestLike?.headers === 'function' ? requestLike.headers() : undefined);
    const contentType = headerValue(rawHeaders, 'content-type');

    const body: BodyView = options.multipart !== undefined ? sanitizeBody({ data: options.multipart as object, contentType, source: 'multipart' }, config)
        : options.form !== undefined ? sanitizeBody({ data: options.form as object, contentType, source: 'form' }, config)
        : sanitizeBody({ data: options.data as RawData, contentType: contentType ?? (isStructured(options.data) ? 'application/json' : undefined), source: 'data' }, config);

    const optionRows: Record<string, string> = {};
    for (const [key, value] of Object.entries(options)) {
        if (BODY_OPTION_KEYS.has(key) || value === undefined) continue;
        optionRows[key] = safeText(typeof value === 'string' ? value : JSON.stringify(value) ?? String(value), config);
    }

    const url = sanitizeRequestUrl(rawUrl, config);
    return {
        method,
        url,
        path: pathOf(url),
        headers: sanitizeHeaderMap(rawHeaders, config),
        query: sanitizeQuery(rawUrl, options.params, config),
        body,
        options: optionRows,
    };
}

type RawData = Buffer | string | object | null | undefined;

function isStructured(data: unknown): boolean {
    return data !== null && typeof data === 'object' && !Buffer.isBuffer(data);
}

async function buildResponseView(response: APIResponse, requestUrl: string, method: string, config: ApiReportConfig): Promise<ResponseView> {
    const headerRows: Record<string, string> = {};
    let headerList: Array<{ name: string; value: string }> = [];
    try {
        headerList = typeof response.headersArray === 'function' ? response.headersArray() : [];
    } catch {
        headerList = [];
    }
    if (headerList.length === 0) {
        try {
            headerList = Object.entries(response.headers()).map(([name, value]) => ({ name, value }));
        } catch {
            headerList = [];
        }
    }
    for (const { name, value } of headerList) headerRows[name] = name in headerRows ? `${headerRows[name]}, ${value}` : value;

    const contentType = headerList.find(h => h.name.toLowerCase() === 'content-type')?.value;
    const declaredLength = Number(headerList.find(h => h.name.toLowerCase() === 'content-length')?.value);
    let body: BodyView;
    if (method === 'HEAD') {
        body = { kind: 'empty', text: '', bytes: 0, contentType };
    } else if (Number.isFinite(declaredLength) && declaredLength > config.maxRawBytes) {
        // Not even read: the caller reads it if it wants it.
        body = { kind: 'hidden', text: `<${contentType?.split(';')[0] ?? 'body'} ${declaredLength} bytes — larger than API_REPORT_MAX_RAW_BYTES (${config.maxRawBytes}), not shown>`, bytes: declaredLength, contentType };
    } else {
        let bytes: Buffer | undefined;
        try {
            bytes = await response.body();
        } catch {
            try {
                bytes = Buffer.from(await response.text(), 'utf8');
            } catch {
                bytes = undefined;
            }
        }
        body = bytes === undefined
            ? { kind: 'hidden', text: '', contentType, note: 'The response body could not be read.' }
            : sanitizeBody({ data: bytes, contentType }, config);
    }

    let finalUrl: string | undefined;
    try {
        const candidate = typeof response.url === 'function' ? sanitizeRequestUrl(response.url(), config) : undefined;
        if (candidate && candidate !== requestUrl) finalUrl = candidate;
    } catch {
        finalUrl = undefined;
    }

    return {
        status: safeNumber(() => response.status()),
        statusText: safeString(() => response.statusText()),
        ok: safeBoolean(() => response.ok(), false),
        headers: sanitizeHeaderMap(headerRows, config),
        body,
        url: finalUrl,
    };
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
    if (!headers) return undefined;
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === wanted) return value;
    return undefined;
}

function pathOf(url: string): string {
    try {
        return new URL(url).pathname || '/';
    } catch {
        return url.split('?')[0] || url;
    }
}

function safeNumber(read: () => number): number {
    try {
        return read();
    } catch {
        return 0;
    }
}

function safeString(read: () => string): string {
    try {
        return read() ?? '';
    } catch {
        return '';
    }
}

function safeBoolean(read: () => boolean, fallback: boolean): boolean {
    try {
        return read();
    } catch {
        return fallback;
    }
}
