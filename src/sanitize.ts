import type { ApiReportConfig } from './config.js';
import type { BodyKind, BodyView } from './model.js';
import { MASK, type SanitizeRules } from './rules.js';
import { redactSecrets } from './secrets.js';

/**
 * The ONE place a page's text is made safe to publish. Three layers, applied in this order:
 *
 *  1. masking by NAME from the configuration — headers, query parameters and body fields whose name
 *     is on a mask list become `***`, whatever their value looks like;
 *  2. the rules (./rules.ts) — registered secrets first, then every text rule over free text and every
 *     field rule over structured bodies: JWTs, base64 blobs, e-mails, credential-like keys, and whatever
 *     the consumer added;
 *  3. a leak check on the result — a text that still trips one is NOT shown; the page says which check
 *     failed instead. Nothing here throws to the caller.
 *
 * Bodies are masked field by field BEFORE they are cut to size, so a truncated body cannot end inside
 * a secret. Binary bodies (PDF, images, archives, spreadsheets) are never decoded: size and type only.
 */

export { MASK };

export class LeakError extends Error {
    constructor(message: string, readonly rule: string) {
        super(message);
        this.name = 'LeakError';
    }
}

const ANSI = /\u001b\[[0-9;]*m/g;

const JSON_TYPE = /json|\+json/i;
const XML_TYPE = /xml|\+xml/i;
const HTML_TYPE = /text\/html|application\/xhtml/i;
const TEXT_TYPE = /^text\/|javascript|x-www-form-urlencoded/i;
const BINARY_TYPE = /pdf|image\/|audio\/|video\/|octet-stream|zip|gzip|msword|excel|spreadsheet|officedocument|font\/|protobuf/i;

function isMasked(name: string, names: ReadonlySet<string>): boolean {
    return names.has(name.trim().toLowerCase());
}

/** Free text: registered secrets removed, then every text rule in order. The rules' own job, exposed for reuse. */
export function sanitizeText(text: string, rules: SanitizeRules): string {
    if (typeof text !== 'string' || text === '') return text;
    let out = redactSecrets(text);
    for (const rule of rules.text) {
        rule.pattern.lastIndex = 0;
        out = typeof rule.replace === 'string'
            ? out.replace(rule.pattern, rule.replace)
            : out.replace(rule.pattern, rule.replace);
    }
    return out;
}

/** Deep copy with field rules applied by key and every string through {@link sanitizeText}. Keys are kept. */
export function sanitizeJson(value: unknown, rules: SanitizeRules): unknown {
    if (typeof value === 'string') return sanitizeText(value, rules);
    if (Array.isArray(value)) return value.map(item => sanitizeJson(item, rules));
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
            const rule = rules.fields.find(candidate => candidate.matches(key, inner));
            out[key] = rule ? (rule.replace ? rule.replace(inner, key) : MASK) : sanitizeJson(inner, rules);
        }
        return out;
    }
    return value;
}

/** Throws a {@link LeakError} naming the first leak check the text still trips. */
export function assertNoSecrets(text: string, rules: SanitizeRules): void {
    for (const check of rules.leaks) {
        check.pattern.lastIndex = 0;
        if (check.pattern.test(text)) throw new LeakError(check.message, check.name);
    }
}

/** Headers: masked names → `***`; the rest sanitized as free text. Original casing kept. */
export function sanitizeHeaderMap(headers: Record<string, string> | undefined, config: ApiReportConfig): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers ?? {})) {
        out[name] = isMasked(name, config.maskHeaders) ? MASK : checked(safeText(String(value), config), config);
    }
    return out;
}

/**
 * A URL with its masked query values replaced, then the text rules. A value that is not a parseable
 * URL (a relative path, a bare string) is treated as free text.
 */
export function sanitizeRequestUrl(url: string, config: ApiReportConfig): string {
    let parsed: URL | undefined;
    try {
        parsed = new URL(url);
    } catch {
        return safeText(maskQueryString(url, config), config);
    }
    const masked = new URLSearchParams();
    for (const [name, value] of parsed.searchParams) {
        masked.append(name, isMasked(name, config.maskQueryParams) ? MASK : value);
    }
    parsed.search = masked.toString() ? `?${masked.toString()}` : '';
    return safeText(parsed.toString(), config);
}

