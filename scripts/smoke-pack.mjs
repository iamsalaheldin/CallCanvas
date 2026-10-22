/**
 * Packs the package exactly as `npm publish` would and consumes the tarball from two throw-away
 * projects — one CommonJS, one ESM — each running a real Playwright test against both entry points
 * (`.` and `./fixtures`), plus a TypeScript resolution check of the `exports` map under NodeNext.
 * No network: `@playwright/test` and its dependencies are linked from this repo's node_modules.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'callcanvas-smoke-'));
const log = message => console.log(`[smoke] ${message}`);

try {
    log(`packing into ${work}`);
    // Under `npm publish --dry-run` (prepublishOnly → verify) npm exports npm_config_dry_run=true, which
    // would make this pack write nothing; the smoke test needs the real tarball either way.
    const packOutput = execFileSync('npm', ['pack', '--pack-destination', work, '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, npm_config_dry_run: 'false' } });
    const [{ filename, files }] = JSON.parse(packOutput);
    const tarball = path.join(work, filename);
    const shipped = files.map(f => f.path);
    for (const required of ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'dist/cjs/index.js', 'dist/cjs/index.d.ts', 'dist/cjs/fixtures.js', 'dist/cjs/package.json', 'dist/esm/index.js', 'dist/esm/index.d.ts', 'dist/esm/fixtures.js', 'dist/esm/package.json']) {
        if (!shipped.includes(required)) throw new Error(`tarball is missing ${required}`);
    }
    for (const forbidden of shipped.filter(f => /^(src|test|examples|scripts|docs|\.github)\//.test(f) || f.endsWith('.tgz'))) {
        throw new Error(`tarball must not ship ${forbidden}`);
    }
    log(`${shipped.length} files in ${filename}`);

    let failures = 0;
    for (const kind of ['commonjs', 'module']) {
        const consumer = path.join(work, kind === 'module' ? 'consumer-esm' : 'consumer-cjs');
        fs.mkdirSync(path.join(consumer, 'node_modules'), { recursive: true });
        fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: `consumer-${kind}`, private: true, type: kind }, null, 2));
        execFileSync('tar', ['-xzf', tarball, '-C', path.join(consumer, 'node_modules')], { stdio: 'inherit' });
        fs.renameSync(path.join(consumer, 'node_modules', 'package'), path.join(consumer, 'node_modules', 'callcanvas'));
        for (const dep of ['@playwright', 'playwright', 'playwright-core', '@types', 'typescript', 'undici-types']) {
            const target = path.join(root, 'node_modules', dep);
            if (fs.existsSync(target)) fs.symlinkSync(target, path.join(consumer, 'node_modules', dep), 'dir');
        }
        fs.mkdirSync(path.join(consumer, 'tests'));
        fs.writeFileSync(path.join(consumer, 'playwright.config.js'), kind === 'module'
            ? `export default { testDir: './tests', reporter: [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] };\n`
            : `module.exports = { testDir: './tests', reporter: [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] };\n`);
        fs.writeFileSync(path.join(consumer, 'tests', 'reporter.spec.js'), kind === 'module' ? esmSpec() : cjsSpec());
        fs.writeFileSync(path.join(consumer, 'types-check.ts'), kind === 'module' ? esmTypes() : cjsTypes());
        fs.writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({
            compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: true, types: ['node'], target: 'ES2022' },
            files: ['types-check.ts'],
        }, null, 2));

        log(`${kind}: tsc --noEmit (NodeNext resolution of the exports map)`);
        const tsc = spawnSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], { cwd: consumer, stdio: 'inherit' });
        if (tsc.status !== 0) { failures++; log(`${kind}: TYPES FAILED`); }

        log(`${kind}: playwright test`);
        const run = spawnSync(process.execPath, [path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test'], { cwd: consumer, stdio: 'inherit', env: { ...process.env, CI: '1' } });
        if (run.status !== 0) { failures++; log(`${kind}: TESTS FAILED`); }
        else {
            const pages = fs.readdirSync(path.join(consumer, 'playwright-report', 'data')).filter(f => f.endsWith('.html'));
            if (pages.length < 2) { failures++; log(`${kind}: expected the API pages under playwright-report/data, found ${pages.length}`); }
            else log(`${kind}: ${pages.length} API pages published under playwright-report/data`);
        }
    }
    if (failures) throw new Error(`${failures} smoke step(s) failed; the consumers are kept in ${work}`);
    log('OK');
    fs.rmSync(work, { recursive: true, force: true });
} catch (error) {
    console.error(`[smoke] ${error.message}`);
    process.exitCode = 1;
}

function serverSnippet(esm) {
    return `${esm ? "import http from 'node:http';" : "const http = require('node:http');"}
let server, base;
test.beforeAll(async () => {
    server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=1' }); res.end(JSON.stringify({ ok: true, token: 'secret-token', url: req.url })); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(() => new Promise(r => server.close(r)));
function pages() { return test.info().attachments.filter(a => a.contentType === 'text/html').map(a => ({ name: a.name, html: fs.readFileSync(a.path, 'utf8') })); }
`;
}

function body() {
    return `
test('withApiReporting on a context of my own', async ({ playwright }) => {
    const raw = await playwright.request.newContext();
    const api = withApiReporting(raw, { client: 'smoke', maskQueryParams: ['sig'] });
    const res = await api.get(base + '/a?sig=abc&keep=1', { headers: { authorization: 'Bearer x' } });
    expect(res.status()).toBe(200);
    await api.post(base + '/b', { data: { password: 'p', fine: 'f' } });
    const [page] = pages();
    expect(pages()).toHaveLength(1);
    expect(page.name).toBe('API requests and responses.html');
    expect(page.html).toContain('2 API calls');
    expect(page.html).toContain('<th>authorization</th><td>***</td>');
    expect(page.html).toContain('sig=***');
    expect(page.html).not.toContain('secret-token');
    expect(page.html).not.toContain('sig=abc');
    await raw.dispose();
});

reported('the fixtures entry reports the built-in request fixture', async ({ request }) => {
    await request.get(base + '/c');
    const [page] = pages();
    expect(pages()).toHaveLength(1);
    expect(page.html).toContain('1 API call');
});

test('version is readable', () => { expect(typeof version).toBe('string'); });
`;
}

function cjsSpec() {
    return `const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { withApiReporting } = require('callcanvas');
const { test: reported } = require('callcanvas/fixtures');
const { version } = require('callcanvas/package.json');
${serverSnippet(false)}${body()}`;
}

function esmSpec() {
    return `import fs from 'node:fs';
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';
import { withApiReporting } from 'callcanvas';
import { test as reported } from 'callcanvas/fixtures';
const { version } = createRequire(import.meta.url)('callcanvas/package.json');
${serverSnippet(true)}${body()}`;
}

function esmTypes() {
    return `import { withApiReporting, defineRules, textRule, type ApiReportingOptions, type SanitizeRules } from 'callcanvas';
import { apiReporting, test } from 'callcanvas/fixtures';
import type { APIRequestContext } from '@playwright/test';
const rules: SanitizeRules = defineRules({ text: [textRule('x', /x/, 'y')] });
const options: ApiReportingOptions = { client: 'types', rules };
export function wrap(ctx: APIRequestContext): APIRequestContext { return withApiReporting(ctx, options); }
export const fixtures = apiReporting(options);
export { test };
`;
}

function cjsTypes() {
    return `import { withApiReporting, defineRules, textRule, type ApiReportingOptions, type SanitizeRules } from 'callcanvas';
import { apiReporting, test } from 'callcanvas/fixtures';
import type { APIRequestContext } from '@playwright/test';
const rules: SanitizeRules = defineRules({ text: [textRule('x', /x/, 'y')] });
const options: ApiReportingOptions = { client: 'types', rules };
export function wrap(ctx: APIRequestContext): APIRequestContext { return withApiReporting(ctx, options); }
export const fixtures = apiReporting(options);
export { test };
`;
}
