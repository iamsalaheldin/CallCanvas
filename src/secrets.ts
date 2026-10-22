/**
 * Literal values that must never reach a page: passwords, API keys, session ids a test read from its
 * environment. Registered once (a fixture, global setup of the worker), matched literally and
 * longest-first on every piece of text, so a secret contained in a longer registered value is still
 * removed whole. Short values are ignored: a one- or two-character "secret" would blank out most of
 * a body and hide the detail a reader came for.
 */

const secrets = new Set<string>();

export const MIN_SECRET_LENGTH = 4;

/** Registers literal values to remove from every page. `undefined` / `null` and values shorter than 4 characters are skipped. */
export function registerSecrets(...values: Array<string | undefined | null>): void {
    for (const value of values) {
        if (typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) secrets.add(value);
    }
}

/** Forgets every registered value. Test support, or a worker that switches tenants. */
export function clearRegisteredSecrets(): void {
    secrets.clear();
}

/** How many values are registered right now. */
export function registeredSecretCount(): number {
    return secrets.size;
}

/** Replaces every registered value in `text` by `***`, longest first. */
export function redactSecrets(text: string): string {
    if (typeof text !== 'string' || text.length === 0 || secrets.size === 0) return text;
    let out = text;
    for (const secret of Array.from(secrets).sort((a, b) => b.length - a.length)) {
        out = out.split(secret).join('***');
    }
    return out;
}
