# gegenrede — Implementation Specification v1.0 (PoC, Phases 0–2)

**Status:** Draft for implementation · June 2026
**Scope:** Full TypeScript · Local Mode (offline, baked-in backend) + Server Mode (self-hosted, docker compose) · Reply composer included · i18n de/en
**Companions:** `disinformation-counter-framework.md` (research basis), `poc-architecture-counterspeech-extension.md` (architecture rationale)
**License posture:** AGPL-3.0 (code), CC BY-SA 4.0 (index data)

How to read this document: every normative requirement uses MUST / SHOULD / MAY (RFC 2119 sense). Blocks marked **Rationale (research)** tie a decision back to the evidence base in the framework doc, so contributors understand *why* a constraint exists before trying to "improve" it away.

---

## 1. Product summary

gegenrede is a browser extension that lets a user check a social media post or article passage against a database of professional fact-checks and, when a match is found, drafts evidence-grounded counter-speech replies that the user edits and posts manually. It ships in two interchangeable modes:

**Local Mode (default).** The extension is fully self-contained: it lazily downloads a prebuilt index snapshot (fact-check claims + quantized embeddings) and an on-device embedding model, then performs matching entirely in the browser. No backend required, nothing leaves the device except the optional LLM call for normalization/composing — and even that can stay on-device via a local Ollama endpoint. This is the "baked-in backend."

**Server Mode (optional).** A self-hosted docker compose stack (Postgres + pgvector, API service, ingest jobs) that provides a fresher index, server-side embedding (faster cold start, no model download), and centrally configured LLM access for a household/team/org. The extension talks to it via a user-configured base URL.

Both modes implement the identical matching contract (Section 8), so the extension code path differs only in the `MatcherProvider` implementation behind one interface.

**Success criteria (unchanged from architecture doc):** selection → sourced reply in clipboard in <30s; match-rate ≥30% on a golden set of viral German-language misinformation (Section 14 defines the eval); zero auto-posting pathways in the codebase.

## 2. Architecture overview

```
                            ┌───────────────────────────────────────────┐
                            │              EXTENSION (MV3)              │
                            │                                           │
  user selects post ───────▶│ adapter.extract() ─▶ pipeline.check()     │
                            │                        │                  │
                            │     MatcherProvider (interface)           │
                            │      ├─ LocalMatcher                      │
                            │      │   embed (transformers.js/ONNX)     │
                            │      │   search (int8 dot-product, OPFS)  │
                            │      └─ RemoteMatcher → POST /v1/check    │
                            │                        │                  │
                            │     ComposerProvider (interface)          │
                            │      ├─ DirectLLM (BYO key / Ollama)      │
                            │      └─ RemoteComposer → POST /v1/compose │
                            └───────────────────────────────────────────┘
                                         │ (Server Mode only)
                                         ▼
        ┌──────────────────────── docker compose ───────────────────────┐
        │  api (Node/Hono)   postgres:17 + pgvector    ingest (cron)    │
        └────────────────────────────────────────────────────────────────┘

  index snapshots: built by ingest, published as GitHub Release assets;
  Local Mode pulls from there, Server Mode queries Postgres directly.
```

| Concern | Local Mode | Server Mode |
|---|---|---|
| Index freshness | snapshot cadence (weekly) | nightly ingest |
| First-use cost | model (~120 MB) + index (~60 MB) download, cached | none beyond config |
| Privacy surface | nothing leaves device except LLM calls | post text sent to *your own* server |
| Normalization quality | raw-cleanup, LLM-assisted only if LLM configured | LLM-assisted if self-hoster sets a key |
| Who runs infra | nobody | the self-hoster |

**Rationale (research/positioning):** the offline-first requirement is not a convenience feature. Trust is the product in this category, and "auditable code + nothing phones home" is the strongest available answer to the arbiter-of-truth objection. It also makes the extension distributable without anyone operating production infrastructure — appropriate for a solo-maintainer OSS project (bus-factor mitigation, framework doc §6/§9).

## 3. Monorepo, tooling, conventions

pnpm workspaces + Turborepo. Node 22 LTS. TypeScript 5.x `strict: true` everywhere, `"type": "module"` everywhere. ESLint (typescript-eslint, no style rules) + Prettier defaults. Vitest for unit tests. Changesets for versioning. GitHub Actions CI (Section 14).

