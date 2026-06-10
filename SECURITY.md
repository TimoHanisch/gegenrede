# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub private vulnerability reporting](https://github.com/TimoHanisch/gegenrede/security/advisories/new)
("Report a vulnerability" on the repository's Security tab). Do **not** open a
public issue for security reports.

Please include steps to reproduce, the affected component (extension,
`services/api`, `services/ingest`, snapshot pipeline), and impact as you
understand it.

## Disclosure window

We follow coordinated disclosure with a **90-day window**: we will
acknowledge your report promptly, work on a fix, and you are free to publish
details 90 days after the initial report (earlier by mutual agreement once a
fix has shipped, or later if we agree an extension is warranted).

## Scope notes

- gegenrede ships no vendor backend: Server Mode talks to **your own
  server**. Vulnerabilities in the self-hosted services are in scope;
  misconfiguration of individual deployments is not.
- Secrets are never committed — configuration is environment-only, and CI
  runs secret scanning. If you find a leaked credential anyway, report it via
  the channel above.
- The project's threat model lives in
  [`docs/threat-model.md`](./docs/threat-model.md); reports that bypass a
  documented mitigation (e.g. snapshot hash pinning) are especially valuable.
