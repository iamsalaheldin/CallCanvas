/**
 * Domain rules on top of the defaults: patterns a NAME cannot catch (a phone number inside free text,
 * a signed download-link parameter, a person's name under many key spellings), plus literal secrets
 * read from the environment. Copy what applies and adjust the patterns to your data.
 */
import {
    defineRules,
    fieldRule,
    leakCheck,
    registerSecrets,
    textRule,
    withoutRules,
    defaultRules,
    type SanitizeRules,
} from 'callcanvas';

/** International phone numbers in E.164 form, with or without the `+`. Tighten to your country's format if you can. */
const E164_PHONE = /(?<!\d)\+?[1-9]\d{7,14}(?!\d)/;
/** Signed download-link parameters: keep the first 6 characters so links can still be told apart. */
const SIGNED_PARAM = /([?&](?:sig|signature|X-Amz-Signature)=)([^&#\s"'<>]{0,6})[^&#\s"'<>]*/i;
/** A person's name under the usual key spellings. */
const PERSON_NAME_KEY = /^(full|first|last|holder|customer|driver|insured|owner|beneficiary)?name$/i;

export const domainRules: SanitizeRules = defineRules({
    text: [
        textRule('phone', E164_PHONE, '<phone>'),
        textRule('signed-link', SIGNED_PARAM, '$1$2…'),
    ],
    fields: [
        fieldRule('person-name', PERSON_NAME_KEY),
        fieldRule('contact-data', /e-?mail|mobile|phone|dateofbirth|birthdate|dob|address/i),
        fieldRule('national-id', ['nationalId', 'ssn', 'taxId', 'passportNumber']),
        fieldRule('document-media', ['documentMedia', 'fileContent'], value => `<media ${String(value).length} chars>`),
    ],
    leaks: [
        leakCheck('phone', E164_PHONE, 'Text still contains a phone number.'),
        leakCheck('session-cookie', /\b(?:sessionid|connect\.sid|JSESSIONID)=/i, 'Text still contains a session cookie.'),
    ],
});

/** A team that wants e-mails visible in its reports drops that default by name — text rule and leak check together. */
export const rulesWithEmailsVisible: SanitizeRules = withoutRules(defaultRules, 'email');

/** Literal values the test process knows: register once (a worker fixture, global setup) and they vanish from every page. */
export function registerEnvironmentSecrets(): void {
    registerSecrets(process.env.API_PASSWORD, process.env.API_CLIENT_SECRET, process.env.SESSION_TOKEN);
}
