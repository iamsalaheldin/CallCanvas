import type { ApiTransaction, BodyView } from './model.js';

/**
 * Renders sanitized transactions as self-contained HTML: inline CSS, no script, no external resource.
 * Tabs are CSS-only (radio inputs) and call sections are native `<details>`, so the page works wherever
 * the Playwright HTML report opens it (a new tab, served from `playwright-report/data/`). Every value is
 * HTML-escaped on the way in — a response that is itself HTML is shown as text, never rendered.
 *
 * Two layouts share the same call section: one page per call ({@link renderApiTransactionHtml}) and one
 * page per test with every call stacked under a summary index ({@link renderApiReportPage}). The
 * per-test page is rewritten as calls arrive, so its sections are rendered once each and kept as strings.
 */

export interface ApiReportMeta {
    /** The test's title, shown as the page heading. */
    title: string;
    /** Project, file, or anything else worth a sub-line. */
    subtitle?: string;
}

/** The index row for one call on the per-test page. */
export interface CallSummary {
    sequence: number;
    method: string;
    path: string;
    status?: number;
    errorName?: string;
    durationMs: number;
    /** Set when the section's bodies were left out because the page reached its size cap. */
    bodiesOmitted?: boolean;
}

export function renderApiTransactionHtml(tx: ApiTransaction): string {
    const title = `${tx.request.method} ${tx.request.path} ${tx.response ? `→ ${tx.response.status}` : '✖ failed'}`;
    return page(title, `${hero(tx)}\n<main class="grid">\n${requestCard(tx, '')}\n${tx.response ? responseCard(tx, '') : errorCard(tx)}\n</main>`, footer([tx]));
}

/**
 * One call as a collapsible section of the per-test page. Open by default when it did not succeed, so a
 * reader lands on the interesting ones. `prefix` keeps the radio tab groups of every section apart.
 */
export function renderCallSection(tx: ApiTransaction): string {
    const prefix = `c${tx.sequence}-`;
    const ok = !!tx.response && tx.response.ok;
    const status = tx.response
        ? `<span class="status ${statusClass(tx.response.status)}">${tx.response.status}</span>`
        : `<span class="status s-error">✖ ${esc(tx.error?.name ?? 'failed')}</span>`;
    return `<details class="call" id="call-${tx.sequence}"${ok ? '' : ' open'}>
<summary>
  <span class="seq">#${tx.sequence}</span>
  <span class="method ${esc(tx.request.method.toLowerCase())}">${esc(tx.request.method)}</span>
  <code class="path">${esc(tx.request.path)}</code>
  ${status}
  <span class="chip">⏱ ${tx.durationMs} ms</span>
  ${tx.request.body.note || tx.response?.body.note ? '<span class="chip dim">bodies omitted</span>' : ''}
</summary>
<div class="call-body">
  <div class="row"><code class="url">${esc(tx.request.url)}</code><span class="chip dim">${esc(tx.startedAt)}</span>${tx.client ? `<span class="chip dim">${esc(tx.client)}</span>` : ''}</div>
  <main class="grid">
${requestCard(tx, prefix)}
${tx.response ? responseCard(tx, prefix) : errorCard(tx)}
  </main>
</div>
</details>`;
}

/** The per-test page: heading, totals, an index of every call, then the rendered sections. */
export function renderApiReportPage(meta: ApiReportMeta, summaries: CallSummary[], sections: string[]): string {
    const failed = summaries.filter(c => c.errorName || (c.status ?? 0) >= 400).length;
    const totalMs = summaries.reduce((sum, c) => sum + c.durationMs, 0);
    const index = summaries.map(c => `<tr>
<td><a href="#call-${c.sequence}">#${c.sequence}</a></td>
<td><span class="method ${esc(c.method.toLowerCase())}">${esc(c.method)}</span></td>
<td><code>${esc(c.path)}</code></td>
<td>${c.status !== undefined ? `<span class="status ${statusClass(c.status)}">${c.status}</span>` : `<span class="status s-error">✖ ${esc(c.errorName ?? 'failed')}</span>`}</td>
<td class="num">${c.durationMs} ms</td>
</tr>`).join('\n');
    const body = `<header class="hero">
  <h1>${esc(meta.title)}</h1>
  ${meta.subtitle ? `<div class="sub">${esc(meta.subtitle)}</div>` : ''}
  <div class="row meta">
    <span class="chip">${summaries.length} API call${summaries.length === 1 ? '' : 's'}</span>
    <span class="chip ${failed ? 'bad' : 'good'}">${failed} failed</span>
    <span class="chip">⏱ ${totalMs} ms in requests</span>
  </div>
</header>
<section class="card index">
  <h2>Calls</h2>
  <div class="scroll"><table>${index}</table></div>
</section>
${sections.join('\n')}`;
    return page(`API calls — ${meta.title}`, body, footer(undefined, summaries.some(c => c.bodiesOmitted)));
}

