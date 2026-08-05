# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub Security Advisories: go to the repository's
**Security** tab and choose **Report a vulnerability**. That opens a private
channel with the maintainers. We aim to acknowledge a report within a few days.

Helpful things to include: the affected version (`modsearch --version`), the URL
or input that triggers it, and the smallest reproduction you can manage.

## Scope

The most sensitive surface is the local `http` fetch engine, which makes requests
to URLs an agent may have pulled from untrusted page content. Its SSRF guards,
the one known DNS-rebinding gap, and how untrusted content is handled are
documented in [docs/security.md](docs/security.md). Read that first: a report
about the already-documented rebinding window is not a new finding.
