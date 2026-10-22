import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { apiReporting, test as reportedTest } from '../src/fixtures.js';
import { DEFAULT_ATTACHMENT_NAME } from '../src/index.js';
import { attachedPages } from './helpers/attachments.js';
import { startServer, type TestServer } from './helpers/server.js';

/** The `./fixtures` entry: the built-in `request` fixture, reported. */

let server: TestServer;

base.beforeAll(async () => { server = await startServer(); });
base.afterAll(async () => { await server.close(); });

reportedTest('the ready-made test reports calls made through the built-in request fixture', async ({ request }) => {
    const response = await request.get(`${server.base}/json`);
    expect(response.status()).toBe(200);
    await request.post(`${server.base}/notfound`, { data: { a: 1 } });
    const pages = attachedPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].name).toBe(DEFAULT_ATTACHMENT_NAME);
    expect(pages[0].html).toContain('2 API calls');
    expect(pages[0].html).toContain('1 failed');
});

interface Extra { client: APIRequestContext }

const spreadTest = base.extend<Extra>({
    ...apiReporting({ client: 'spread-api', attachmentName: 'Spread API.html' }),
    // A project fixture built on the (now reported) request fixture, as a consumer's APIManager would be.
    client: async ({ request }, use) => { await use(request); },
});

spreadTest('apiReporting spreads into a project\'s own test.extend and flows into dependent fixtures', async ({ client }) => {
    await client.get(`${server.base}/xml`);
    const pages = attachedPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].name).toBe('Spread API.html');
    expect(pages[0].html).toContain('spread-api');
    expect(pages[0].html).toContain('&lt;item id=&quot;1&quot;&gt;one&lt;/item&gt;');
});

const offTest = base.extend({ ...apiReporting({ enabled: false }) });

offTest('a disabled fixture hands out the original context', async ({ request }) => {
    await request.get(`${server.base}/json`);
    expect(attachedPages()).toHaveLength(0);
});
