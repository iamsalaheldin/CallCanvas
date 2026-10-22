/**
 * Sanitization rules are DATA, not code the engine knows about: a rule set says which free-text patterns
 * are replaced, which structured fields are masked by key, and which patterns must not survive into a
 * page. The package ships a generic set ({@link defaultRules}); a framework adds its own on top with
 * {@link defineRules}, or drops one of the defaults by name with {@link withoutRules}.
 *
 * Masking by NAME (header / query parameter / body field lists) is configured separately, on the
 * reporting options; rules are for everything a name cannot catch: a JWT inside a message, an e-mail
 * inside free text, a personal field under a hundred different key spellings.
 */

export interface TextRule {
    /** Unique within a rule set; a consumer can drop a default by this name. */
    name: string;
    /** Matched over free text. Needs the global flag; {@link textRule} adds it. */
    pattern: RegExp;
    /** A replacement string (`$1` references allowed) or a function of the match and its groups. */
    replace: string | ((match: string, ...groups: string[]) => string);
}

export interface FieldRule {
    name: string;
    /** Whether a JSON / form / multipart field is masked, given its key and value. */
    matches: (key: string, value: unknown) => boolean;
    /** What replaces the value; `***` when omitted. */
    replace?: (value: unknown, key: string) => unknown;
}

export interface LeakCheck {
    name: string;
    /** TESTED (never replaced) over the sanitized text. A hit withholds the text and shows `message` instead. */
    pattern: RegExp;
    message: string;
}

export interface SanitizeRules {
    text: readonly TextRule[];
    fields: readonly FieldRule[];
    leaks: readonly LeakCheck[];
}

export const MASK = '***';

/** A free-text rule. The pattern gets the global flag when it lacks one, so every occurrence is replaced. */
export function textRule(name: string, pattern: RegExp, replace: TextRule['replace']): TextRule {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    return { name, pattern: new RegExp(pattern.source, flags), replace };
}

/**
 * A field rule by key: a regular expression tested against the key, or a list of names matched
 * case-insensitively. The value is replaced by `***` unless `replace` says otherwise.
 */
export function fieldRule(name: string, keys: RegExp | readonly string[], replace?: FieldRule['replace']): FieldRule {
    if (keys instanceof RegExp) {
        const pattern = new RegExp(keys.source, keys.flags.replace('g', ''));
        return { name, matches: key => pattern.test(key), replace };
    }
    const names = new Set(keys.map(key => key.toLowerCase()));
    return { name, matches: key => names.has(key.toLowerCase()), replace };
}

/** A leak check: `pattern` must not match the sanitized text; when it does, `message` is shown instead. */
export function leakCheck(name: string, pattern: RegExp, message: string): LeakCheck {
    return { name, pattern: new RegExp(pattern.source, pattern.flags.replace('g', '')), message };
}

/** A rule set with nothing in it. The base to pass to {@link defineRules} for a set built from scratch. */
export const emptyRules: SanitizeRules = Object.freeze({ text: [], fields: [], leaks: [] });

/** `base` (the defaults unless told otherwise) with `extra` appended. Rules run in order; the defaults first. */
export function defineRules(extra: Partial<SanitizeRules>, base: SanitizeRules = defaultRules): SanitizeRules {
    return Object.freeze({
        text: [...base.text, ...(extra.text ?? [])],
        fields: [...base.fields, ...(extra.fields ?? [])],
        leaks: [...base.leaks, ...(extra.leaks ?? [])],
    });
}

/** `rules` without every text rule, field rule and leak check carrying one of `names`. */
export function withoutRules(rules: SanitizeRules, ...names: string[]): SanitizeRules {
    const drop = new Set(names);
    return Object.freeze({
        text: rules.text.filter(rule => !drop.has(rule.name)),
        fields: rules.fields.filter(rule => !drop.has(rule.name)),
        leaks: rules.leaks.filter(rule => !drop.has(rule.name)),
    });
}

/** Three base64url segments starting with `eyJ` (`{"` encoded): a JWT or anything shaped like one. */
export const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/;
/** A base64-encoded PDF (`%PDF` encodes to `JVBERi0`). */
export const BASE64_PDF_PATTERN = /JVBERi0[A-Za-z0-9+/=]*/;
/** Any other long base64 run: an embedded file, a certificate, a blob. */
export const LONG_BASE64_PATTERN = /[A-Za-z0-9+/]{200,}={0,2}/;
/** Local part bounded to RFC 5321's 64 characters: unbounded, a long run with no `@` is quadratic. */
export const EMAIL_PATTERN = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
/** Credential-like keys under any spelling: `password`, `clientSecret`, `refresh_token`, `x-api-key`, `sessionId`… */
export const CREDENTIAL_KEY_PATTERN = /password|passwd|secret|credential|private[-_]?key|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|bearer|session[-_]?id|authorization|^token$|^otp$|^pin$|^cookie$|^set-cookie$/i;

/**
 * The generic rules every page gets unless a consumer says otherwise:
 *  - text: JWTs → `<jwt>`, base64 PDFs → `<pdf base64 N chars>`, long base64 → `<base64 N chars>`, e-mails → `<email>`;
 *  - fields: credential-like keys → `***`;
 *  - leaks: a JWT, a base64 or raw PDF, or an e-mail that survived sanitizing withholds the text.
 * Personal data beyond e-mail (phone formats, names, ids) is country- and domain-specific, so it is
 * left to the consumer's rules — see the README for the pattern.
 */
export const defaultRules: SanitizeRules = Object.freeze({
    text: [
        textRule('jwt', JWT_PATTERN, '<jwt>'),
        textRule('base64-pdf', BASE64_PDF_PATTERN, match => `<pdf base64 ${match.length} chars>`),
        textRule('long-base64', LONG_BASE64_PATTERN, match => `<base64 ${match.length} chars>`),
        textRule('email', EMAIL_PATTERN, '<email>'),
    ],
    fields: [
        fieldRule('credential-keys', CREDENTIAL_KEY_PATTERN),
    ],
    leaks: [
        leakCheck('jwt', JWT_PATTERN, 'Text still contains a JWT.'),
        leakCheck('base64-pdf', /JVBERi0[A-Za-z0-9+/=]{40,}/, 'Text still contains a base64 PDF.'),
        leakCheck('raw-pdf', /%PDF-\d/, 'Text still contains raw PDF bytes.'),
        leakCheck('email', EMAIL_PATTERN, 'Text still contains an e-mail address.'),
    ],
});
