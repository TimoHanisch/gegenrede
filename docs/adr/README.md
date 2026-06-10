# Architecture Decision Records

Every architectural deviation from the spec (`docs/gegenrede-spec-v1.md`)
requires an ADR here, accepted by the maintainer **before** implementation
(spec §3, `docs/GOVERNANCE.md`). The same applies to any change to a
guardrail, prompt, schema, threshold, or rate limit.

The spec's open decisions (§17) are tracked as ADR stubs in this directory;
they are decided when their milestone provides the evidence (e.g. the
embedding-model call waits for the M1 eval report).

Format: copy [`template.md`](./template.md) to `NNNN-short-title.md` with the
next free number. Keep ADRs short — context, decision, consequences. Statuses:
`proposed` → `accepted` / `rejected`; later reversals get a new ADR that
`supersedes` the old one (never edit a decided ADR's decision).