/** For a URL that does not parse: mask `name=value` pairs after the first `?` by name. */
function maskQueryString(url: string, config: ApiReportConfig): string {
    const at = url.indexOf('?');
    if (at < 0) return url;
    const query = url.slice(at + 1).split('&').map(pair => {
        const eq = pair.indexOf('=');
        const name = eq < 0 ? pair : pair.slice(0, eq);
        let decoded = name;
        try {
            decoded = decodeURIComponent(name);
        } catch {
            // A malformed %-sequence: match the raw name instead.
        }
        return isMasked(decoded, config.maskQueryParams) ? `${name}=${MASK}` : pair;
    });
    return `${url.slice(0, at)}?${query.join('&')}`;
}

/** The query parameters of a URL plus an options `params` value, sanitized by name. */
export function sanitizeQuery(url: string, params: unknown, config: ApiReportConfig): Record<string, string> {
    const pairs: Array<[string, string]> = [];
    try {
        for (const [name, value] of new URL(url).searchParams) pairs.push([name, value]);
    } catch {
        const at = url.indexOf('?');
        if (at >= 0) for (const [name, value] of new URLSearchParams(url.slice(at + 1))) pairs.push([name, value]);
    }
    if (typeof params === 'string') {
        for (const [name, value] of new URLSearchParams(params)) pairs.push([name, value]);
    } else if (params instanceof URLSearchParams) {
        for (const [name, value] of params) pairs.push([name, value]);
    } else if (params && typeof params === 'object') {
        for (const [name, value] of Object.entries(params as Record<string, unknown>)) pairs.push([name, String(value)]);
    }
    const out: Record<string, string> = {};
    for (const [name, value] of pairs) {
        const safe = isMasked(name, config.maskQueryParams) ? MASK : checked(safeText(value, config), config);
        out[name] = name in out ? `${out[name]}, ${safe}` : safe;
    }
    return out;
}

/** Deep copy with configured field names masked, then the rules' field and text rules. */
export function sanitizeStructured(value: unknown, config: ApiReportConfig): unknown {
    return sanitizeJson(maskFields(value, config.maskBodyFields), effectiveRules(config));
}

function maskFields(value: unknown, names: ReadonlySet<string>): unknown {
    if (Array.isArray(value)) return value.map(item => maskFields(item, names));
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
            out[key] = isMasked(key, names) ? MASK : maskFields(inner, names);
        }
        return out;
    }
    return value;
}

/** Free text through the rules, with masked query names covered wherever a URL appears in it. Never throws. */
export function safeText(text: string, config: ApiReportConfig): string {
    try {
        return sanitizeText(text, effectiveRules(config));
    } catch {
        return '[unsanitizable text withheld]';
    }
}

/**
 * The configured rules plus one derived text rule: a `name=value` pair of a masked query parameter
 * inside free text (a `Location` header, a URL echoed in a body, a call log) is masked by name too,
 * so the URL-level masking cannot be undone by a response that repeats the URL.
 */
function effectiveRules(config: ApiReportConfig): SanitizeRules {
    const cached = derived.get(config);
    if (cached) return cached;
    const names = [...config.maskQueryParams].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const rules: SanitizeRules = names.length === 0 ? config.rules : {
        ...config.rules,
        text: [
            { name: 'masked-query-params-in-text', pattern: new RegExp(`([?&])(${names.join('|')})=([^&#\\s"'<>]*)`, 'gi'), replace: `$1$2=${MASK}` },
            ...config.rules.text,
        ],
    };
    derived.set(config, rules);
    return rules;
}
const derived = new WeakMap<ApiReportConfig, SanitizeRules>();

