# ADR 0005: Firefox Android support

- **Status:** proposed (deferred post-M4 per spec §17)
- **Date:** 2026-06-10
- **Spec sections affected:** §7.1, §17

## Context

WXT supports Firefox Android targets, but mobile brings untested constraints:
model/index download sizes on mobile connections, overlay UI on small
screens, adapter behavior on mobile DOMs.

## Decision

Deferred to post-M4. v1 targets desktop Chrome and Firefox only.

## Consequences

No mobile entry point in v1 (a share-sheet flow is a separate post-PoC idea,
architecture doc §7 Phase 3). Nothing in the extension should hard-code
desktop-only assumptions where avoiding them is free.
