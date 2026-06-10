# ADR 0006: Hosted instance and funding-application timing

- **Status:** proposed (open per spec §17)
- **Date:** 2026-06-10
- **Spec sections affected:** §17; architecture doc §6

## Context

The project profile fits Prototype Fund (BMBF) and NLnet / NGI Zero. A
hosted instance changes the privacy posture (today: no vendor backend,
`docs/PRIVACY.md`) and creates operating costs. The M1 eval report is the
strongest attachment a funding application could have.

## Decision

Open. Application timing is anchored to the M1 eval outcome; a hosted
instance is not planned for v1.

## Consequences

Until decided, all documentation and settings copy continue to assume
self-hosted Server Mode only. A hosted instance would require revisiting
`docs/PRIVACY.md` and the GDPR posture before launch. Human-only decision
(`docs/GOVERNANCE.md`).