/** A message from a failed call: Playwright's call log lists the request headers, so it is sanitized too. */
export function sanitizeErrorMessage(error: unknown, config: ApiReportConfig): { name: string; message: string } {
    const e = error as { name?: unknown; message?: unknown } | undefined;
    const name = typeof e?.name === 'string' && e.name !== '' ? e.name : 'Error';
    // Playwright colours its call log; the page is not a terminal.
    let message = safeText(String(e?.message ?? error).replace(ANSI, ''), config);
    // Belt and braces: a header line in the call log ("  - token: eyJ…") whose name is masked.
    message = message.replace(/^( {0,8}-? {0,8})([A-Za-z0-9_-]+): ?(.+)$/gm, (line, lead: string, header: string) =>
        isMasked(header, config.maskHeaders) ? `${lead}${header}: ${MASK}` : line);
    return { name, message: checked(message, config) };
}

export interface RawBody {
    /** Bytes or text as sent / received. `undefined` when there was no body. */
    data?: Buffer | string | object | null;
    contentType?: string;
    /** For a request: which option carried the body. */
    source?: 'data' | 'form' | 'multipart';
}

/**
 * A body on its way to the page. The kind comes from the content type first and from a sniff of the
 * bytes second; JSON and form bodies are masked field by field; XML, HTML and text are sanitized as
 * free text; binary is described, never decoded.
 */
