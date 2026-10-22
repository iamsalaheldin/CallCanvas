/**
 * A framework that builds its own contexts with `request.newContext()` (a common pattern): wrap
 * where the context is created, once, and every method of the client is reported.
 */
import { request, type APIRequestContext } from '@playwright/test';
import { withApiReporting, type SanitizeRules } from 'callcanvas';

export class OrdersApiClient {
    private constructor(private readonly ctx: APIRequestContext) {}

    static async create(baseURL: string, token: string, rules?: SanitizeRules): Promise<OrdersApiClient> {
        const raw = await request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
        // Headers set on the CONTEXT (extraHTTPHeaders) are not visible to the proxy and never appear on
        // the page; headers passed per call are, and are masked by name.
        return new OrdersApiClient(withApiReporting(raw, { client: 'orders-api', rules }));
    }

    getOrder(id: string) {
        return this.ctx.get(`/orders/${id}`);
    }

    createOrder(order: { sku: string; qty: number }) {
        return this.ctx.post('/orders', { data: order, headers: { 'Idempotency-Key': crypto.randomUUID() } });
    }

    dispose() {
        return this.ctx.dispose();
    }
}
