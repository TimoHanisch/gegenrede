# ADR 0004: Snapshot delta updates

- **Status:** proposed (deferred per spec §17)
- **Date:** 2026-06-10
- **Spec sections affected:** §5, §15, §17

## Context

Index snapshots (~60 MB) are re-downloaded whole on update. Delta updates
would save bandwidth but complicate the format, the sha256-pinning integrity
story (`docs/threat-model.md` §1), and the reader.

## Decision

Deferred until size pressure makes it worthwhile; v1 ships full-snapshot
updates only.

## Consequences

Weekly auto-updates cost a full download. The snapshot format (spec §5)
should not preclude a later delta mechanism, but no provision is built now.
