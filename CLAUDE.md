# CLAUDE.md — Agent Implementation Guide for gegenrede

You are implementing gegenrede, an open-source counter-speech browser extension. This file is your operating contract. Read it fully before writing any code.

## Source-of-truth hierarchy

1. `docs/gegenrede-spec-v1.md` (THE SPEC) — normative, MUST/SHOULD language applies to you
2. `docs/GUARDRAILS.md` — invariants G1–G8; these are never negotiable
3. `docs/adr/` — accepted deviations from the spec
4. This file — process rules
5. Your own judgment — only within the gaps the above leave open

On any conflict between these sources, or between the spec and reality (an API that doesn't exist as described, a library that can't do what's specced): **STOP and ask the human.** Do not improvise a resolution and do not silently substitute.

## Hard rules — violating any of these is a failed task, even if tests pass

1. **No posting pathways.** Never write code that submits content to a platform on the user's behalf. No platform write-API calls, no synthetic click/submit events on compose forms beyond prefilling text. The CI grep-gate (`.github/workflows/guardrails.yml`) enforces this; if it blocks you, the answer is to remove the code, never to adjust the gate.
2. **Never weaken a guardrail to make something pass.** If a guardrail test (G1–G8) fails, the implementation is wrong, not the test. Changing guardrail tests, schemas (e.g. making `match` optional in `ComposeRequest`), prompts in `shared/prompts/`, or rate-limit ceilings requires explicit human approval first — propose, then wait.
3. **No fabrication.** Do not invent API endpoints, RSS feed URLs, response shapes, model names, or config values. The spec marks known unknowns (§17 + the registry below). For an unknown: implement against a typed interface, commit a recorded or hand-written fixture clearly labeled `FIXTURE — UNVERIFIED SHAPE`, add a `TODO(verify):` comment, mark the integration test `.skip` with a reason string, and list it in your task summary. A fabricated-but-plausible feed URL is worse than a skipped test.
4. **No secrets, no telemetry.** No API keys, tokens, or real usernames in code, fixtures, or tests — env only, fixtures scrubbed. Do not add any analytics, crash reporting, or phone-home behavior, including "just for debugging."
5. **Privacy invariants in code:** `authorHandle` must never appear in any outbound serialization (there is a test for this — keep it passing); post text must never be logged by default (`LOG_BODIES` gate).
6. **Embedding discipline:** every embed call goes through `shared/embedText(kind, text)` (E5 `query:`/`passage:` prefixes). Never call the tokenizer/model directly. Never change the pinned model revision — that is a human decision tied to snapshot compatibility.
7. **AGPL-3.0 headers** on every source file (CI-checked). All new files `type: module`, TS strict — no `any` without an inline justification comment, no `@ts-ignore` without an issue reference.

## Decision boundaries

**You decide alone:** file organization within the spec's §3 layout; internal naming; test structure; refactors that change no public contract; CSS details within the §7.5 tokens; error-message copy (must go through i18n catalogs).

**You propose and wait for human approval:** new dependencies beyond the approved list below; any change to zod schemas in `packages/shared`; any change to prompts, guardrails, thresholds, or rate limits; DB schema migrations after M1; anything touching the release/publish pipeline; adding a platform adapter beyond x/reddit/generic.

**Human-only (never do these):** publishing snapshots or releases; store uploads; sending email to fact-check organizations; changing the license.

## Approved dependency list (initial)

Runtime: `wxt`, `preact`, `@preact/signals`, `zod`, `hono`, `@hono/node-server`, `drizzle-orm`, `postgres`, `@huggingface/transformers`, `onnxruntime-node`, `tinyld`.
Dev/build: `typescript`, `vitest`, `happy-dom`, `@playwright/test`, `turbo`, `@changesets/cli`, `eslint` + `typescript-eslint`, `prettier`, `tsx`, `drizzle-kit`, `@types/node` (types-only; approved in #11).
Notably absent on purpose — do not add: React (use Preact), i18next (use the spec's <2 kB typed helper, §11), Tailwind (§7.1), axios (use fetch), any ORM other than Drizzle, any state library beyond signals.
Anything else: propose with a one-paragraph justification (what it does, bundle cost, why not stdlib).

## Known-unknowns registry (handle per Hard Rule 3)

- RSS/sitemap URLs for Correctiv, dpa-Faktencheck, AFP DE, BR24 Faktenfuchs → config file `services/ingest/sources.json`, fixtures only
- EUvsDisinfo export → documented API (api.veedoo.io, per the euvsdisinfoR wrapper) likely retired since ~2020; connector stays fixture-only (parser behind interface), no live pulls or cron scheduling; route decision tracked in #70
- Google Fact Check Tools API → response shape per official docs; key via `GOOGLE_FC_API_KEY`; integration test skipped without key
- Mistral model strings / pricing → settings defaults marked `TODO(verify)`
- X non-premium reply length → assume 280 (§17)

## Workflow

Work milestone-by-milestone in spec order (M0 → M4, §16). Do not start Mn+1 while Mn exit criteria fail. Within a milestone, one self-contained task per commit; conventional commits (`feat(extension): …`, `fix(ingest): …`). Before marking any task done, run and pass:

```
pnpm typecheck && pnpm lint && pnpm test && pnpm i18n:check
```

plus the milestone-specific gates: M1 → `pnpm eval` produces the report (do not proceed past M1 without showing the human the recall numbers — this is the product's go/no-go gate, §14); M2 → `pnpm -F extension build` emits Chrome+Firefox zips; M3 → guardrail matrix `pnpm test -- guardrails` fully green; M4 → `deploy/selfhost-smoke.sh` passes on a clean container.

Definition of done for every task: code + tests (new logic ⇒ new tests; bug fix ⇒ regression test first), i18n keys added to **both** `de` and `en` catalogs, no budget regressions (§15), and a 3–6 line summary stating what was built, what was skipped/stubbed (with reasons), and any spec ambiguity encountered.

## Testing discipline

Unit tests are hermetic: no network, no real LLM calls (mock the OpenAI-compatible interface at the provider boundary), no live platform DOM (committed fixtures only, scrubbed of real user data). Determinism: composer tests assert structure (G-checks), never exact generated strings. The golden eval set (`data/eval/golden-de.jsonl`) is human-curated — you may write the runner and the schema, but never add, remove, or edit eval items to improve scores.

## Common failure modes — check yourself against these before every commit

Omitting E5 prefixes (silent recall collapse). Importing React out of habit. Declaring schema types locally instead of importing from `packages/shared`. Putting keys in `storage.sync`. Making `ComposeRequest.match` optional "for testing." Logging post text. Hardcoding German strings outside catalogs (or adding `en` keys without `de`). Letting host-page CSS into the overlay (everything renders in the closed shadow root). Fixture files containing real handles. Adding a dependency to save 20 lines. "Improving" a guardrail you found inconvenient.

## When stuck

If a spec requirement appears impossible, contradictory, or significantly more complex than the spec implies: stop, write a short problem statement (what the spec says, what reality says, 2–3 options with trade-offs), and ask. An honest blocker report is a successful outcome; a quiet workaround that violates the spec is not.
