import fs from 'fs';
import path from 'path';
import type { TestInfo } from '@playwright/test';
import type { ApiReportConfig } from './config.js';
import type { ApiTransaction, BodyView } from './model.js';
import { renderApiReportPage, renderApiTransactionHtml, renderCallSection, type CallSummary } from './render.js';

/**
 * Per-test state and the two attachment layouts.
 *
 * Pages are written under the test's output directory and attached by PATH. Playwright copies a path
 * attachment into `<outputDir>/attachments/` the moment it is attached and every reporter reads THAT
 * copy when the run ends (the HTML reporter into `playwright-report/data/<sha1>.html`, linked so it opens
 * in a new tab; monocart and Allure copy the file; the blob reporter zips it). The per-test page is
 * therefore attached once, on the first call, and the copy is rewritten as later calls arrive — no
 * lifecycle hook, no fixture, nothing the consumer has to register.
 *
 * State is keyed by `TestInfo` in WeakMaps, so two tests in one worker (or a context shared across
 * tests through a worker-scoped fixture or `beforeAll`) never share a page or a sequence counter.
 */

const counters = new WeakMap<TestInfo, number>();

/** The per-test page under construction: rendered sections kept as strings, rewritten in place per call. */
interface TestPage {
    file: string;
    summaries: CallSummary[];
    sections: string[];
    bytes: number;
    capReached: boolean;
    /** Appends run one at a time per test: a call that lands while the first one is still attaching must not write the pre-attach file. */
    queue: Promise<void>;
}
const pages = new WeakMap<TestInfo, TestPage>();

/** The next 1-based call number of `testInfo`; `undefined` once `maxPerTest` is exhausted (warned once). */
export function nextSequence(testInfo: TestInfo, config: ApiReportConfig): number | undefined {
    const sequence = (counters.get(testInfo) ?? 0) + 1;
    counters.set(testInfo, sequence);
    if (sequence > config.maxPerTest) {
        if (sequence === config.maxPerTest + 1) {
            config.onWarning(`API_REPORT_MAX_PER_TEST (${config.maxPerTest}) reached in "${testInfo.title}"; later calls are not attached.`);
        }
        return undefined;
    }
    return sequence;
}

/** `layout: 'call'`: one page per call, attached under the step that made it. */
export async function attachCallPage(testInfo: TestInfo, tx: ApiTransaction): Promise<void> {
    const outcome = tx.response ? `→ ${tx.response.status}` : `✖ ${tx.error?.name ?? 'failed'}`;
    const name = `API #${tx.sequence} ${tx.request.method} ${tx.request.path} ${outcome} (${tx.durationMs} ms).html`;
    // The FILE name carries the `.html`: the reporters take an attachment's extension from its path, and
    // only a `.html` file opens rendered. The test's output directory is cleared by Playwright per run.
    const file = testInfo.outputPath('api-report', `${String(tx.sequence).padStart(3, '0')}-${tx.request.method.toLowerCase()}.html`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, renderApiTransactionHtml(tx), 'utf8');
    await testInfo.attach(name, { path: file, contentType: 'text/html' });
}

/**
 * `layout: 'test'` (default): every call on one page. The first call attaches the page (so the
 * attachment sits under the first call's step and in the test's attachment list); each later call
 * re-renders the page from the kept sections and overwrites the copy Playwright made when it attached.
 * Past `maxPageBytes` a call keeps its index row, URL and headers but its bodies are left out.
 */
export function appendToTestPage(testInfo: TestInfo, tx: ApiTransaction, config: ApiReportConfig): Promise<void> {
    let state = pages.get(testInfo);
    const first = !state;
    if (!state) {
        const file = testInfo.outputPath('api-report', 'api-calls.html');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        state = { file, summaries: [], sections: [], bytes: 0, capReached: false, queue: Promise.resolve() };
        pages.set(testInfo, state);
    }
    const page = state;
    // Concurrent calls (Promise.all) each wait for the previous append, so the attach-once-then-rewrite
    // sequence holds: the first call attaches, every later call rewrites the copy Playwright published.
    const run = page.queue.then(() => appendSection(testInfo, page, tx, config, first));
    page.queue = run.catch(() => undefined);
    return run;
}

async function appendSection(testInfo: TestInfo, state: TestPage, tx: ApiTransaction, config: ApiReportConfig, first: boolean): Promise<void> {
    if (state.capReached) {
        const omitted = (body: BodyView): BodyView => ({ kind: 'hidden', text: '', bytes: body.bytes, contentType: body.contentType, note: 'Body left out: the page reached API_REPORT_MAX_PAGE_BYTES.' });
        tx.request.body = omitted(tx.request.body);
        if (tx.response) tx.response.body = omitted(tx.response.body);
    }
    const section = renderCallSection(tx);
    state.sections.push(section);
    state.summaries.push({
        sequence: tx.sequence,
        method: tx.request.method,
        path: tx.request.path,
        status: tx.response?.status,
        errorName: tx.response ? undefined : tx.error?.name ?? 'failed',
        durationMs: tx.durationMs,
        bodiesOmitted: state.capReached || undefined,
    });
    state.bytes += Buffer.byteLength(section);
    if (!state.capReached && state.bytes > config.maxPageBytes) state.capReached = true;

    const html = renderApiReportPage(
        { title: testInfo.title, subtitle: `${testInfo.project.name} · ${path.relative(process.cwd(), testInfo.file)}` },
        state.summaries,
        state.sections,
    );
    fs.writeFileSync(state.file, html, 'utf8');
    if (first) {
        const name = config.attachmentName;
        await testInfo.attach(name, { path: state.file, contentType: 'text/html' });
        // Playwright copied the file as it attached it; that copy is what the reporters publish.
        const attached = [...testInfo.attachments].reverse().find(a => a.name === name && a.path);
        if (attached?.path) state.file = attached.path;
    }
}
