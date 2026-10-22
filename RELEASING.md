# Releasing CallCanvas

A release can be published two ways. Both run the same guard, because `npm publish` always runs the
`prepublishOnly` script first:

1. `scripts/release-check.mjs` — refuses if `package.json` still has placeholders, `CHANGELOG.md` has
   no `## [x.y.z]` section, the working tree is dirty, or the version is already on npm.
2. `npm run verify` — typecheck, build, the full test suite, and `smoke:pack`, which packs the tarball
   and runs it from a CommonJS and an ESM consumer project.

If either fails, nothing is uploaded.

| | Manual (maintainer's machine) | Automated (GitHub Actions) |
|---|---|---|
| Trigger | `npm publish` | pushing a `vX.Y.Z` tag (`.github/workflows/release.yml`) |
| Auth | `npm login` + 2FA prompt | `NPM_TOKEN` secret, or npm trusted publishing |
| Provenance | no (npm only signs provenance from a supported CI) | yes (`--provenance`) |
| GitHub release | `gh release create` by hand | created by the workflow |

If a version was published manually, pushing its tag later only creates the GitHub release: the
workflow sees the version on npm and skips the publish step.

## One-time setup

- An npm account with **two-factor authentication enabled** for authorization and writes
  (npmjs.com → Account → Two-Factor Authentication). npm requires 2FA, or a granular token with
  bypass, to publish.
- Node 18 or newer (22 LTS recommended) and npm 9 or newer.
- Never write a token into this repository: no `.npmrc` with `_authToken`, no token in scripts.
  `npm login` keeps its session in your user-level `~/.npmrc`, outside the repository. `.npmrc` is in
  `.gitignore` as a guard.

## Manual release

`main` is protected, so the version bump goes in through a pull request first.

1. **Prepare the release commit** on a branch, then merge it via PR:
   - set the version: `npm version <x.y.z> --no-git-tag-version`;
   - in `CHANGELOG.md`, move the **Unreleased** notes under `## [x.y.z] — YYYY-MM-DD`
     (for the first release, replace `— Unreleased` on the `1.0.0` heading with the date).
2. **Start from a clean, up-to-date `main`:**

   ```bash
   git switch main
   git pull --ff-only
   git status --short    # must print nothing
   ```

3. **Install exactly what the lockfile says and check the release:**

   ```bash
   npm ci
   npm run release:check
   ```

4. **Rehearse.** This runs the whole guard and prints the tarball's file list without uploading:

   ```bash
   npm publish --dry-run
   ```

   Expect about 50 files, all under `dist/` plus `package.json`, `README.md`, `CHANGELOG.md` and
   `LICENSE` — no `src/`, `test/`, `examples/`, `scripts/` or `docs/`.
5. **Sign in** (opens the browser; skip if `npm whoami` already prints your username):

   ```bash
   npm login
   npm whoami
   ```

6. **Publish.** npm asks for a one-time password or a browser confirmation (2FA):

   ```bash
   npm publish
   ```

   `publishConfig` already sets `access: public` and the public registry. To pass the code directly:
   `npm publish --otp=123456`.
7. **Verify what was published:**

   ```bash
   npm view callcanvas version dist-tags
   npm view callcanvas@<x.y.z> dist.tarball dist.integrity
   ```

   Then install it into an empty project and run one reported test (the Quick Start in the README
   is enough): `npm install -D callcanvas@<x.y.z> @playwright/test`.
8. **Tag and announce:**

   ```bash
   git tag -a v<x.y.z> -m "CallCanvas <x.y.z>"
   git push origin v<x.y.z>
   ```

   While GitHub Actions cannot run, create the GitHub release by hand:

   ```bash
   gh release create v<x.y.z> --title "v<x.y.z>" --notes "See CHANGELOG.md"
   ```

## If something goes wrong

- **Never reuse a version number.** npm refuses a version that was ever published, even after an
  unpublish.
- A broken release: publish a fixed patch version, then `npm deprecate callcanvas@<bad> "<reason>"`.
- `npm unpublish callcanvas@<x.y.z>` is possible only within 72 hours and only if nothing depends on
  it; prefer deprecating.
- `E403 ... You cannot publish over the previously published versions` — bump the version.
- `EOTP` — 2FA code missing or expired; rerun with `--otp=<code>`.
- `Automatic provenance generation not supported for provider: null` — something passed
  `--provenance` on a local machine; provenance only works inside a supported CI.

## Automated releases (once GitHub Actions is available)

1. Add an npm **granular access token** (publish rights on `callcanvas` only) as the `NPM_TOKEN`
   secret of the `npm` environment — or, better, configure **trusted publishing** for the package
   on npmjs.com (Settings → Trusted publishing → GitHub Actions, workflow `release.yml`,
   environment `npm`) and drop the token. Trusted publishing needs the package to exist, so the
   first release is manual either way, and it needs npm 11.5.1 or newer in the workflow.
2. Merge the release commit (version + changelog) to `main`, then push the tag:
   `git tag -a v<x.y.z> -m "CallCanvas <x.y.z>" && git push origin v<x.y.z>`.
3. The workflow checks the tag against `package.json` and `CHANGELOG.md`, publishes with
   provenance through the same `prepublishOnly` guard, and creates the GitHub release.