function page(title: string, body: string, foot: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
${body}
${foot}
</body>
</html>`;
}

function footer(txs?: ApiTransaction[], pageCapReached = false): string {
    const truncated = txs?.some(tx => tx.request.body.truncated || tx.response?.body.truncated);
    return `<footer>
  <span>Masked values are shown as <code>***</code>. Headers are the ones the test set explicitly.</span>
  ${truncated ? '<span>Bodies are cut at the configured size (API_REPORT_MAX_BODY_CHARS).</span>' : ''}
  ${pageCapReached ? '<span>Later calls are listed without bodies: the page reached API_REPORT_MAX_PAGE_BYTES.</span>' : ''}
</footer>`;
}

function hero(tx: ApiTransaction): string {
    const status = tx.response
        ? `<span class="status ${statusClass(tx.response.status)}" title="HTTP status">${tx.response.status} ${esc(tx.response.statusText || statusWord(tx.response.status))}</span>`
        : `<span class="status s-error" title="No HTTP response">✖ ${esc(tx.error?.name ?? 'Request failed')}</span>`;
    return `<header class="hero">
  <div class="row">
    <span class="method ${esc(tx.request.method.toLowerCase())}">${esc(tx.request.method)}</span>
    <code class="url">${esc(tx.request.url)}</code>
  </div>
  <div class="row meta">
    ${status}
    <span class="chip" title="Wall-clock duration">⏱ ${tx.durationMs} ms</span>
    <span class="chip" title="Call number within the test">#${tx.sequence}</span>
    ${tx.client ? `<span class="chip" title="API client">${esc(tx.client)}</span>` : ''}
    <span class="chip dim" title="Started at">${esc(tx.startedAt)}</span>
  </div>
</header>`;
}

function requestCard(tx: ApiTransaction, prefix: string): string {
    const r = tx.request;
    return card('Request', `${prefix}req`, [
        { id: 'body', label: 'Body', badge: bodyBadge(r.body), html: bodyPanel(r.body) },
        { id: 'headers', label: 'Headers', badge: String(Object.keys(r.headers).length), html: tablePanel(r.headers, 'No request headers were set explicitly.') },
        { id: 'params', label: 'Params', badge: String(Object.keys(r.query).length), html: tablePanel(r.query, 'No query parameters.') },
        { id: 'options', label: 'Options', badge: String(Object.keys(r.options).length), html: tablePanel(r.options, 'Default request options.') },
    ]);
}

function responseCard(tx: ApiTransaction, prefix: string): string {
    const s = tx.response!;
    const info: Record<string, string> = {
        Status: `${s.status} ${s.statusText}`,
        OK: s.ok ? 'yes' : 'no',
        Duration: `${tx.durationMs} ms`,
        'Content-Type': s.body.contentType ?? '—',
        'Body size': s.body.bytes !== undefined ? `${s.body.bytes} bytes` : '—',
        ...(s.url ? { 'Final URL': s.url } : {}),
    };
    return card('Response', `${prefix}res`, [
        { id: 'body', label: 'Body', badge: bodyBadge(s.body), html: bodyPanel(s.body) },
        { id: 'headers', label: 'Headers', badge: String(Object.keys(s.headers).length), html: tablePanel(s.headers, 'No response headers.') },
        { id: 'info', label: 'Info', html: tablePanel(info, '') },
    ], statusClass(s.status));
}

function errorCard(tx: ApiTransaction): string {
    const e = tx.error ?? { name: 'Error', message: 'The request produced no response.' };
    return `<section class="card s-error">
  <h2>Response <span class="sub">none — the request failed before a response arrived</span></h2>
  <div class="error">
    <div class="error-name">${esc(e.name)}</div>
    <pre class="scroll">${esc(e.message)}</pre>
  </div>
</section>`;
}

interface Tab { id: string; label: string; badge?: string; html: string }

function card(heading: string, prefix: string, tabs: Tab[], extraClass = ''): string {
    const inputs = tabs.map((tab, index) =>
        `<input type="radio" name="${prefix}" id="${prefix}-${tab.id}"${index === 0 ? ' checked' : ''}>` +
        `<label for="${prefix}-${tab.id}">${esc(tab.label)}${tab.badge ? `<small>${esc(tab.badge)}</small>` : ''}</label>`).join('\n    ');
    const panels = tabs.map(tab => `<div class="panel" id="panel-${prefix}-${tab.id}">${tab.html}</div>`).join('\n    ');
    const rules = tabs.map(tab =>
        `#${prefix}-${tab.id}:checked ~ #panel-${prefix}-${tab.id}{display:block}#${prefix}-${tab.id}:checked + label{color:var(--accent);border-bottom-color:var(--accent)}`).join('');
    return `<section class="card ${extraClass}">
  <h2>${esc(heading)}</h2>
  <style>${rules}</style>
  <div class="tabs">
    ${inputs}
    ${panels}
  </div>
</section>`;
}

