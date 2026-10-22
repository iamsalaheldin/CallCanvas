# CallCanvas — Visual API Reporting for Playwright

**Every API call. One clear view.**

CallCanvas puts readable, **sanitized** API request/response pages inside the native Playwright
report. Wrap an `APIRequestContext` once; every call a test makes lands on one self-contained HTML
page attached to that test — a summary index, then a collapsible section per call with method, URL,
status, duration and request/response tabs. Secrets and personal data are masked before a byte is
written.

![A CallCanvas page: the test's calls as an index, then one collapsible section per call](https://raw.githubusercontent.com/iamsalaheldin/CallCanvas/main/docs/images/report-page.png)

## Why

Playwright's HTML report shows that `request.post()` ran and how long it took, but not what was sent
or what came back. When an API test fails in CI you end up re-running it locally, adding
`console.log`, or opening a trace — which stores every token and password unredacted and is not
something to publish.

CallCanvas gives each test a page you can open straight from the report:

- **No new reporter, no config change.** The page is an ordinary path attachment, so it appears in
  the HTML, JUnit, blob (`merge-reports`), Allure and Monocart reporters alike.
- **One peer dependency: `@playwright/test`** (`>= 1.40`). No runtime dependencies. CommonJS and ESM
  builds, each with its own type declarations.
- **Safe by default.** Credentials masked by name, JWTs / base64 blobs / e-mail addresses replaced in
  text, and a leak check that withholds anything suspicious rather than publishing it. Rules are data
  you extend.
- **Cannot fail a test.** The call's result and error pass through exactly; a reporting problem is at
  most one optional warning line.

## Install

```bash
npm install -D callcanvas
```

`@playwright/test` 1.40 or newer must already be installed in the project.

## Quick start

If your tests use Playwright's built-in `request` fixture, two files are enough — plus the HTML
reporter, which projects created with `npm init playwright` already have.

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({ testDir: './tests', reporter: 'html' });
```

`tests/fixtures.ts` — extend `test` once:

```ts
import { test as base, expect } from '@playwright/test';
import { apiReporting } from 'callcanvas/fixtures';

export const test = base.extend(apiReporting({ client: 'users-api' }));
export { expect };
```

`tests/users.spec.ts` — write tests as usual, importing `test` from your fixtures file:

```ts
import { test, expect } from './fixtures';

test('lists users and reads one', async ({ request }) => {
    const list = await request.get('https://jsonplaceholder.typicode.com/users');
    expect(list.ok()).toBeTruthy();

    const one = await request.get('https://jsonplaceholder.typicode.com/users/1', {
        headers: { Authorization: 'Bearer not-a-real-token' },   // shown as *** on the page
    });
    expect((await one.json()).id).toBe(1);
});
```

Run it and open the report:

```bash
npx playwright test
npx playwright show-report
```

Open the test: its **Attachments** list has `API requests and responses.html`. Click it to open the
page in a new tab. (If you need nothing else from a fixtures file,
`import { test, expect } from 'callcanvas/fixtures'` gives you a `test` with `request` already
reported.)

## Integrating with an existing framework

Whoever creates the `APIRequestContext` wraps it. Three shapes cover most projects; working versions
of each are in [`examples/`](examples/).

### 1. Through the `request` fixture

Spread `apiReporting()` into the `test.extend` call you already have. API classes built from
`request` are reported without any change:

```ts
import { test as base } from '@playwright/test';
import { apiReporting } from 'callcanvas/fixtures';
import { ApiClient } from './api-client';

export const test = base.extend<{ apiClient: ApiClient }>({
    ...apiReporting({ client: 'orders-api' }),          // overrides `request` with a reported wrapper
    apiClient: async ({ request }, use) => { await use(new ApiClient(request)); },
});
```

Without the helper: `request: async ({ request }, use) => { await use(withApiReporting(request)); }`.

### 2. Direct API client integration

If your framework builds its own contexts with `request.newContext()`, wrap them where they are
created — typically one line in a base client's constructor or factory:

```ts
import { request, type APIRequestContext } from '@playwright/test';
import { withApiReporting } from 'callcanvas';

export async function createOrdersApi(baseURL: string): Promise<APIRequestContext> {
    const raw = await request.newContext({ baseURL });
    return withApiReporting(raw, { client: 'orders-api' });
}
```

The wrapper is an `APIRequestContext`: `get`, `post`, `fetch`, `dispose`, `storageState` and the rest
behave exactly as before.

### 3. Calls made without an `APIRequestContext`

For Node `fetch`, axios and similar, report the call by hand:

```ts
import { fromFetchResponse, reportApiCall } from 'callcanvas';

const startedAt = new Date();
const res = await fetch(url, { method: 'POST', body: JSON.stringify(payload) });
const bytes = Buffer.from(await res.arrayBuffer());
await reportApiCall({
    method: 'fetch',
    args: [url, { method: 'POST', data: payload }],
    response: fromFetchResponse(res, bytes),
    startedAt,
    durationMs: Date.now() - startedAt.getTime(),
});
```

## What you get

One attachment per test, `API requests and responses.html`, under the step that made the test's
first call and in the test's Attachments list.

![An expanded call section with request and response tabs, in dark mode](https://raw.githubusercontent.com/iamsalaheldin/CallCanvas/main/docs/images/call-section-dark.png)

| Part | Content |
|---|---|
| Header | test title, project and file, number of calls, how many failed, time spent in requests |
| Index | one row per call — number, method, path, colour-coded status, duration — linking to its section |
| Call section | collapsed when the call succeeded, **open when it did not**; method, sanitized URL, status, duration, client, start time |
| Request tabs | **Body** (pretty JSON, form / multipart fields, or escaped text), **Headers** (the ones the call set), **Params** (URL query and `params`), **Options** (`timeout`, `maxRedirects`, `failOnStatusCode`, …) |
| Response tabs | **Body**, **Headers**, **Info** (status, duration, content type, size, final URL after a redirect) — or the transport error (`TimeoutError`, `ECONNREFUSED`) with Playwright's call log, header lines masked |

The page carries no script and a `default-src 'none'` content-security policy; tabs are CSS-only,
every value is HTML-escaped (an HTML or XML response is shown as text, never rendered), and it
follows the system's dark mode.

`layout: 'call'` attaches one page per call instead, named like `API #3 POST /orders → 201 (412 ms).html`.

## Guarantees

- The call's result and error are returned / rethrown exactly as Playwright produced them. The body
  is read with `body()`, which Playwright serves again to the caller; nothing is consumed.
- Nothing in CallCanvas can fail a test. Every step is wrapped; a problem is one `onWarning` line.
- Disabled means **no proxy**: `withApiReporting` returns the original context.
- Outside a test (global setup) there is nothing to attach to, so the call just runs. A call made while
  a worker-scoped fixture is set up is attached to the test whose setup ran it — Playwright's own rule.
- Only contexts you wrap are reported — never `page.request`, never browser traffic.
- Concurrent calls in one test (`Promise.all`) are appended in sequence; a context shared across tests
  (`beforeAll`, a worker fixture) gives each test its own page.

## Sanitization

Three layers, in this order, in one place:

1. **Masking by name** — headers, query parameters and JSON / form / multipart field names on the
   mask lists become `***`, whatever the value. Defaults cover `Authorization`, `Cookie` / `Set-Cookie`,
   `token`, API keys, CSRF headers; query `token`, `access_token`, `api_key`, `key`, `secret`,
   `password`, `otp`, `code`, `signature`, `session`…; body `password`, `token`, `refreshToken`,
   `clientSecret`, `otp`, `pin`, `privateKey`… (full lists in
   [`src/config.ts`](src/config.ts)). A masked query name is also masked wherever a URL appears in
   free text or a JSON string.
2. **Rules** — data, not code: registered literal secrets first, then *text rules* over free text and
   *field rules* over structured bodies. The defaults replace JWTs (`<jwt>`), base64 PDFs and long
   base64 runs, and e-mail addresses (`<email>`), and mask credential-like keys under any spelling
   (`clientSecret`, `refresh_token`, `x-api-key`, `sessionId`…).
3. **Leak checks** — patterns that must not survive. A text that still trips one is withheld and the
   page says which check failed. Defaults: a JWT, a base64 or raw PDF, an e-mail address.

Bodies are masked field by field **before** they are cut to size, so a truncated body cannot end
inside a secret. Binary bodies (PDF, images, archives, spreadsheets, anything that sniffs as binary)
are described by size and type, never decoded. `showBodies: false` hides every body.

Names your API uses for secrets that the defaults do not know — `paymentToken`, `x-tenant-session` —
belong in `maskBodyFields` / `maskHeaders` / `maskQueryParams`. Review a page from your own suite
before publishing reports widely.

### Your own rules

```ts
import { defineRules, textRule, fieldRule, leakCheck, withoutRules, defaultRules, registerSecrets, withApiReporting } from 'callcanvas';

const E164_PHONE = /(?<!\d)\+?[1-9]\d{7,14}(?!\d)/;
const rules = defineRules({
    text: [textRule('phone', E164_PHONE, '<phone>')],
    fields: [fieldRule('national-id', ['nationalId', 'ssn', 'taxId']), fieldRule('person-name', /^(customer|driver|holder)?name$/i)],
    leaks: [leakCheck('phone', E164_PHONE, 'Text still contains a phone number.')],
});
withApiReporting(ctx, { rules, maskHeaders: ['x-tenant-session'], maskBodyFields: ['iban', 'paymentToken'] });

// Rules are named, so a default can be dropped — text rule and leak check together:
withApiReporting(ctx, { rules: withoutRules(defaultRules, 'email') });

// Literal values the process knows (a worker fixture, global setup): removed from every page, longest first.
registerSecrets(process.env.API_PASSWORD, process.env.CLIENT_SECRET);
```

Personal data beyond e-mail — phone formats, names, national ids — is country- and domain-specific,
so it is left to your rules; [`examples/custom-rules.ts`](examples/custom-rules.ts) is a complete set.

## Configuration

Every option can be passed to `withApiReporting` / `reportApiCall` / `apiReporting`, or set in the
environment. **Options win over the environment**, which wins over the defaults. The environment is
read per call, so a CI step or a test can change it without a config change; `enabled` is read when
a context is wrapped.

| Option | Environment variable | Default | Meaning |
|---|---|---|---|
| `client` | — | — | a label for the wrapped context, shown on every call it made |
| `enabled` | `API_REPORT_ENABLED` | `true` | `false` / `0` / `no` / `off` switches the pages off — no proxy at all |
| `layout` | `API_REPORT_LAYOUT` | `test` | one page per test with every call; `call` for one page per call |
| `maxPageBytes` | `API_REPORT_MAX_PAGE_BYTES` | `8388608` | per-test page cap; later calls keep their index row, URL and headers but lose their bodies |
| `maxBodyChars` | `API_REPORT_MAX_BODY_CHARS` | `65536` | per-body cap after sanitizing |
| `maxRawBytes` | `API_REPORT_MAX_RAW_BYTES` | `2097152` | a body above this is described by size and type and never parsed, copied or regexed |
| `maxPerTest` | `API_REPORT_MAX_PER_TEST` | `200` | calls reported per test; later calls are counted, not shown (one warning) |
| `showBodies` | `API_REPORT_SHOW_BODIES` | `true` | `false` hides every request and response body |
| `maskHeaders` | `API_REPORT_MASK_HEADERS` | see `src/config.ts` | header names masked **in addition** to the defaults (comma-separated in the environment) |
| `maskQueryParams` | `API_REPORT_MASK_QUERY_PARAMS` | see `src/config.ts` | query parameter names masked in addition to the defaults |
| `maskBodyFields` | `API_REPORT_MASK_BODY_FIELDS` | see `src/config.ts` | JSON / form / multipart field names masked in addition to the defaults |
| `rules` | — | `defaultRules` | the text / field / leak rules (see above) |
| `attachmentName` | `API_REPORT_ATTACHMENT_NAME` | `API requests and responses.html` | the per-test attachment's name; keep the `.html` so it opens rendered |
| `onWarning` | `API_REPORT_DEBUG=true` → stderr | silent | receives one line per reporting problem; never thrown |

Names are matched case-insensitively.

In CI, a boolean pipeline parameter mapped to `API_REPORT_ENABLED` makes the pages opt-out per run.
The published HTML report carries them under `data/`; the JUnit reporter lists path attachments as
`[[ATTACHMENT|…]]` lines, which several CI systems turn into test-run attachments.

## Public API

```ts
// 'callcanvas'
withApiReporting(ctx, options?)           // the entry point
reportApiCall(record, options?)           // hand-made calls
fromFetchResponse(response, bodyBytes)    // adapt a fetch Response for reportApiCall
registerSecrets(...values) / clearRegisteredSecrets()
defaultRules, emptyRules, defineRules(extra, base?), withoutRules(rules, ...names)
textRule(name, pattern, replace), fieldRule(name, keysOrPattern, replace?), leakCheck(name, pattern, message)
resolveConfig(options?)                    // what a call would run with
sanitizeText / sanitizeJson / assertNoSecrets / sanitizeBody / …   // the sanitizer, reusable on its own
renderApiTransactionHtml / renderApiReportPage / renderCallSection // the renderer, reusable on its own
types: ApiReportingOptions, ApiReportConfig, SanitizeRules, TextRule, FieldRule, LeakCheck, ApiTransaction, BodyView, …

// 'callcanvas/fixtures'
apiReporting(options?)                    // { request: fixture } to spread into test.extend
test, expect                              // @playwright/test's, with `request` reported
```

## Compatibility

| | |
|---|---|
| `@playwright/test` | peer range `>= 1.40.0`. Test suite verified on **1.40.1, 1.45.3, 1.50.1 and 1.58.2**. |
| Node.js | `engines: >= 18`. Verified on **Node 22 and 26**; the CI matrix adds 18 and 20. |
| Module systems | CommonJS (`require`) and ESM (`import`), each with its own type declarations; TypeScript `moduleResolution` `node16` / `nodenext` / `bundler` |
| Reporters | any reporter that publishes path attachments: HTML, JUnit, blob + `merge-reports`, Allure, Monocart |

## Known limitations

- Headers Playwright adds itself (`user-agent`, `accept-encoding`, cookies from storage state,
  `extraHTTPHeaders` set on the context) are not visible to the proxy; only headers passed per call
  are listed.
- Masking by name matches whole names: `token` is masked, `paymentToken` is not unless you add it.
  Credential-like keys (`*password*`, `*secret*`, `*api_key*`, `*access_token*`…) are matched by pattern.
- Bodies over `maxRawBytes` (2 MB) are described, not shown. Below it the whole body is parsed and
  masked before the shown text is cut, so a very large JSON response costs tens to hundreds of
  milliseconds on the call's path.
- The response body crosses Playwright's driver pipe twice when the caller reads it too (`body()` is
  not cached client-side); it is never consumed.