export function sanitizeBody(raw: RawBody, config: ApiReportConfig): BodyView {
    const contentType = raw.contentType?.split(';')[0].trim().toLowerCase() || undefined;
    try {
        if (raw.data === undefined || raw.data === null) return { kind: 'empty', text: '', bytes: 0, contentType };
        if (raw.source === 'multipart') return multipartView(raw.data, contentType, config);
        if (raw.source === 'form') return formView(raw.data, contentType, config);

        const bytes = Buffer.isBuffer(raw.data) ? raw.data : typeof raw.data === 'string'
            ? Buffer.from(raw.data, 'utf8')
            : Buffer.from(JSON.stringify(raw.data), 'utf8');
        if (bytes.length === 0) return { kind: 'empty', text: '', bytes: 0, contentType };
        if (bytes.length > config.maxRawBytes) {
            // Never parsed, copied or regexed: the sanitizer's cost grows with the body, and a body this
            // size is not something a reader scrolls through anyway.
            return { kind: 'hidden', text: `<${contentType ?? 'body'} ${bytes.length} bytes — larger than API_REPORT_MAX_RAW_BYTES (${config.maxRawBytes}), not shown>`, bytes: bytes.length, contentType };
        }
        if (!config.showBodies) {
            return { kind: 'hidden', text: `<${contentType ?? 'body'} ${bytes.length} bytes — hidden by API_REPORT_SHOW_BODIES=false>`, bytes: bytes.length, contentType };
        }
        if (contentType && BINARY_TYPE.test(contentType) && !JSON_TYPE.test(contentType)) return binaryView(bytes, contentType);
        if (!contentType && looksBinary(bytes)) return binaryView(bytes, contentType);

        const text = bytes.toString('utf8');
        if (text.trimStart().startsWith('%PDF')) return binaryView(bytes, contentType ?? 'application/pdf');

        const structured = typeof raw.data === 'object' && !Buffer.isBuffer(raw.data) ? raw.data : tryParseJson(text);
        const jsonLike = !contentType || JSON_TYPE.test(contentType) || /^\s*[[{]/.test(text) && !XML_TYPE.test(contentType) && !HTML_TYPE.test(contentType);
        if (structured !== undefined && jsonLike) {
            const pretty = JSON.stringify(sanitizeStructured(structured, config), null, 2);
            return limit({ kind: 'json', text: checked(pretty, config), bytes: bytes.length, contentType }, config);
        }
        const kind: BodyKind = contentType && HTML_TYPE.test(contentType) ? 'html'
            : contentType && XML_TYPE.test(contentType) || /^\s*<\?xml/i.test(text) ? 'xml'
            : contentType && !TEXT_TYPE.test(contentType) && looksBinary(bytes) ? 'binary'
            : 'text';
        if (kind === 'binary') return binaryView(bytes, contentType);
        return limit({ kind, text: checked(safeText(text, config), config), bytes: bytes.length, contentType }, config);
    } catch (error) {
        return { kind: 'hidden', text: '', contentType, note: `Body withheld: ${(error as Error)?.message ?? error}` };
    }
}

function formView(data: unknown, contentType: string | undefined, config: ApiReportConfig): BodyView {
    const entries: Array<[string, string]> = [];
    if (isFormData(data)) {
        data.forEach((value, name) => { entries.push([name, typeof value === 'string' ? value : '<file>']); });
    } else {
        for (const [name, value] of Object.entries((data ?? {}) as Record<string, unknown>)) entries.push([name, String(value)]);
    }
    const lines = entries.map(([name, value]) =>
        `${name}=${isMaskedField(name, value, config) ? MASK : safeText(value, config)}`);
    return limit({ kind: 'form', text: checked(lines.join('\n'), config), contentType: contentType ?? 'application/x-www-form-urlencoded' }, config);
}

function multipartView(data: unknown, contentType: string | undefined, config: ApiReportConfig): BodyView {
    const lines: string[] = [];
    const describe = (name: string, value: unknown) => {
        if (isMaskedField(name, value, config)) return `${name}: ${MASK}`;
        if (typeof value === 'string') return `${name}: ${safeText(value, config)}`;
        if (Buffer.isBuffer(value)) return `${name}: <${value.length} bytes>`;
        const file = value as { name?: string; mimeType?: string; buffer?: Buffer; size?: number; type?: string } | null;
        const size = file?.buffer?.length ?? file?.size;
        return `${name}: <file ${safeText(String(file?.name ?? ''), config)}${file?.mimeType ?? file?.type ? `, ${file?.mimeType ?? file?.type}` : ''}${size !== undefined ? `, ${size} bytes` : ''}>`;
    };
    if (isFormData(data)) {
        data.forEach((value, name) => { lines.push(describe(name, value)); });
    } else if (data && typeof data === 'object') {
        for (const [name, value] of Object.entries(data as Record<string, unknown>)) lines.push(describe(name, value));
    }
    return limit({ kind: 'multipart', text: checked(lines.join('\n'), config), contentType: contentType ?? 'multipart/form-data' }, config);
}

/** A form / multipart field is masked by the configured names OR by a field rule (the same two layers JSON gets). */
function isMaskedField(name: string, value: unknown, config: ApiReportConfig): boolean {
    return isMasked(name, config.maskBodyFields) || config.rules.fields.some(rule => rule.matches(name, value));
}

interface FormDataLike { forEach(callback: (value: unknown, name: string) => void): void }

function isFormData(data: unknown): data is FormDataLike {
    const FormDataCtor = (globalThis as { FormData?: new () => unknown }).FormData;
    return typeof FormDataCtor === 'function' && data instanceof FormDataCtor;
}

function binaryView(bytes: Buffer, contentType: string | undefined): BodyView {
    return {
        kind: 'binary',
        text: `<binary ${contentType ?? 'body'} — ${bytes.length} bytes, not shown>`,
        bytes: bytes.length,
        contentType,
    };
}

function looksBinary(bytes: Buffer): boolean {
    const sample = bytes.subarray(0, 512);
    let suspicious = 0;
    for (const byte of sample) {
        if (byte === 0) return true;
        if (byte < 7 || (byte > 13 && byte < 32)) suspicious++;
    }
    return sample.length > 0 && suspicious / sample.length > 0.1;
}

function tryParseJson(text: string): unknown {
    const trimmed = text.trim();
    if (!trimmed || !/^[[{"\d\-tfn]/.test(trimmed)) return undefined;
    try {
        return JSON.parse(trimmed) as unknown;
    } catch {
        return undefined;
    }
}

/** Runs the leak checks; a failure replaces the text with the reason rather than publishing it. */
function checked(text: string, config: ApiReportConfig): string {
    try {
        assertNoSecrets(text, config.rules);
        return text;
    } catch (error) {
        return `[withheld — ${(error as Error)?.message ?? 'leak check failed'}]`;
    }
}

function limit(view: BodyView, config: ApiReportConfig): BodyView {
    if (view.text.length <= config.maxBodyChars) return view;
    return {
        ...view,
        text: view.text.slice(0, config.maxBodyChars),
        truncated: true,
        omittedChars: view.text.length - config.maxBodyChars,
    };
}
