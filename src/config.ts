import { defaultRules, type SanitizeRules } from './rules.js';

/**
 * Configuration for the API request/response pages. Every value has three sources, highest first:
 *
 *   1. the options given to `withApiReporting(ctx, options)` / `reportApiCall(record, options)`;
 *   2. the `API_REPORT_*` environment variables, read PER CALL so a CI step or a test can change
 *      them without a config change;
 *   3. the defaults below.
 *
 *   API_REPORT_ENABLED=false                 switch the pages off (default: on)
 *   API_REPORT_LAYOUT=test|call              one page per TEST with every call (default), or one page per call
 *   API_REPORT_MAX_PAGE_BYTES=8388608        per-test page cap; later calls are listed without bodies (default: 8 MB)
 *   API_REPORT_MAX_BODY_CHARS=65536          per-body cap, after sanitizing (default: 64 KB)
 *   API_REPORT_MAX_RAW_BYTES=2097152         a body larger than this is described, never parsed (default: 2 MB)
 *   API_REPORT_MAX_PER_TEST=200              calls reported per test; later calls are counted, not shown
 *   API_REPORT_MASK_HEADERS=a,b              header names masked IN ADDITION to the defaults
 *   API_REPORT_MASK_QUERY_PARAMS=a,b         query parameter names masked in addition to the defaults
 *   API_REPORT_MASK_BODY_FIELDS=a,b          JSON / form field names masked in addition to the defaults
 *   API_REPORT_SHOW_BODIES=false             replace every body by its size and type (most conservative)
 *   API_REPORT_ATTACHMENT_NAME=…             the per-test attachment's name (default: "API requests and responses.html")
 *   API_REPORT_DEBUG=true                    print reporting warnings to stderr when no `onWarning` is given
 *
 * `enabled` is read when a context is wrapped (a disabled run gets the ORIGINAL context back, no proxy);
 * everything else is read per call. Names are matched case-insensitively.
 */

export type ApiReportLayout = 'test' | 'call';

/** What a consumer may pass. Every field is optional and falls back to its environment variable, then to the default. */
export interface ApiReportingOptions {
    /** Shown on the page and useful to tell wrapped contexts apart: `orders-api`, `checkout-api`. */
    client?: string;
    enabled?: boolean;
    layout?: ApiReportLayout;
    maxPageBytes?: number;
    maxBodyChars?: number;
    maxRawBytes?: number;
    maxPerTest?: number;
    showBodies?: boolean;
    /** Header names masked in addition to the defaults and the environment's. */
    maskHeaders?: readonly string[];
    maskQueryParams?: readonly string[];
    maskBodyFields?: readonly string[];
    /** Text / field / leak rules. Defaults to {@link defaultRules}; build on them with `defineRules`. */
    rules?: SanitizeRules;
    /** The per-test attachment's name. Must end in `.html` to open rendered in the HTML report. */
    attachmentName?: string;
    /** Receives one line per reporting problem (never thrown, never fails a test). */
    onWarning?: (message: string) => void;
}

/** The resolved configuration one call runs with. */
export interface ApiReportConfig {
    enabled: boolean;
    layout: ApiReportLayout;
    /** Per-test page cap: once reached, later calls keep their index row and headers but lose their bodies. */
    maxPageBytes: number;
    maxBodyChars: number;
    /** A body above this many bytes is described by size and type only — never parsed, copied or regexed. */
    maxRawBytes: number;
    maxPerTest: number;
    showBodies: boolean;
    /** Lower-cased. */
    maskHeaders: ReadonlySet<string>;
    /** Lower-cased. */
    maskQueryParams: ReadonlySet<string>;
    /** Lower-cased. */
    maskBodyFields: ReadonlySet<string>;
    rules: SanitizeRules;
    attachmentName: string;
    onWarning: (message: string) => void;
}

export const DEFAULT_MASKED_HEADERS: readonly string[] = [
    'authorization', 'proxy-authorization', 'www-authenticate',
    'cookie', 'set-cookie',
    'token', 'x-auth-token', 'x-access-token', 'x-refresh-token', 'x-session-token', 'x-session-id',
    'x-api-key', 'api-key', 'apikey', 'x-csrf-token', 'x-xsrf-token',
];

