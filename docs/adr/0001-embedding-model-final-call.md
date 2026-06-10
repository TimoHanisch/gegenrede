# ADR 0001: Embedding model — e5-small vs. static-embedding small model

- **Status:** proposed (stub; decided after the M1 eval)
- **Date:** 2026-06-10
- **Spec sections affected:** §6, §15, §17

## Context

Spec §6 pins multilingual-e5-small for v1. A static-embedding small model
would cut the ~120 MB model download by roughly 10×, at unknown recall cost.
The golden-set eval (spec §14) is the deciding instrument.

## Decision

Deferred until the M1 eval report exists: decided by golden-set recall@5
versus the download saving. Until then, the pinned e5-small revision stands;
changing it is a maintainer-only decision tied to snapshot compatibility.

## Consequences

TBD with the decision. Switching models invalidates published snapshots, so
the decision must land before any snapshot is published as stable.