```
gegenrede/
├─ packages/
│  ├─ shared/          # zod schemas, canonical types, verdict/technique taxonomies, i18n keys type
│  ├─ index-format/    # snapshot binary reader/writer + int8 search kernel (pure TS, no deps)
│  └─ extension/       # WXT project (MV3, Chrome+Firefox targets)
├─ services/
│  ├─ api/             # Hono server: /v1/check, /v1/compose, /v1/snapshot
│  └─ ingest/          # source connectors, ClaimReview parser, snapshot builder CLI
├─ data/
│  └─ eval/            # golden-de.jsonl, golden-en.jsonl + eval runner
├─ deploy/
│  └─ docker-compose.yml, Dockerfiles, .env.example
├─ docs/               # SPEC (this file), PRIVACY.md, GUARDRAILS.md, GOVERNANCE.md, ADRs
└─ .github/            # CI, issue templates, CODEOWNERS
```

Conventions: all cross-boundary payloads validated with zod schemas exported from `packages/shared` — the extension, API, and ingest MUST import these rather than redeclare. Every architectural deviation from this spec requires an ADR in `docs/adr/`.

## 4. Shared domain model (`packages/shared`)

### 4.1 Canonical verdict taxonomy

Publisher ratings are wildly heterogeneous ("Falsch", "Fehlender Kontext", "Four Pinocchios", "pants-fire"). Ingest maps them to a closed canonical set; the UI always shows **both** the canonical verdict (icon + color + localized label) and the publisher's original rating verbatim.

```ts
export const Verdict = z.enum([
  'false', 'mostly_false', 'misleading',   // includes missing-context
  'unproven',                               // unverifiable / disputed
  'mostly_true', 'true',
  'satire',
]);
```

Mapping table lives in `shared/src/verdict-map.ts` as `Record<string /* publisher:rating_raw lowercased */, Verdict>` with a required fallback to `unproven` + a logged warning (never guess toward `false`). **Rationale (research):** showing the original publisher rating preserves transparency and leans on the publisher's credibility — the source-credibility literature shows the *who* of a rating drives acceptance (framework doc §2.3); over-aggregating into a bare red X discards that.

### 4.2 Technique taxonomy

```ts
export const Technique = z.enum([
  'scapegoating', 'decontextualization', 'discrediting',
  'fake_experts', 'emotional_manipulation', 'polarization',
  'conspiracy_framing', 'impersonation',
]);
```

This is deliberately the taxonomy validated in the EU prebunking deployments (framework doc §2.2) plus the Bad News technique set — not an invented one — so display copy can link to existing inoculation explainers. Technique hints are ALWAYS displayed hedged ("Mögliche Technik" / "Possible technique") and MUST NOT appear without a fact-check match in v1 (a technique label on unmatched content is an unsubstantiated accusation; defamation-adjacent risk).

### 4.3 Core types

```ts
export const ExtractedPost = z.object({
  text: z.string().min(8).max(8000),
  url: z.string().url(),
  lang: z.string().length(2).optional(),   // detected later if absent
  platform: z.enum(['x', 'reddit', 'generic']),
  authorHandle: z.string().optional(),     // NEVER transmitted; local display only
});

export const FactCheckMatch = z.object({
  id: z.string(),
  claim: z.string(),
  verdict: Verdict,
  ratingRaw: z.string(),
  publisher: z.string(),                   // e.g. "Correctiv", "dpa-Faktencheck"
  url: z.string().url(),
  publishedAt: z.string().date(),
  lang: z.string().length(2),
  score: z.number().min(0).max(1),         // cosine similarity
});

export const CheckResult = z.object({
  normalizedClaim: z.string(),
  matches: z.array(FactCheckMatch).max(5),
  techniqueHints: z.array(Technique).max(3),
  matcher: z.enum(['local', 'server']),
  snapshotVersion: z.string(),
});
```

`authorHandle` exists for the overlay header only; every serializer that leaves the extension MUST strip it (enforced by a dedicated zod schema for outbound payloads + a unit test).

## 5. Index snapshot format (`packages/index-format`)

Binary container, extension `.ggx`, published as GitHub Release assets (`snapshot-YYYY-MM-DD.ggx` + `latest.json` pointer with sha256 + size + counts).

```
HEADER (little-endian)
  magic        4 bytes   "GGX1"
  headerLen    u32       byte length of JSON header
  json         utf-8     {
                           "version": "2026-06-08",
                           "model": "intfloat/multilingual-e5-small",
                           "modelRevision": "<hf commit sha>",
                           "dim": 384, "count": 100000,
                           "metric": "cosine", "quant": "int8-pervec",
                           "langs": {"de": 41000, "en": 52000, ...}
                         }
BODY
  vectors      count × dim bytes        int8, per-vector symmetric quant
  scales       count × 4 bytes          f32 per-vector dequant scale
  metaOffsets  count × 8 bytes          u64 offsets into meta block
  meta         JSONL                    one FactCheckMatch-shaped record per line
                                        (without score), gzip-compressed
```

