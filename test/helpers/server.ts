import http from 'http';
import type { AddressInfo } from 'net';

export interface Seen { method: string; url: string; body: string; headers: http.IncomingHttpHeaders }

export interface TestServer {
    base: string;
    seen: Seen[];
    close(): Promise<void>;
}

export const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJVc2VySWQiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVl';
export const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n', 'latin1'), Buffer.from(Array.from({ length: 64 }, (_, i) => i)), Buffer.from('\n%%EOF\n')]);

/** A local HTTP server with one route per body shape the reporter handles. Records what it received. */
export async function startServer(): Promise<TestServer> {
    const seen: Seen[] = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            seen.push({ method: req.method ?? '', url: req.url ?? '', body, headers: req.headers });
            const path = (req.url ?? '').split('?')[0];
            switch (path) {
                case '/json':
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'session=abc123; Path=/', 'X-Trace': 'trace-1' });
                    res.end(JSON.stringify({ ok: true, token: 'response-secret-token', customer: { name: 'Someone', mobile: '+14155550123', email: 'someone@example.com', customerId: '1098765432' }, items: [1, 2.5, false, null] }));
                    return;
                case '/notfound':
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ errorCode: 'NF001', message: 'nothing here' }));
                    return;
                case '/boom':
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('kaboom');
                    return;
                case '/xml':
                    res.writeHead(200, { 'Content-Type': 'application/xml' });
                    res.end('<?xml version="1.0"?><root><item id="1">one</item></root>');
                    return;
                case '/html':
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<html><body><script>alert("xss")</script><h1>Page</h1></body></html>');
                    return;
                case '/empty':
                    res.writeHead(204);
                    res.end();
                    return;
                case '/pdf':
                    res.writeHead(200, { 'Content-Type': 'application/pdf' });
                    res.end(PDF);
                    return;
                case '/pdf-in-text':
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('log line\n%PDF-1.7 bytes follow\nmore');
                    return;
                case '/redirect':
                    res.writeHead(302, { Location: '/json' });
                    res.end();
                    return;
                case '/slow':
                    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('late'); }, 1500);
                    return;
                case '/big':
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ rows: Array.from({ length: 400 }, (_, i) => ({ i, text: 'x'.repeat(40) })) }));
                    return;
                default:
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ echo: { method: req.method, url: req.url, body } }));
            }
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        seen,
        close: () => new Promise<void>(resolve => server.close(() => resolve())),
    };
}
