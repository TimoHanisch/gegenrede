# GOVERNANCE.md — How decisions are made

> **Status: stub.** The decision model and the guardrail-change process below
> are settled (architecture doc §6, `docs/GUARDRAILS.md`). Sections marked
> TODO will be expanded as the contributor base grows.

## Model: BDFL with documented invariants

gegenrede is maintained by a single maintainer (@TimoHanisch) who has final
say on all decisions — with one structural exception: the project's
invariants are **documented and bind the maintainer too**.

The guardrails G1–G8 in [`docs/GUARDRAILS.md`](./GUARDRAILS.md) — no
auto-posting, evidence-grounding, draft variance, tone floor, and the rest —
are declared **non-negotiable** here so that pull requests working against
them have a citable rejection basis. A PR "adding an auto-reply mode" is
closed with a link to this file and G2, not with a debate.

## Changing a guardrail

Proposals to change a guardrail are not forbidden, but they follow a fixed
process (see also `docs/GUARDRAILS.md`, "For contributors"):

1. An **ADR** in [`docs/adr/`](./adr/) describing the change, and which must
   engage with the documented rationale of the guardrail — "this would be
   easier without G1" is true and is not an argument.
2. **Explicit maintainer approval** of that ADR before any implementation,
   prompt, schema, threshold, or guardrail-test change lands.

The same ADR + approval process applies to any architectural deviation from
the spec (`docs/gegenrede-spec-v1.md`, §3).

## Decisions reserved to the maintainer

These are never delegated to contributors or automated agents:

- Publishing index snapshots and releases; browser-store uploads.
- Contacting fact-check organizations on behalf of the project.
- Changing the license (AGPL-3.0 for code is part of the misuse posture, see
  `docs/threat-model.md`).
- Approving guardrail, prompt, schema, threshold, or rate-limit changes.

## TODO before first release

- Contribution workflow (`CONTRIBUTING.md` with entry tasks: adapters, ingest
  sources — architecture doc §6).
- Criteria for adding co-maintainers and what, if anything, changes about the
  BDFL model when that happens.
- Code-of-conduct adoption.
