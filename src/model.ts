/**
 * What one reported HTTP transaction looks like once it is safe to publish. Every string in here has
 * already been through the sanitizer (./sanitize.ts); the renderer (./render.ts) only escapes and lays out.
 */

export type BodyKind = 'json' | 'xml' | 'html' | 'text' | 'form' | 'multipart' | 'binary' | 'empty' | 'hidden';

export interface BodyView {
    kind: BodyKind;
    /** The sanitized, formatted text to show. Empty for `empty`, a one-line description for `binary` / `hidden`. */
    text: string;
    /** Size of the original body in bytes, when known. */
    bytes?: number;
    contentType?: string;
    /** Set when `text` was cut to the configured cap; `omittedChars` says by how much. */
    truncated?: boolean;
    omittedChars?: number;
    /** A reason the body is not shown as-is (binary, hidden by configuration, a leak check that failed). */
    note?: string;
}

export interface RequestView {
    method: string;
    /** The sanitized absolute URL, query included. */
    url: string;
    /** Path only — what the attachment title shows. */
    path: string;
    headers: Record<string, string>;
    /** Query parameters from the URL and from `options.params`, sanitized. Repeated names are joined. */
    query: Record<string, string>;
    body: BodyView;
    /** Request options other than headers, params and the body: timeout, maxRedirects, failOnStatusCode… */
    options: Record<string, string>;
}

export interface ResponseView {
    status: number;
    statusText: string;
    ok: boolean;
    headers: Record<string, string>;
    body: BodyView;
    /** The final URL, when a redirect was followed and it differs from the request URL. */
    url?: string;
}

export interface ErrorView {
    name: string;
    /** Sanitized: Playwright's call log carries the request headers. */
    message: string;
}

export interface ApiTransaction {
    /** 1-based order of this call within its test. */
    sequence: number;
    /** A caller-supplied name for the client that made the call (`orders-api`, `checkout-api`). */
    client?: string;
    startedAt: string;
    durationMs: number;
    request: RequestView;
    response?: ResponseView;
    error?: ErrorView;
}
