# ADR 0003: Sie/du register toggle for German UI

- **Status:** proposed (deferred per spec §17)
- **Date:** 2026-06-10
- **Spec sections affected:** §11, §17

## Context

German UI copy must pick a form of address. A Sie/du toggle doubles the `de`
catalog surface for an unproven benefit.

## Decision

Deferred; v1 ships a single German register. Revisit on user feedback.

## Consequences

The `de` catalog stays single-register. If a toggle is later accepted, every
`de` key is affected — worth deciding before the catalog grows large.
