import { test as base, type APIRequestContext, type TestInfo } from '@playwright/test';
import { withApiReporting } from './capture.js';
import type { ApiReportingOptions } from './config.js';

/**
 * Optional sugar for projects whose API calls go through Playwright's built-in `request` fixture:
 * spread {@link apiReporting} into `test.extend(...)`, or import the ready-made {@link test}.
 *
 *   import { test as base } from '@playwright/test';
 *   import { apiReporting } from 'callcanvas/fixtures';
 *   export const test = base.extend<MyFixtures>({ ...apiReporting({ client: 'orders-api' }), ...myFixtures });
 *
 * The override wraps the context Playwright created; nothing else about the fixture changes. A project
 * that builds its own contexts with `request.newContext()` wraps them where it creates them instead.
 */

type RequestFixture = (
    args: { request: APIRequestContext },
    use: (context: APIRequestContext) => Promise<void>,
    testInfo: TestInfo,
) => Promise<void>;

/** A fixtures object overriding `request` with a reported wrapper of itself. */
export function apiReporting(options: ApiReportingOptions = {}): { request: RequestFixture } {
    return {
        request: async ({ request }, use) => {
            await use(withApiReporting(request, options));
        },
    };
}

/** `@playwright/test`'s `test` with the built-in `request` fixture reported (default options). */
export const test = base.extend(apiReporting());

export { expect } from '@playwright/test';
export type { ApiReportingOptions } from './config.js';
