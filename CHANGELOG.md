# Changelog

All notable changes to CallCanvas (`callcanvas` on npm) are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [semver](https://semver.org/).

## [Unreleased]

## [1.0.0] — Unreleased

First public release of CallCanvas — visual API reporting for Playwright.

### Added
- `withApiReporting(context, options)`: a Proxy over `APIRequestContext` that attaches one sanitized,
  self-contained HTML page per test (index + collapsible section per call) to the native Playwright
  report; `layout: 'call'` for one page per call.
- `reportApiCall(record, options)` and `fromFetchResponse` for traffic made outside an
  `APIRequestContext`.
- `callcanvas/fixtures` entry: `apiReporting(options)` to spread into `test.extend`, and a ready-made `test`.
- Pluggable sanitization: `SanitizeRules` (text rules, field rules, leak checks), `defaultRules`,
  `defineRules`, `withoutRules`, `textRule` / `fieldRule` / `leakCheck`, `registerSecrets`.
- Every `API_REPORT_*` environment variable has a programmatic option; options win over the environment.
- Masked query-parameter names are masked wherever a URL appears in free text or a JSON string, not
  only in the request URL.
- Concurrent calls within one test are appended to the per-test page one at a time, so none is lost
  between the first attach and the rewrite of Playwright's copy.
- Dual CommonJS / ESM build with per-format type declarations; `@playwright/test >=1.40` peer.
- Warnings sent to stderr (`API_REPORT_DEBUG=true`) are prefixed `[callcanvas]`.
- MIT licence.
