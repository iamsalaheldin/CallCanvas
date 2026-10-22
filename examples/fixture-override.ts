/**
 * A project whose API calls go through Playwright's built-in `request` fixture (an `APIManager`
 * built from it, say). One overridden fixture; tests, API classes and reporters stay as they are.
 */
import { test as base, expect } from '@playwright/test';
import { apiReporting } from 'callcanvas/fixtures';

class APIManager {
    constructor(readonly request: import('@playwright/test').APIRequestContext, readonly baseUrl: string) {}
    getOrder(id: string) {
        return this.request.get(`${this.baseUrl}/orders/${id}`);
    }
}

interface Fixtures {
    apiManager: APIManager;
}

export const test = base.extend<Fixtures>({
    // Every call made through the built-in `request` fixture lands on the test's API page.
    ...apiReporting({ client: 'orders-api', maskHeaders: ['x-orders-session'] }),
    apiManager: async ({ request }, use) => {
        await use(new APIManager(request, process.env.API_URL ?? 'http://localhost:3000'));
    },
});

export { expect };

// Equivalent, without the sugar:
//
//   import { withApiReporting } from 'callcanvas';
//   request: async ({ request }, use) => { await use(withApiReporting(request, { client: 'orders-api' })); },
