<!--
Thanks for contributing to gegenrede! Please keep real post text and author
handles out of this description, screenshots, and any fixtures — describe or
anonymize them instead (docs/PRIVACY.md).
-->

## Summary

<!-- What changed and why. If anything was skipped or stubbed, say so and why. -->

## Linked issue

Closes #

## Guardrails

gegenrede has non-negotiable invariants (docs/GUARDRAILS.md). PRs that weaken
them are closed per docs/GOVERNANCE.md; guardrail changes go through the ADR
process **before** implementation.

- [ ] This change does not conflict with guardrails G1–G8
- [ ] No changes to guardrail tests, prompts (`shared/prompts/`), zod schemas
      in `packages/shared`, thresholds, or rate limits — or a maintainer
      approved them first (link the issue/ADR above)
- [ ] No real post text, author handles, or other personal data in code,
      fixtures, tests, screenshots, or this description

## Definition of done

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm i18n:check` passes locally
- [ ] New logic has new tests; bug fixes include a regression test
- [ ] New i18n keys added to **both** the `de` and `en` catalogs
- [ ] New source files carry the AGPL-3.0 SPDX header (`pnpm headers:check`)
- [ ] Formatting passes (`pnpm format:check`)
- [ ] No new dependencies beyond the approved list (CLAUDE.md), or they were
      proposed and approved first
- [ ] Unknown external shapes (feeds, APIs) are fixtures labeled
      `FIXTURE — UNVERIFIED SHAPE` with a `TODO(verify):`, not invented values