function bodyBadge(body: BodyView): string {
    if (body.kind === 'empty') return 'empty';
    return body.truncated ? `${body.kind} · truncated` : body.kind;
}

function bodyPanel(body: BodyView): string {
    if (body.note) return `<p class="note">${esc(body.note)}</p>${body.text ? `<pre class="scroll">${esc(body.text)}</pre>` : ''}`;
    if (body.kind === 'empty') return '<p class="empty">No body.</p>';
    if (body.kind === 'binary' || body.kind === 'hidden') return `<p class="note">${esc(body.text)}</p>`;
    const content = body.kind === 'json' ? highlightJson(body.text) : esc(body.text);
    const meta = [body.contentType, body.bytes !== undefined ? `${body.bytes} bytes` : undefined].filter(Boolean).join(' · ');
    const cut = body.truncated ? `<p class="note">…[truncated ${body.omittedChars ?? 0} more chars]</p>` : '';
    return `${meta ? `<div class="body-meta">${esc(meta)}</div>` : ''}<pre class="scroll ${body.kind}">${content}</pre>${cut}`;
}

function tablePanel(rows: Record<string, string>, emptyText: string): string {
    const entries = Object.entries(rows);
    if (entries.length === 0) return `<p class="empty">${esc(emptyText)}</p>`;
    return `<div class="scroll"><table>
${entries.map(([name, value]) => `<tr><th>${esc(name)}</th><td>${esc(value)}</td></tr>`).join('\n')}
</table></div>`;
}

/** Syntax colouring for JSON the renderer itself pretty-printed. Tokens are escaped individually. */
export function highlightJson(pretty: string): string {
    const token = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
    let out = '';
    let last = 0;
    for (const match of pretty.matchAll(token)) {
        out += esc(pretty.slice(last, match.index));
        const [whole, str, colon, keyword, num] = match;
        if (str !== undefined) out += colon ? `<span class="k">${esc(str)}</span>${esc(colon)}` : `<span class="s">${esc(str)}</span>`;
        else if (keyword !== undefined) out += `<span class="b">${esc(keyword)}</span>`;
        else if (num !== undefined) out += `<span class="n">${esc(num)}</span>`;
        else out += esc(whole);
        last = match.index! + whole.length;
    }
    return out + esc(pretty.slice(last));
}

export function statusClass(status: number): string {
    if (status >= 500) return 's5';
    if (status >= 400) return 's4';
    if (status >= 300) return 's3';
    if (status >= 200) return 's2';
    return 's1';
}

function statusWord(status: number): string {
    const words: Record<number, string> = {
        200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found',
        304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
        405: 'Method Not Allowed', 408: 'Request Timeout', 409: 'Conflict', 415: 'Unsupported Media Type',
        422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway',
        503: 'Service Unavailable', 504: 'Gateway Timeout',
    };
    return words[status] ?? '';
}

