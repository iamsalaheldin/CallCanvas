# Contributing

Thanks for helping make API traffic readable and safe in Playwright reports with CallCanvas.

## Development

```bash
npm install
npm run typecheck     # sources, specs and examples
npm test              # the suite, against local HTTP servers — no browser, no network
npm run build         # dist/cjs + dist/esm with declarations
npm run smoke:pack    # pack the tarball and consume it from CommonJS and ESM projects
npm run verify        # all of the above; what CI runs
```

Node 18 or newer. The suite runs on every Playwright version the package supports; to try one
locally: `npm install --no-save @playwright/test@1.40.1 && npm test`, then `npm ci` to restore.

## Ground rules

- **Nothing in the reporter may fail a test.** Every path that touches a call is wrapped; a problem
  becomes one `onWarning` line. A change that can throw into the caller's test will not be merged.
- **Mask before you cut.** Bodies are sanitized field by field before truncation. Keep it that way.
- **Rules are data.** New sanitization behaviour goes in as a `TextRule`, `FieldRule` or `LeakCheck`,
  not as a special case in the engine. Defaults must stay generic (no country-, vendor- or
  product-specific patterns); ship those as documented examples instead.
- **Every value on a page is escaped.** The renderer never interpolates raw text.
- **Tests accompany changes.** Add or adjust a spec under `test/`; rendered-page snapshots live in
  `test/__snapshots__` and are updated with `npx playwright test --update-snapshots` when a visual
  change is intended.

## Pull requests

1. Fork, branch from `main`, make the change with its tests.
2. `npm run verify` must pass.
3. Add a line under **Unreleased** in `CHANGELOG.md` (Keep a Changelog format).
4. Open the PR with a short description of the behaviour change and, for anything visible, a
   screenshot of the page.

## Releasing (maintainers)

See [RELEASING.md](RELEASING.md): a manual `npm publish` from a maintainer's machine, or a pushed
`vX.Y.Z` tag once GitHub Actions is available. Both run the same `prepublishOnly` guard
(`scripts/release-check.mjs`, then `npm run verify`).
