import { test, expect } from '@playwright/test';
import { DEFAULT_ATTACHMENT_NAME, DEFAULT_MASKED_HEADERS, apiReportConfig, apiReportEnabled, defaultRules, defineRules, resolveConfig } from '../src/index.js';
import { clearEnv } from './helpers/attachments.js';

/** Options over environment over defaults, with every value read live. */

test.beforeEach(clearEnv);
test.afterEach(clearEnv);

test('defaults', () => {
    const config = resolveConfig();
    expect(config).toMatchObject({
        enabled: true,
        layout: 'test',
        maxPageBytes: 8 * 1024 * 1024,
        maxBodyChars: 64 * 1024,
        maxRawBytes: 2 * 1024 * 1024,
        maxPerTest: 200,
        showBodies: true,
        attachmentName: DEFAULT_ATTACHMENT_NAME,
    });
    expect(config.rules).toBe(defaultRules);
    expect([...config.maskHeaders]).toEqual(DEFAULT_MASKED_HEADERS);
    expect(config.maskHeaders.has('authorization')).toBe(true);
    expect(config.maskQueryParams.has('token')).toBe(true);
    expect(config.maskBodyFields.has('password')).toBe(true);
    expect(apiReportConfig()).toEqual(resolveConfig());
    expect(() => config.onWarning('silent by default')).not.toThrow();
});

test('the environment overrides the defaults and is parsed leniently', () => {
    process.env.API_REPORT_ENABLED = 'off';
    process.env.API_REPORT_LAYOUT = ' CALL ';
    process.env.API_REPORT_MAX_BODY_CHARS = '100';
    process.env.API_REPORT_MAX_RAW_BYTES = 'not a number';
    process.env.API_REPORT_MAX_PAGE_BYTES = '-5';
    process.env.API_REPORT_MAX_PER_TEST = '7';
    process.env.API_REPORT_SHOW_BODIES = '0';
    process.env.API_REPORT_MASK_HEADERS = ' X-One ,x-two,,';
    process.env.API_REPORT_MASK_QUERY_PARAMS = 'Q';
    process.env.API_REPORT_MASK_BODY_FIELDS = 'F';
    process.env.API_REPORT_ATTACHMENT_NAME = ' Mine.html ';
    const config = resolveConfig();
    expect(config).toMatchObject({ enabled: false, layout: 'call', maxBodyChars: 100, maxRawBytes: 2 * 1024 * 1024, maxPageBytes: 8 * 1024 * 1024, maxPerTest: 7, showBodies: false, attachmentName: 'Mine.html' });
    expect(config.maskHeaders.has('x-one')).toBe(true);
    expect(config.maskHeaders.has('x-two')).toBe(true);
    expect(config.maskHeaders.has('authorization')).toBe(true);
    expect(config.maskQueryParams.has('q')).toBe(true);
    expect(config.maskBodyFields.has('f')).toBe(true);
    for (const value of ['true', 'True', '1', 'yes', 'on', '']) {
        process.env.API_REPORT_ENABLED = value;
        expect(apiReportEnabled(), value).toBe(true);
    }
    for (const value of ['false', 'False', '0', 'no', 'off']) {
        process.env.API_REPORT_ENABLED = value;
        expect(apiReportEnabled(), value).toBe(false);
    }
});

test('options override the environment; invalid numbers fall back', () => {
    process.env.API_REPORT_ENABLED = 'false';
    process.env.API_REPORT_LAYOUT = 'call';
    process.env.API_REPORT_MAX_BODY_CHARS = '100';
    process.env.API_REPORT_MASK_HEADERS = 'x-env';
    const rules = defineRules({});
    const onWarning = (): void => undefined;
    const config = resolveConfig({
        enabled: true, layout: 'test', maxBodyChars: 10, maxRawBytes: 0, maxPageBytes: Number.NaN, maxPerTest: -1,
        showBodies: false, maskHeaders: ['X-Opt'], rules, attachmentName: 'Opt.html', onWarning,
    });
    expect(config).toMatchObject({ enabled: true, layout: 'test', maxBodyChars: 10, maxRawBytes: 2 * 1024 * 1024, maxPageBytes: 8 * 1024 * 1024, maxPerTest: 200, showBodies: false, attachmentName: 'Opt.html' });
    expect(config.maskHeaders.has('x-env')).toBe(true);
    expect(config.maskHeaders.has('x-opt')).toBe(true);
    expect(config.rules).toBe(rules);
    expect(config.onWarning).toBe(onWarning);
    expect(apiReportEnabled({ enabled: true })).toBe(true);
    expect(apiReportEnabled({ enabled: false })).toBe(false);
});

test('API_REPORT_DEBUG routes warnings to the console when no callback is given', () => {
    const seen: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { seen.push(args[0]); };
    try {
        resolveConfig().onWarning('quiet');
        expect(seen).toEqual([]);
        process.env.API_REPORT_DEBUG = 'true';
        resolveConfig().onWarning('loud');
        expect(seen).toEqual(['[callcanvas] loud']);
    } finally {
        console.warn = original;
    }
});
