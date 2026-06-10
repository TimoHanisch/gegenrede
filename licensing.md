# Licensing

gegenrede uses two licenses for two different kinds of content:

## Code — AGPL-3.0-only

All source code in this repository is licensed under the **GNU Affero General Public License v3.0** (see `LICENSE`).

Why AGPL and not MIT/Apache: the primary misuse vector for this codebase is a closed fork operated as a network service — the same pipeline with guardrails stripped is an astroturfing tool (see `GUARDRAILS.md`). AGPL's network clause (§13) requires anyone running a modified version as a service to publish their source. It cannot prevent abuse, but it removes the quiet-commercial-fork path and matches the project's transparency positioning. This choice is deliberate and documented; proposals to relicense follow the ADR process.

Every source file carries the SPDX header:

```
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors
```

## Index data — CC BY-SA 4.0

The published fact-check index snapshots (`.ggx` files and any derived datasets) contain claim texts, verdicts, publisher names, dates, and links to the original fact-checks — no article bodies. This compilation is published under **Creative Commons Attribution-ShareAlike 4.0** (https://creativecommons.org/licenses/by-sa/4.0/).

Attribution requirement for reuse: credit "gegenrede fact-check index" with a link to this repository, **and** preserve the per-record publisher attribution — the underlying fact-checking work belongs to the named organizations (Correctiv, dpa-Faktencheck, AFP, BR24 Faktenfuchs, EUvsDisinfo, and others), and the index exists to route traffic and credit to them, not to replace them.

## Third-party content

Fact-check verdicts and claims are facts reported by their respective publishers; linked articles remain under their publishers' own terms. The embedding model (`intfloat/multilingual-e5-small`) is MIT-licensed by its authors. Dependencies retain their own licenses (see lockfile; license compatibility is CI-checked).