export const DEFAULT_MASKED_QUERY_PARAMS: readonly string[] = [
    'token', 'access_token', 'refresh_token', 'id_token', 'api_key', 'apikey', 'key', 'secret',
    'password', 'pwd', 'otp', 'code', 'signature', 'sig', 'session', 'sessionid', 'session_id',
];

export const DEFAULT_MASKED_BODY_FIELDS: readonly string[] = [
    'password', 'newpassword', 'oldpassword', 'confirmpassword', 'currentpassword',
    'token', 'accesstoken', 'access_token', 'refreshtoken', 'refresh_token', 'idtoken', 'id_token',
    'authorization', 'cookie', 'set-cookie', 'apikey', 'api_key', 'x-api-key', 'secret', 'clientsecret', 'client_secret',
    'otp', 'otpcode', 'otp_code', 'pin', 'pincode', 'privatekey', 'private_key', 'signature', 'credentials',
];

export const DEFAULT_ATTACHMENT_NAME = 'API requests and responses.html';

const DEFAULT_MAX_BODY_CHARS = 64 * 1024;
const DEFAULT_MAX_RAW_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_PAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_PER_TEST = 200;

function flag(name: string, fallback: boolean): boolean {
    const raw = process.env[name]?.trim().toLowerCase();
    if (raw === undefined || raw === '') return fallback;
    return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function positiveInt(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nameSet(defaults: readonly string[], envName: string, extra: readonly string[] | undefined): ReadonlySet<string> {
    const fromEnv = (process.env[envName] ?? '').split(',');
    return new Set([...defaults, ...fromEnv, ...(extra ?? [])].map(name => name.trim().toLowerCase()).filter(Boolean));
}

function positiveOption(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

const silent = (): void => undefined;
const stderr = (message: string): void => { console.warn(`[callcanvas] ${message}`); };

/** The live configuration for one call: options over environment over defaults. Cheap; nothing is cached. */
export function resolveConfig(options: ApiReportingOptions = {}): ApiReportConfig {
    const envLayout = process.env.API_REPORT_LAYOUT?.trim().toLowerCase();
    return {
        enabled: options.enabled ?? flag('API_REPORT_ENABLED', true),
        layout: options.layout ?? (envLayout === 'call' ? 'call' : 'test'),
        maxPageBytes: positiveOption(options.maxPageBytes, positiveInt('API_REPORT_MAX_PAGE_BYTES', DEFAULT_MAX_PAGE_BYTES)),
        maxBodyChars: positiveOption(options.maxBodyChars, positiveInt('API_REPORT_MAX_BODY_CHARS', DEFAULT_MAX_BODY_CHARS)),
        maxRawBytes: positiveOption(options.maxRawBytes, positiveInt('API_REPORT_MAX_RAW_BYTES', DEFAULT_MAX_RAW_BYTES)),
        maxPerTest: positiveOption(options.maxPerTest, positiveInt('API_REPORT_MAX_PER_TEST', DEFAULT_MAX_PER_TEST)),
        showBodies: options.showBodies ?? flag('API_REPORT_SHOW_BODIES', true),
        maskHeaders: nameSet(DEFAULT_MASKED_HEADERS, 'API_REPORT_MASK_HEADERS', options.maskHeaders),
        maskQueryParams: nameSet(DEFAULT_MASKED_QUERY_PARAMS, 'API_REPORT_MASK_QUERY_PARAMS', options.maskQueryParams),
        maskBodyFields: nameSet(DEFAULT_MASKED_BODY_FIELDS, 'API_REPORT_MASK_BODY_FIELDS', options.maskBodyFields),
        rules: options.rules ?? defaultRules,
        attachmentName: options.attachmentName?.trim() || process.env.API_REPORT_ATTACHMENT_NAME?.trim() || DEFAULT_ATTACHMENT_NAME,
        onWarning: options.onWarning ?? (flag('API_REPORT_DEBUG', false) ? stderr : silent),
    };
}

/** The configuration with no options: environment and defaults only. */
export function apiReportConfig(): ApiReportConfig {
    return resolveConfig();
}

/** True unless the options or `API_REPORT_ENABLED` say otherwise. The one check every entry point makes first. */
export function apiReportEnabled(options: ApiReportingOptions = {}): boolean {
    return options.enabled ?? flag('API_REPORT_ENABLED', true);
}
