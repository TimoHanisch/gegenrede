# ADR 0002: X reply length — assume 280 for non-premium

- **Status:** accepted (v1 assumption per spec §17)
- **Date:** 2026-06-10
- **Spec sections affected:** §10.3 (G5), §17

## Context

X allows longer posts for premium accounts, but the extension cannot reliably
know the user's tier, and drafts must fit the platform (G5).

## Decision

v1 assumes the non-premium limit of 280 characters for all X drafts.

## Consequences

Premium users get shorter drafts than they could post — a safe, conservative
degradation. Revisit only if tier detection becomes reliable and worth the
complexity; that change would need a new ADR.
