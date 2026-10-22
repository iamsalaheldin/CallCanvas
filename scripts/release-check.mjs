/**
 * Guards a publish, wherever it runs (a maintainer's machine or the release workflow): runs first in
 * `prepublishOnly`, before `npm run verify`. Refuses when the metadata still has placeholders, the
 * changelog has no section for the version, the working tree is dirty, or the version is already on
 * the registry. Under `npm publish --dry-run` a dirty tree is only a warning.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));
const dryRun = process.env.npm_config_dry_run === 'true';
const problems = [];
const log = message => console.log(`[release-check] ${message}`);

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version)) problems.push(`version "${pkg.version}" is not semver`);
if (/OWNER/.test(JSON.stringify([pkg.homepage, pkg.repository, pkg.bugs]))) problems.push('package.json still has OWNER placeholders');
for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md']) {
    if (!fs.existsSync(new URL(file, root))) problems.push(`${file} is missing`);
}
const changelog = fs.existsSync(new URL('CHANGELOG.md', root)) ? fs.readFileSync(new URL('CHANGELOG.md', root), 'utf8') : '';
if (!changelog.includes(`## [${pkg.version}]`)) problems.push(`CHANGELOG.md has no "## [${pkg.version}]" section`);

const git = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
if (git.status !== 0) log('not a git checkout; skipping the clean-tree check');
else if (git.stdout.trim()) {
    const message = `the working tree has uncommitted changes:\n${git.stdout.trimEnd()}`;
    if (dryRun) log(`warning (dry run): ${message}`);
    else problems.push(message);
}

const registry = pkg.publishConfig?.registry ?? 'https://registry.npmjs.org/';
try {
    const published = execFileSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version', '--registry', registry], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (published) problems.push(`${pkg.name}@${pkg.version} is already on ${registry}; bump the version`);
} catch (error) {
    if (!/E404/.test(String(error.stderr))) problems.push(`could not ask ${registry} about ${pkg.name}@${pkg.version}: ${String(error.stderr).split('\n')[0]}`);
}

if (problems.length) {
    for (const problem of problems) console.error(`[release-check] ${problem}`);
    process.exit(1);
}
log(`${pkg.name}@${pkg.version} is ready to publish to ${registry}${dryRun ? ' (dry run)' : ''}`);
