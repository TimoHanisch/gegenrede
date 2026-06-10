# gegenrede

**Evidence-grounded counter-speech, open source.**

gegenrede is a browser extension that helps you respond to misinformation on social media. Select a post, and it checks the claim against a database of professional fact-checks (Correctiv, dpa-Faktencheck, AFP, EUvsDisinfo, and others). If a match exists, it drafts a sourced reply — factual, empathic, or technique-naming — that **you** edit and post yourself, under your own name.

The research behind this is simple: public corrections rarely change the original poster's mind, but they measurably work on the silent audience reading along. The bottleneck is that writing good corrections, repeatedly, is exhausting. gegenrede removes the writing effort and keeps the human judgment.

🇩🇪 *gegenrede hilft dir, auf Desinformation zu antworten — mit belegten, quellengestützten Entwürfen, die du selbst prüfst und selbst postest. Keine Automatisierung, keine Datensammlung, kein Account.*

## What it never does

These are architectural invariants, not settings — see [`docs/GUARDRAILS.md`](docs/GUARDRAILS.md) for each one with its rationale:

**No auto-posting, ever.** The tool never holds posting credentials. Output ends at your clipboard or a prefilled reply box. **No draft without evidence.** The composer only works downstream of a matched, published fact-check — it cannot generate free-standing persuasion with an arbitrary stance. **No surveillance.** No feed scanning, no accounts, no telemetry, no tracking. Checks are user-initiated, one post at a time, and in the default Local Mode nothing leaves your device except the LLM call you yourself configure. **No identical replies.** Every draft is generated with deliberate variance, so users of this tool never look like a bot network — because they aren't one.

## How it works

Two modes, same matching contract. **Local Mode (default):** the extension downloads a fact-check index snapshot and a small multilingual embedding model once, then matches entirely in your browser — no backend, no operator, works offline. **Server Mode (optional):** a self-hosted docker compose stack with a nightly-updated index, for households, teams, or organizations.

Matching is cross-lingual: a German post can match an English or French fact-check, because viral claims travel across languages faster than debunks do. Reply drafts follow the evidence-based debunking structure (fact first, myth named once, technique explained, source cited) and come in the language of the post.

## Project status

<!-- AGENT-MAINTAINED:STATUS — update this section as milestones complete; do not edit anything outside marked sections -->
**M0 complete.** The research framework, architecture, and full implementation spec are complete (see [Documentation](#documentation)); code lands milestone by milestone. M0 closed with CI green at [`f491850`](https://github.com/TimoHanisch/gegenrede/commit/f491850):

- [x] **M0** — repo scaffold, CI, shared schemas
- [ ] **M1** — ingest pipeline, index format, golden-set evaluation *(go/no-go gate: ≥80% recall@5 on real viral German misinformation)*
- [ ] **M2** — extension with Local-Mode matching (X, Reddit, any webpage)
- [ ] **M3** — reply composer with full guardrails
- [ ] **M4** — self-host Server Mode (docker compose)
<!-- /AGENT-MAINTAINED:STATUS -->

## Installation

<!-- AGENT-MAINTAINED:INSTALL — replace after M2 produces installable builds -->
Not yet installable — the first extension builds arrive with M2. Watch the repo or check the [Releases](../../releases) page.
<!-- /AGENT-MAINTAINED:INSTALL -->

## Self-hosting

<!-- AGENT-MAINTAINED:SELFHOST — replace after M4; must reflect the tested 15-minute clean-machine setup -->
Server Mode ships with M4. The acceptance criterion is fixed: `docker compose up` plus one seed command to a working instance in under 15 minutes on a clean machine.
<!-- /AGENT-MAINTAINED:SELFHOST -->

## Documentation

| Document | What it is |
|---|---|
| [`docs/disinformation-counter-framework.md`](docs/disinformation-counter-framework.md) | The research basis — detection, prebunking, counter-speech science, with sources |
| [`docs/poc-architecture-counterspeech-extension.md`](docs/poc-architecture-counterspeech-extension.md) | Architecture rationale and trade-offs |
| [`docs/gegenrede-spec-v1.md`](docs/gegenrede-spec-v1.md) | The normative implementation spec (v1) |
| [`docs/GUARDRAILS.md`](docs/GUARDRAILS.md) | The invariants, their enforcement, and the honest residual-risk discussion |
| [`LICENSING.md`](LICENSING.md) | AGPL-3.0 (code) + CC BY-SA 4.0 (index data), and why |
| [`CLAUDE.md`](CLAUDE.md) | Operating contract for agent-driven implementation |

## Contributing

The best entry points are **platform adapters** (small, isolated, fixture-tested DOM extraction modules) and **ingest connectors** (new fact-check sources). Read `GUARDRAILS.md` before proposing features — the invariants are load-bearing, and "this would be easier without G1" is true but is not an argument. Significant parts of this codebase are implemented by a coding agent operating under `CLAUDE.md`; human review applies to everything regardless of author.

## Acknowledgments

gegenrede stands on the work of professional fact-checkers — Correctiv, dpa-Faktencheck, AFP Faktencheck, BR24 #Faktenfuchs, EUvsDisinfo, and the wider EDMO/GADMO network. The index exists to route readers *to* their work, with attribution preserved in every record. The counter-speech approach is informed by the research of Leticia Bode, Emily Vraga, Stephan Lewandowsky, Sander van der Linden, Jon Roozenbeek and colleagues, and by the practical experience of the #ichbinhier community.

## License

Code: [AGPL-3.0-only](LICENSE) · Index data: CC BY-SA 4.0 · Details and rationale: [`LICENSING.md`](LICENSING.md)
