import fs from 'fs';
import { test } from '@playwright/test';

export const ENV_KEYS = [
    'API_REPORT_ENABLED', 'API_REPORT_LAYOUT', 'API_REPORT_MAX_BODY_CHARS', 'API_REPORT_MAX_RAW_BYTES', 'API_REPORT_MAX_PAGE_BYTES',
    'API_REPORT_MAX_PER_TEST', 'API_REPORT_MASK_BODY_FIELDS', 'API_REPORT_MASK_HEADERS', 'API_REPORT_MASK_QUERY_PARAMS',
    'API_REPORT_SHOW_BODIES', 'API_REPORT_ATTACHMENT_NAME', 'API_REPORT_DEBUG',
];

export function clearEnv(): void {
    for (const key of ENV_KEYS) delete process.env[key];
}

export interface AttachedPage { name: string; path: string; html: string }

/** The HTML pages attached so far in the running test, oldest first, read back from their files. */
export function attachedPages(): AttachedPage[] {
    return test.info().attachments
        .filter(a => a.contentType === 'text/html')
        .map(a => ({ name: a.name, path: a.path ?? '', html: a.path ? fs.readFileSync(a.path, 'utf8') : a.body?.toString('utf8') ?? '' }));
}
