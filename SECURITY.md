# Security policy

CallCanvas exists to keep secrets and personal data out of test reports, so a sanitization gap is
a security issue, not a bug like any other.

## Reporting

Please do **not** open a public issue for a leak. Use GitHub's private vulnerability reporting on
[this repository](https://github.com/iamsalaheldin/CallCanvas/security) ("Report a vulnerability"
under the Security tab). If that button is unavailable, open an issue that only asks for a private
contact — no details. Include a minimal reproduction: the request or response shape and the text that
survived onto a page. You will get an acknowledgement within 72 hours and a fix or a mitigation
(a rule you can add today) as soon as one exists.

## What counts

- A value masked by name, a registered secret, a JWT, or anything a default leak check names,
  appearing on a rendered page.
- A body shown after a configured cap or `showBodies: false` should have hidden it.
- Any way for page content to execute in the browser that opens the report (the pages ship with
  `default-src 'none'` and every value escaped).

## What does not

- Data your own rules did not cover: the defaults are deliberately generic, and the README explains
  how to add domain rules. We are still glad to hear about patterns common enough to become defaults.
- Headers Playwright adds itself or `extraHTTPHeaders` set on the context: they are never visible to
  the reporter, which is documented.

## Supported versions

Fixes land on the latest minor release. Older majors receive security fixes for six months after the
next major is published.