Requirements: the reader MUST verify magic + sha256 before install; MUST reject snapshots whose `model`+`modelRevision` differ from the locally installed embedding model (embedding parity, Section 6); install target is OPFS (vectors+scales as one ArrayBuffer file) + IndexedDB (parsed meta, keyed by id). Search kernel: brute-force int8 dot-product with f32 scale correction over typed arrays, processed in 8k-row chunks on a Web Worker; at 100k×384 this is ~38 MB and benchmarks well under 300 ms on 2020-class laptops, so no ANN structure in v1 (an ADR documents the upgrade path to HNSW if the index passes ~500k).

Size budget: vectors+scales ≈ 39 MB, meta gz ≈ 15–25 MB → ~60 MB total download, ~once a week, with delta updates explicitly deferred (full re-download in v1; cheap at this size).

## 6. Embedding specification

Model: **`intfloat/multilingual-e5-small`**, 384-dim, ONNX, q8 quantization, via `@huggingface/transformers` (transformers.js) in the extension and `onnxruntime-node` in `services/api` and `services/ingest`. WebGPU when available, WASM fallback; model files (~120 MB) lazily downloaded on first use with a progress UI and cached via the library's browser cache.

Hard requirements: (a) E5 prefix discipline — claims indexed with `"passage: "` prefix, queries embedded with `"query: "` prefix; this is a known silent-quality-killer if omitted, so both are wrapped in `shared/embedText(kind, text)` and direct tokenizer use is lint-banned; (b) L2-normalized outputs (cosine == dot); (c) **parity**: the model revision sha is pinned in `shared/src/embedding.ts` and recorded in every snapshot header; client and ingest refuse to operate across mismatched revisions. Model choice is revisitable after the Phase-0 eval (candidate alternative: static Model2Vec-class models for 10× smaller download at some recall cost — decided by golden-set numbers, not vibes; see Section 17).

## 7. Extension specification (`packages/extension`)

### 7.1 Framework and packaging

