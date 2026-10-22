/**
 * CallCanvas — visual API reporting for Playwright: sanitized request/response pages in the native
 * Playwright report. Every API call. One clear view.
 *
 * Entry point: {@link withApiReporting}, applied once to every `APIRequestContext` whose traffic should
 * be on the report. See README.md.
 */
export { withApiReporting, reportApiCall, type CallRecord } from './capture.js';
export {
    resolveConfig,
    apiReportConfig,
    apiReportEnabled,
    DEFAULT_MASKED_HEADERS,
    DEFAULT_MASKED_QUERY_PARAMS,
    DEFAULT_MASKED_BODY_FIELDS,
    DEFAULT_ATTACHMENT_NAME,
    type ApiReportingOptions,
    type ApiReportConfig,
    type ApiReportLayout,
} from './config.js';
export {
    defaultRules,
    emptyRules,
    defineRules,
    withoutRules,
    textRule,
    fieldRule,
    leakCheck,
    MASK,
    JWT_PATTERN,
    BASE64_PDF_PATTERN,
    LONG_BASE64_PATTERN,
    EMAIL_PATTERN,
    CREDENTIAL_KEY_PATTERN,
    type SanitizeRules,
    type TextRule,
    type FieldRule,
    type LeakCheck,
} from './rules.js';
export { registerSecrets, clearRegisteredSecrets, registeredSecretCount, redactSecrets } from './secrets.js';
export {
    sanitizeText,
    sanitizeJson,
    assertNoSecrets,
    sanitizeBody,
    sanitizeHeaderMap,
    sanitizeQuery,
    sanitizeRequestUrl,
    sanitizeErrorMessage,
    LeakError,
    type RawBody,
} from './sanitize.js';
export { renderApiTransactionHtml, renderApiReportPage, renderCallSection, highlightJson, type ApiReportMeta, type CallSummary } from './render.js';
export type { ApiTransaction, BodyView, RequestView, ResponseView, ErrorView, BodyKind } from './model.js';
export { fromFetchResponse, type FetchResponseLike } from './adapters.js';