export function esc(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#1d2433;--muted:#6b7280;--border:#e3e6ea;--accent:#2563eb;--code:#f1f3f6;
--get:#2563eb;--post:#16a34a;--put:#d97706;--patch:#7c3aed;--delete:#dc2626;--head:#64748b;--options:#64748b;
--s1:#64748b;--s2:#16a34a;--s3:#0891b2;--s4:#d97706;--s5:#dc2626;--k:#7c3aed;--s:#0f766e;--n:#b45309;--b:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--text:#e6e8ee;--muted:#9aa3b2;--border:#2a2f3a;--accent:#60a5fa;--code:#0b0d12;
--k:#c4b5fd;--s:#5eead4;--n:#fbbf24;--b:#93c5fd}}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:16px}
code,pre,table{font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.hero{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:14px}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.row.meta{margin-top:10px}
.method{font-weight:700;letter-spacing:.04em;color:#fff;background:var(--head);border-radius:6px;padding:4px 10px;font-size:12px}
.method.get{background:var(--get)}.method.post{background:var(--post)}.method.put{background:var(--put)}.method.patch{background:var(--patch)}.method.delete{background:var(--delete)}
.url{word-break:break-all;font-size:13.5px}
.status{font-weight:700;border-radius:6px;padding:3px 10px;color:#fff;background:var(--s1)}
.status.s2{background:var(--s2)}.status.s3{background:var(--s3)}.status.s4{background:var(--s4)}.status.s5,.status.s-error{background:var(--s5)}
.chip{border:1px solid var(--border);border-radius:999px;padding:2px 10px;font-size:12px;color:var(--text);background:var(--bg)}.chip.dim{color:var(--muted)}
.grid{display:grid;grid-template-columns:1fr;gap:14px}@media(min-width:1100px){.grid{grid-template-columns:1fr 1fr}}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:0 0 12px;min-width:0;border-top:3px solid var(--accent)}
.card.s2{border-top-color:var(--s2)}.card.s3{border-top-color:var(--s3)}.card.s4{border-top-color:var(--s4)}.card.s5,.card.s-error{border-top-color:var(--s5)}
.card h2{font-size:15px;margin:0;padding:12px 16px 0}.card h2 .sub{font-weight:400;color:var(--muted);font-size:12.5px;margin-left:8px}
.tabs{display:flex;flex-wrap:wrap;padding:8px 16px 0;border-bottom:1px solid var(--border);margin:0 0 10px}
.tabs input{position:absolute;opacity:0;width:0;height:0}
.tabs label{cursor:pointer;padding:8px 12px;margin-bottom:-1px;border-bottom:2px solid transparent;color:var(--muted);font-weight:600;font-size:13px;user-select:none}
.tabs label small{margin-left:6px;font-weight:500;color:var(--muted);background:var(--code);border-radius:999px;padding:1px 7px;font-size:11px}
.tabs label:hover{color:var(--text)}
.panel{display:none;flex-basis:100%;padding:10px 0 0;border-top:1px solid var(--border);margin-top:-1px}
.scroll{max-height:70vh;overflow:auto;margin:0 16px;background:var(--code);border:1px solid var(--border);border-radius:8px}
pre.scroll{padding:12px;white-space:pre-wrap;word-break:break-word}
.body-meta{color:var(--muted);font-size:12px;margin:0 16px 6px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:6px 10px;border-bottom:1px solid var(--border);word-break:break-all}
th{color:var(--muted);font-weight:600;white-space:nowrap;width:1%}tr:last-child th,tr:last-child td{border-bottom:0}
.empty,.note{color:var(--muted);margin:4px 16px;font-size:13px}.note{font-style:italic}
.error{padding:8px 0 0}.error-name{color:var(--s5);font-weight:700;margin:0 16px 8px}
.k{color:var(--k)}.s{color:var(--s)}.n{color:var(--n)}.b{color:var(--b)}
.hero h1{font-size:18px;margin:0 0 4px;font-weight:650}.hero .sub{color:var(--muted);font-size:12.5px}
.chip.good{color:var(--s2);border-color:var(--s2)}.chip.bad{color:var(--s5);border-color:var(--s5)}
.index{padding-bottom:12px;margin-bottom:14px}.index .scroll{max-height:40vh}.index td.num{text-align:right;white-space:nowrap}.index td a{color:var(--accent);text-decoration:none}
details.call{background:var(--card);border:1px solid var(--border);border-radius:10px;margin-bottom:10px}
details.call>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px}
details.call>summary::-webkit-details-marker{display:none}details.call>summary::before{content:'▸';color:var(--muted);width:10px}details.call[open]>summary::before{content:'▾'}
details.call .seq{color:var(--muted);font-weight:600;min-width:2.5em}details.call .path{word-break:break-all}
details.call .call-body{padding:0 14px 14px}details.call .call-body>.row{margin:0 0 10px}details.call .status{font-size:12px;padding:2px 8px}
footer{color:var(--muted);font-size:12px;margin-top:14px;display:flex;gap:16px;flex-wrap:wrap}
`;
