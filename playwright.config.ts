import { defineConfig } from '@playwright/test';

/**
 * The package's own test run: API-only specs against local HTTP servers, no browser. Two workers with
 * fully parallel files, so per-test isolation of the attachments is exercised across worker processes.
 */
export default defineConfig({
    testDir: './test',
    fullyParallel: true,
    workers: process.env.CI ? 2 : 2,
    retries: 0,
    timeout: 30_000,
    outputDir: 'test-results',
    // Text snapshots must not depend on the platform the suite ran on.
    snapshotPathTemplate: '{testDir}/__snapshots__/{testFileName}/{arg}{ext}',
    reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ],
    use: {
        trace: 'off',
    },
});