WXT (latest stable) targeting Chrome MV3 + Firefox (MV3 with WXT's compat layer). UI in **Preact + @preact/signals** (small, fast, no React licensing/runtime weight). All injected UI rendered inside a **closed Shadow DOM** with fully self-contained styles (design tokens as CSS custom properties on the shadow root) — host-page CSS must not bleed in or out. No Tailwind; a single `tokens.css` + component-scoped CSS.

Manifest permissions (exhaustive): `storage`, `contextMenus`, `activeTab`, `scripting`, `unlimitedStorage` (OPFS index), `clipboardWrite`. `host_permissions`: `https://x.com/*`, `https://twitter.com/*`, `https://*.reddit.com/*`. Server Mode and custom LLM endpoints use **optional host permissions** requested at runtime when the user enters a URL in settings. No `tabs`, no `history`, no `webRequest`. **Rationale:** the permission list is itself a trust artifact; reviewers and journalists read it.

### 7.2 Entry points

1. **Context menu** on any text selection: "Mit gegenrede prüfen" / "Check with gegenrede" — universal fallback, works on every site (generic adapter).
2. **Inline affordance** injected by platform adapters next to post action bars (small icon button) — X and Reddit only in v1.
3. **Toolbar popup**: paste-a-text box (for content the user saw elsewhere), settings link, index status (snapshot version/date, "update now"), mode indicator.

No background scanning of feeds. Checks are user-initiated, one post at a time. **Rationale (research/privacy):** feed scanning multiplies cost and privacy exposure for marginal benefit given the self-selection reality (framework doc §8.1) — the user of this tool already suspects the post; the tool's job is speed and evidence, not surveillance.

### 7.3 Platform adapter contract

```ts
export interface PlatformAdapter {
  id: 'x' | 'reddit' | 'generic';
  matches(url: URL): boolean;
  /** From a context-menu selection or inline-button click, resolve the post. */
  extract(ctx: { selection?: Selection; trigger?: Element }): ExtractedPost | null;
  /** Inject the inline entry point. Optional; generic adapter omits. */
  observe?(onTrigger: (post: Element) => void): () => void;  // returns teardown
  compose?: {
    /** Try to open + prefill the platform's reply box. Return false → clipboard fallback. */
    open(draft: string, ctx: { trigger?: Element }): boolean;
    maxLength: number;            // X: 280, Reddit: 10000, generic: 1000
  };
}
```

Adapters are the designated community-contribution surface: each lives in one directory with its DOM selectors isolated in a `selectors.ts`, and MUST ship with recorded HTML fixtures (`fixtures/*.html`, scrubbed of real usernames) + extraction unit tests. The generic adapter (selection text + page URL + `<title>`) is the permanent fallback and MUST NOT be removable by configuration. Meta-platform adapters are out of scope for v1 (architecture doc §3.1) and PRs adding them require a maintainer-approved ADR covering ToS posture.

### 7.4 UI flow and states

A single overlay panel (anchored near the trigger; draggable; ESC closes) driven by an explicit state machine:

`idle → extracting → detecting_lang → matching → results | no_match | error` and from `results`: `→ composing → drafts → copied/prefilled`.

**results state** shows, top to bottom: the normalized claim being checked (editable inline — user can correct it and re-run, teaching the system's limits honestly); up to 3 matches as cards (publisher logo/name prominent, canonical verdict chip with icon + localized label, original rating in quotes, date, link, similarity shown as a qualitative band — "starke Übereinstimmung / strong match" for ≥0.88, "mögliche Übereinstimmung" for threshold–0.88 — never a raw decimal); hedged technique chips; and the primary action **"Antwort entwerfen" / "Draft a reply"** (only when ≥1 match — guardrail G1, Section 10.4).

**no_match state** says plainly that nothing was found in the index of N fact-checks (show N and snapshot date), lists which publishers the index covers, and offers two follow-ups: re-run with edited claim text, and links to manual search at Correctiv/Google Fact Check Explorer prefilled with the claim. It MUST NOT speculate about veracity. **Rationale (research):** an honest "no match" preserves the trust that a single bad stretch-match destroys (architecture doc §3.2); the system's epistemic claim is only ever "a professional fact-check exists / does not exist in our index," never "this is true/false by our own judgment."

**drafts state**: three tabs — *Sachlich (brief-factual)*, *Empathisch (empathic)*, *Technik benennen (technique-naming)* — each an editable textarea prefilled with the generated draft, live character counter against `adapter.compose.maxLength`, source link visibly locked into the text (deleting it shows a non-blocking warning, not a hard stop — the human is in charge), buttons: "Kopieren", and "In Antwortfeld einfügen" where the adapter supports prefill. A persistent footer note in the drafts state: "Du postest selbst, unter deinem Namen." / "You post this yourself, under your own name."

### 7.5 Design system

Tone: calm, library-not-courtroom. **Rationale (research):** alarmist UI primes reactance and undermines the bystander effect the tool exists for (framework doc §8.1); the visual language should read as *reference material*, not as an accusation machine.

Tokens (light / dark, `prefers-color-scheme` + manual override):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--gg-bg` | `#FAFAF7` | `#16181C` | panel background (warm paper) |
| `--gg-surface` | `#FFFFFF` | `#1F2228` | cards |
| `--gg-ink` | `#1A1C1E` | `#E8EAED` | text |
| `--gg-muted` | `#5F6368` | `#9AA0A6` | secondary text |
| `--gg-accent` | `#1A5FB4` | `#7CB1F2` | actions, links |
| `--gg-verdict-false` | `#B3261E` | `#F2B8B5` | false / mostly_false |
| `--gg-verdict-misleading` | `#8F6400` | `#E8C266` | misleading |
| `--gg-verdict-unproven` | `#5F6368` | `#9AA0A6` | unproven |
| `--gg-verdict-true` | `#1B7F3B` | `#8BD7A0` | true / mostly_true |
| `--gg-verdict-satire` | `#6A4FA3` | `#C5B3E8` | satire |

Typography: system stack (`system-ui, -apple-system, Segoe UI, Roboto, sans-serif`), base 14 px in overlay, 1.5 line height; wordmark lowercase "gegenrede" in the same stack, semibold — no custom font download (bundle + fingerprinting). Spacing on a 4 px grid; radius 10 px; one elevation shadow.

Accessibility (WCAG 2.1 AA): verdicts MUST combine icon + text label + color (never color alone); full keyboard operability of the overlay (focus trap while open, ESC closes, tab order documented); ARIA `role="dialog"` + labelled regions; contrast-checked token pairs (the table above is pre-checked ≥4.5:1 for text uses); `prefers-reduced-motion` respected (no entrance animations).

### 7.6 Extension storage

`browser.storage.local`: settings (Section 12), snapshot metadata, rate-limit counters. `browser.storage.session`: nothing persistent. OPFS: vector file. IndexedDB: claim metadata. LLM API keys live in `storage.local` with a settings-page warning that extension storage is not hardware-secure; Ollama (keyless, local) is the recommended default and listed first in the provider dropdown. No `storage.sync` for keys, ever.

## 8. Matching pipeline (both modes)

Identical contract; the steps run client-side in Local Mode and server-side in Server Mode.

**Step 1 — cleanup (deterministic, no LLM):** strip URLs, @-handles, hashtags-to-words (`#KlimaLüge` → `Klima Lüge`), emoji, repeated punctuation; collapse whitespace; truncate to 512 tokens. Pure function in `shared`, golden-tested.

**Step 2 — language detection:** `tinyld` on cleaned text; confidence < 0.7 → fall back to UI language; result feeds the composer's output language and the eval breakdown.

**Step 3 — normalization (LLM-assisted, optional):** if an LLM is configured, one call rewrites the cleaned text into an explicit, self-contained, checkable claim (the CheckThat! Task-2 framing — framework doc §3 Layer 1), e.g. `"Krass was die wieder verschweigen 🤡"` + quote context → `"Die Bundesregierung verheimlicht X."` Prompt is fixed in `shared/prompts/normalize.ts`, temperature 0, max 120 output tokens, output schema-validated (single sentence, same language). If no LLM is configured or the call fails: `normalizedClaim = cleaned text` and the pipeline continues — graceful degradation, never a hard dependency. The overlay always displays which claim text was actually searched.

**Step 4 — retrieval:** embed `query: {normalizedClaim}`, search index, take top-5 above `threshold` (default **0.82** cosine; settings-adjustable in an "advanced" section between 0.75–0.92). Cross-lingual matches are kept and flagged with the fact-check's language chip ("EN-Faktencheck"). **Rationale (research):** cross-lingual retrieval is a validated strength of this model class (MuMiN-style linking across 41 languages, framework doc §3 Layer 1) and directly useful — German viral claims are frequently translated imports.

**Step 5 — technique hints:** produced by the same LLM call as Step 3 (one combined call, JSON output: `{claim, techniques[]}`), constrained to the closed taxonomy, max 3, only surfaced when a match exists (Section 4.2). No LLM → no technique hints. Never a separate billable call.

Default thresshold and the qualitative band boundaries are frozen only after the Phase-0 eval (Section 14) — the values above are starting points, and the eval report MUST be committed alongside any change.

## 9. Server Mode services

### 9.1 `services/api` (Node 22, Hono, zod-validated)

| Endpoint | Auth | Body → Response |
|---|---|---|
| `GET /v1/health` | none | `{status, snapshotVersion, counts}` |
| `POST /v1/check` | optional bearer | `{text, lang?}` → `CheckResult` |
| `POST /v1/compose` | optional bearer | `ComposeRequest` → `{drafts[]}` (Section 10) |
| `GET /v1/snapshot/latest` | none | snapshot metadata (Local-Mode bootstrap mirror) |

Auth: single static bearer token via `API_TOKEN` env (empty = open; compose-capable deployments SHOULD set it). Rate limit: token-bucket per IP (default 30 checks + 10 compose calls per hour) via in-memory store — single-instance assumption is acceptable and documented for v1. CORS: extension origins + configurable allowlist. Request logging: counters only; `LOG_BODIES=true` exists for self-debugging, defaults to false, and the README states the privacy implication. Embeddings via `onnxruntime-node` with the pinned model (Section 6); search via pgvector cosine (`vector_cosine_ops` IVFFLAT index, lists=200).

### 9.2 Database schema (Drizzle ORM, Postgres 17 + pgvector)

```sql
CREATE TABLE factchecks (
  id            text PRIMARY KEY,            -- sha256(publisher|url)[0:16]
  claim_text    text NOT NULL,
  verdict       text NOT NULL,               -- canonical enum
  rating_raw    text NOT NULL,
  publisher     text NOT NULL,
  url           text NOT NULL UNIQUE,
  published_at  date,
  lang          char(2) NOT NULL,
  dedup_hash    text NOT NULL UNIQUE,        -- sha256(lower(claim_text)|publisher)
  embedding     vector(384) NOT NULL,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  source        text NOT NULL                -- connector id
);
```

Stored fields are deliberately limited to claim + verdict + link metadata — no article bodies — keeping the dataset redistributable (architecture doc §3.3) and the CC BY-SA publication clean.

### 9.3 `services/ingest` connectors (also the Phase-0 CLI)

Each connector implements `fetchSince(date): RawFactCheck[]`; a shared normalizer maps to the canonical schema, applies the verdict map, dedups on `dedup_hash`, embeds (`passage: ` prefix), and upserts. Connectors for v1, in build order:

1. **`google-factcheck`** — Google Fact Check Tools API (`claims:search`), free API key, languages `de,en`, paged daily pulls per language + per known publisher domain. This is the backbone (aggregates global ClaimReview markup).
2. **`euvsdisinfo`** — EUvsDisinfo public database export; weekly; ratings map to `false`/`misleading` per their schema.
3. **`claimreview-rss`** — generic connector: RSS/sitemap URL list (Correctiv, dpa-Faktencheck, AFP Faktencheck DE, BR24 Faktenfuchs) → fetch page → parse `ClaimReview` JSON-LD. Respects robots.txt, 1 req/2s per host, identifying User-Agent with repo URL. Feed URLs are configuration, verified at implementation time; an early task is a friendly heads-up email to GADMO members (architecture doc §9 — they are also the natural first user community).

`ingest snapshot-build` command produces the `.ggx` (Section 5) from the current DB and verifies it round-trips through the reader + a 20-query smoke eval before it may be published. Ingest runs in compose via cron sidecar (Ofelia) nightly; snapshot publication to GitHub Releases is a manual maintainer action in v1 (deliberate human gate on what ships to all Local-Mode users).

### 9.4 docker compose (`deploy/`)

Services: `postgres` (pgvector image, volume-backed), `api`, `ingest` + `ofelia` cron. One `.env.example` documenting every variable (`API_TOKEN`, `GOOGLE_FC_API_KEY`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LOG_BODIES`). `docker compose up` + one seed command MUST yield a working `/v1/check` within 15 minutes on a clean machine — this is a tested acceptance criterion, not an aspiration, because "skeptics can self-host the full stack" is a trust claim the repo makes publicly.

## 10. Composer specification

### 10.1 Providers

One interface, two implementations: `DirectLLM` (extension calls an OpenAI-compatible `/chat/completions` endpoint directly: Ollama at `http://localhost:11434/v1` recommended default, Mistral EU endpoint, or any user-supplied base URL + key) and `RemoteComposer` (Server Mode's `/v1/compose`, where the self-hoster's env configures the upstream). Suggested local model default: `mistral-nemo:12b` (solid German, runs on 16 GB machines); suggested hosted default: `mistral-small-latest` (EU jurisdiction, cheap). Model strings are settings, not code.

### 10.2 Request contract — evidence is structurally mandatory

```ts
export const ComposeRequest = z.object({
  normalizedClaim: z.string().min(8),
  match: FactCheckMatch,                       // REQUIRED. No match → no draft. (G1)
  postLang: z.string().length(2),
  register: z.enum(['factual', 'empathic', 'technique']),
  techniqueHints: z.array(Technique).max(3),
  maxLength: z.number().int().min(120).max(10000),
  varianceSeed: z.number().int(),              // client-generated per draft set
});
```

### 10.3 Generation

System prompt (frozen in `shared/prompts/compose.ts`, changes require ADR + eval) enforces the Debunking-Handbook structure: (1) lead with the core fact in plain words; (2) name the false claim exactly once, explicitly flagged as false/misleading per the verdict; (3) in `technique` register, name the manipulation technique with one-line explanation; (4) close by reinforcing the fact; (5) cite the publisher by name. The fact-check URL is **appended programmatically after generation** — the model never has the job of reproducing it correctly. Output language = `postLang`. Tone constraints: address the audience not the author, no insults, no sarcasm, no diagnosis of motives, no rhetorical questions piling on. Temperature 0.8; persona-variance below.

**Register definitions** — *factual:* ≤3 sentences, verdict + fact + source; *empathic:* opens by acknowledging why the claim is believable/concerning, then corrects; *technique:* centers how the post misleads (from `techniqueHints`), then the fact. **Rationale (research):** corrections work on the silent audience, and audiences differ; register choice lets the user match thread temperature, and the empathic register exists specifically because hostile correction triggers reactance and erodes the bystander effect (framework doc §8.1–8.2).

### 10.4 Guardrails (normative, with enforcement locus)

| ID | Invariant | Enforced at |
|---|---|---|
| G1 | No draft without a `FactCheckMatch` | zod schema (compile-time type + runtime), both providers |
| G2 | No auto-posting; no posting credentials anywhere in the codebase | architecture (no such API surface) + CI grep-gate for platform write endpoints + `GUARDRAILS.md` |
| G3 | Per-draft stylistic variance | `varianceSeed` selects 1-of-12 persona framings (sentence order, formality, opener style) injected into the prompt; two users countering the same post get structurally different text (CIB self-protection, framework §8.3) |
| G4 | Tone floor | post-generation check: insult/slur lexicon (de+en) + banned patterns (second-person attacks); a failed draft is regenerated once, then that register is omitted with an explanatory note — never silently "fixed" |
| G5 | Length fits the platform | regenerate-with-tighter-budget once, then truncate-at-sentence with ellipsis warning |
| G6 | Source link present | programmatic append (10.3); UI warns if user deletes it |
| G7 | Rate limit | client-side: default 10 draft-sets/hour, 5 s cooldown between sets, counter in `storage.local`; settings can lower, not raise above 20/h |
| G8 | Human-edit affordance | drafts open in an editable state; the copy/prefill buttons are disabled for 1.5 s after drafts render (skim-before-send friction) |

G7's ceiling and G8's friction are deliberately small — the goal is keeping good-faith users out of platform spam enforcement and out of CIB-pattern territory, not obstructing them. `GUARDRAILS.md` documents each invariant with its research grounding and is the citable basis for rejecting "add auto-reply mode" PRs (`GOVERNANCE.md`).

## 11. Internationalization (de/en)

UI languages at launch: **German and English**; the architecture must make adding a third language a pure-content task.

Catalogs: `packages/extension/src/locales/{de,en}/messages.json`, flat dot-namespaced keys (`overlay.noMatch.title`), ICU-light interpolation `{name}` + plural via a thin `Intl.PluralRules` helper (no i18next dependency; total i18n runtime <2 kB). A codegen script emits a `MessageKey` union type from the `en` catalog; `t(key, params)` is fully typed and CI fails on keys missing from any locale. Dates/numbers via `Intl.*` with the active locale.

Language resolution: UI language = explicit setting, else `browser.i18n.getUILanguage()` mapped to `de`/`en`, fallback `en`. **Reply language = detected post language** (Section 8 Step 2), independent of UI language — a German UI user countering an English post gets English drafts; mismatch is shown as a small chip with one-tap override.

German register: informal lowercase **du** throughout UI copy (consistent with German OSS/tech convention and the project's civil-society audience; a Sie-toggle is explicitly out of scope for v1 and noted in Section 17). German copy MUST avoid moralizing vocabulary ("Lüge", "entlarvt") in UI chrome — verdict labels use the sober canonical terms ("Falsch", "Irreführend", "Unbelegt", "Größtenteils richtig", "Richtig", "Satire"). All publisher rating strings render verbatim, untranslated, in quotes.

Locale completeness is a release gate: `pnpm i18n:check` (missing keys, placeholder parity, length-overflow heuristics for button strings) runs in CI.

## 12. Settings (complete v1 list)

| Setting | Key | Default | Notes / Rationale |
|---|---|---|---|
| Mode | `mode` | `local` | `local` \| `server`; server requires URL + runtime optional-permission grant |
| Server URL / token | `server.url`, `server.token` | — | validated by `/v1/health` probe on save |
| LLM provider | `llm.preset` | `none` | `none` \| `ollama` \| `mistral` \| `custom`; `none` = matching works, normalization/composing disabled with explanatory empty-states. Honest degradation beats a broken-feeling default. |
| LLM endpoint/key/model | `llm.baseUrl`, `llm.apiKey`, `llm.model` | preset-derived | key stored locally with plain-language warning (7.6) |
| UI language | `ui.language` | `auto` | `auto` \| `de` \| `en` |
| Theme | `ui.theme` | `auto` | `auto` \| `light` \| `dark` |
| Default register | `reply.defaultRegister` | `factual` | which tab opens first; all three always generated |
| Draft rate limit | `reply.maxSetsPerHour` | `10` | G7; UI slider 1–20, copy explains the spam/CIB reasoning |
| Match threshold | `matching.threshold` | `0.82` | advanced section; help text: lower = more, weaker matches |
| Snapshot auto-update | `snapshot.autoUpdate` | `true` | weekly check against `latest.json`; manual "update now" in popup |
| Inline buttons | `adapters.inlineButtons` | `true` | per-platform toggles; context menu is not toggleable (universal entry) |

No telemetry setting exists because no telemetry exists in v1 — `PRIVACY.md` states this as a property, not a toggle.

## 13. Privacy & security requirements

Data flows (exhaustive): post text → (Local Mode) device-only, → (Server Mode) the user's own server, → (LLM configured) the user-chosen LLM endpoint, disclosed in settings copy at the point of configuration. No accounts, no analytics, no crash reporting in v1. `authorHandle` never serialized outbound (4.3). Extension update channel = store defaults; snapshot channel = GitHub Releases over TLS with sha256 verification.

Security: MV3 default CSP, zero remote code (store-policy + own policy), dependencies pinned via lockfile + Renovate, `SECURITY.md` with contact + 90-day disclosure window, secrets only via env (gitleaks in CI), AGPL license headers via CI check. Threat model doc (`docs/threat-model.md`) MUST cover: malicious snapshot substitution (mitigated: hash pinning via `latest.json` served from the repo), malicious fork misuse (accepted residual risk, mitigations G1–G3 + license, framework §8.3), prompt-injection via post text into normalize/compose calls (mitigated: post text is data-fenced in prompts, outputs schema-validated, and the composer's authority is limited to producing a draft a human reviews — there is no tool-use surface).

## 14. Testing, evaluation, CI

**Unit:** vitest across all packages; adapters tested against committed DOM fixtures (happy-dom); `index-format` round-trip + numerical-accuracy tests (int8 vs f32 recall delta < 1% @ top-5 on a 5k sample).

**Golden eval (the Phase-0 gate):** `data/eval/golden-de.jsonl` — 150 real viral German claims hand-collected from fact-checker archives, each labeled with the expected fact-check URL (in-index positives, ~100) or `null` (out-of-index negatives, ~50); plus a 50-item English set. Runner reports recall@5 on positives (target ≥ 0.80), false-match rate on negatives at the default threshold (target ≤ 5%), and per-language breakdown. **This eval gates everything:** model choice, threshold defaults, snapshot publication (smoke subset), and the go/no-go on the product bet itself (architecture doc §7 Phase 0). Composer quality: a 20-case prompt-regression suite scored on structural compliance (fact-first, single myth mention, source present, length, no second-person attack) — deterministic checks, not LLM-judged, in v1.

**E2E:** Playwright with the built extension against fixture pages (not live platforms) covering: context-menu flow, match display, compose flow with a mocked LLM, clipboard write, settings persistence. Nightly, not per-PR.

**CI (GitHub Actions):** lint, typecheck, unit, i18n:check, gitleaks, license-header check, build (Chrome+Firefox zips as artifacts), compose-stack boot smoke test, G2 grep-gate. Release workflow: changesets → tagged release → store-upload manual.

## 15. Performance budgets

Extension bundle ≤ 400 kB gzipped (excluding lazily-fetched model/index). Cold-start (first ever check, Local Mode): explicit two-stage progress UI (model ~120 MB, index ~60 MB), resumable, on Wi-Fi-class connections ≤ 3 min; never silent. Warm local check (embed + search, 100k index) ≤ 600 ms p95 on 2020-class hardware, search step alone ≤ 300 ms. Server-mode check ≤ 1.5 s p95 round-trip. Compose set (3 drafts) ≤ 10 s p95 hosted, best-effort local. Overlay injection cost on page load ≤ 5 ms main-thread (adapters use a single shared MutationObserver with debounce).

## 16. Milestones (issue-trackable)

**M0 — scaffold (repo hygiene):** monorepo, CI, shared schemas, docs skeleton (PRIVACY/GUARDRAILS/GOVERNANCE/SECURITY). Exit: green CI on empty packages.
**M1 — Phase 0 (the bet):** ingest connectors 1–2, snapshot builder, `index-format`, golden-de set, eval runner. Exit: published eval report; recall@5 ≥ 0.80 or a documented pivot decision.
**M2 — Phase 1 (lookup tool):** extension with generic + X + Reddit adapters, Local-Mode matcher, overlay through `results`/`no_match`, settings, i18n de/en complete. Exit: installable zip, demo GIF, store-review-ready.
**M3 — Phase 2 (composer):** providers, prompts, G1–G8, drafts UI, prompt-regression suite. Exit: guardrail test matrix green; `GUARDRAILS.md` final.
**M4 — Server Mode:** api + compose stack + connector 3, 15-minute self-host acceptance test, README deployment docs. Exit: clean-machine self-host verified by someone other than the author.

## 17. Open decisions (tracked as ADR stubs)

Embedding model final call after M1 eval (e5-small vs. a static-embedding small model — decided by golden-set recall vs. 10× download saving). X reply length for non-premium accounts (280) vs. premium — v1 assumes 280. Sie/du toggle for German UI (deferred; revisit on user feedback). Snapshot delta updates (deferred until size pressure). Firefox Android (WXT supports it; deferred to post-M4). Hosted instance + Prototype-Fund/NLnet application timing (architecture doc §6 — the M1 eval report is the strongest attachment an application could have).

## 18. Agent-driven implementation

This spec will be implemented primarily by a Claude coding agent. Process rules, decision boundaries, the approved dependency list, and anti-fabrication requirements for the agent live in `CLAUDE.md` at the repo root; that file is subordinate to this spec and to `GUARDRAILS.md` in the source-of-truth hierarchy. Human-gated actions (guardrail/schema/prompt changes, snapshot and release publication, store uploads, outreach to fact-check organizations) are enumerated there and remain human-gated regardless of who or what writes the code.