- In the HTML report, Playwright's own `GET "…"` step points at CallCanvas's `capture.js` rather than
  your API class, because the proxy is the frame that calls Playwright. Playwright offers no way to
  mark a frame as internal.
- A retry produces its own page: attachments belong to a test result.
- A `multipart` body lists field names, file names, types and sizes; file content is never shown.
- The per-test page is re-rendered and rewritten on every call; a test with hundreds of calls pays a
  few milliseconds more per call towards the end.
- Loading both the CommonJS and the ESM build in one worker (mixed `require` and `import` of the
  package) gives two copies of the per-test state; use one module system per project.

## FAQ

**Does it replace Playwright's `trace`?** No. Traces are for debugging a run on your machine and
store requests unredacted; CallCanvas pages are for the published report, with masking you control.

**Will it slow my tests down?** A small JSON call costs well under a millisecond of extra work plus
one more read of the body over the driver pipe. Disable it per run with `API_REPORT_ENABLED=false`
(no proxy is installed at all).

**How is it different from a custom reporter?** Reporters never see request or response bodies.
Capture has to happen in the worker, at the `APIRequestContext` boundary — which is what this does.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). For a sanitization gap, please use the private channel in
[SECURITY.md](SECURITY.md) rather than a public issue. Release steps are in [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE).
