# PoC Architecture: Open-Source Counter-Speech Browser Extension

**Working title:** Gegenrede
**Companion to:** *Countering Text-Based Disinformation on Platforms: A Science-Grounded Framework* (v2, Section 8)
**Status:** PoC architecture, pre-implementation · June 2026

---

## 1. Goal and non-goals

**Goal of the PoC:** A browser extension that, on a user-selected social media post, (a) extracts and normalizes the claim, (b) matches it against existing professional fact-checks, (c) shows the match with source context, and (d) on request drafts 2–3 evidence-grounded reply variants the user can edit and post manually. German-first, EU-multilingual by architecture. Fully open source.

**Non-goals for the PoC:** No automated scanning of entire feeds (user-initiated per post only — keeps cost, privacy exposure, and platform friction minimal). No novel-claim verification agent (phase 2; PoC resolves only against existing fact-checks). No crowdsourced notes layer (phase 3, if ever). No auto-posting under any circumstances (permanent non-goal, not a phase). No mobile app in the PoC — the share-sheet/app variant reuses the same backend later.

**Success criteria:** A user on X/Reddit/web-article pages can go from "this post looks wrong" to "polished, sourced reply in my clipboard" in under 30 seconds, with a fact-check match rate worth the interaction (target: match found for >30% of attempted checks on viral German-language misinformation — measurable against Correctiv/dpa archives).

## 2. System overview

Three deployable units, deliberately thin:

```
┌─────────────────────────────────────────────┐
│  Browser Extension (MV3, TypeScript)        │
│  ┌───────────┐ ┌──────────┐ ┌────────────┐  │
│  │ Platform  │ │ Overlay  │ │ Settings / │  │
│  │ adapters  │ │ UI       │ │ BYO-key    │  │
│  └─────┬─────┘ └────┬─────┘ └─────┬──────┘  │
└────────┼────────────┼─────────────┼─────────┘
         │ selected post text only  │
         ▼                          ▼
┌──────────────────────┐   ┌─────────────────────┐
│  Claim Service (EU)  │   │  Composer Service   │
│  normalize → embed → │──▶│  (LLM, evidence-    │
│  match (pgvector)    │   │  grounded drafting) │
└──────────┬───────────┘   └─────────────────────┘
           ▲
┌──────────┴───────────┐
│  Fact-Check Ingest   │  nightly jobs: ClaimReview/
│  (pipeline + DB)     │  Google FC API, EUvsDisinfo,
└──────────────────────┘  GADMO/EDMO member feeds
```

The extension is the only user-facing component. The Claim Service and Composer Service are stateless HTTP APIs; the Ingest pipeline is a scheduled job writing to the shared database. Everything is runnable via one `docker compose up` so contributors and skeptics can self-host the full stack — itself a trust feature.

## 3. Components

### 3.1 Browser extension

WebExtension Manifest V3, TypeScript, built with WXT or Plasmo for cross-browser (Chrome/Firefox) output from one codebase. Svelte or Preact for the overlay UI to keep the bundle small.

**Platform adapters** are isolated modules, one per site, each exposing exactly two functions: `extractPost(selection) → {text, author?, url, lang}` and `openComposeBox(draft)` (where the platform allows prefilling; otherwise clipboard). PoC adapters: **X, Reddit, and a generic article-page adapter** (selection-based, works everywhere). **Meta properties are explicitly deferred:** Facebook/Instagram DOM obfuscation and enforcement history make them the worst-cost adapters; the adapter interface keeps the door open for community-maintained ones later. Adapters are the highest-churn code in the project and the contribution surface to optimize for — small, isolated, testable with recorded DOM fixtures.

**Privacy boundary in the extension:** only the selected post text, detected language, and post URL leave the browser, and only when the user explicitly triggers a check. No account identifiers, no browsing history, no background scanning, no analytics SDKs. Language detection and basic text cleanup run client-side.

### 3.2 Claim Service

Python/FastAPI (or TypeScript/Hono — pick by contributor base; Python wins on NLP library access). Endpoint: `POST /check {text, lang}` → `{normalized_claim, matches: [{claim, verdict, source, url, date, score}], technique_hints: [...]}`.

Internals: **claim normalization** via a small instruction-tuned model (PoC pragmatic choice: a single LLM call with a tight prompt; phase 2: fine-tuned mT5/SLM per the CheckThat! 2025 recipes, which cut cost and latency). **Matching** via multilingual embeddings — `multilingual-e5-large` or `BGE-M3` (both open-weight, strong cross-lingual retrieval, run on CPU acceptably for PoC volumes) — against **Postgres + pgvector**. Cross-lingual retrieval is a feature, not a complication: a German post can match an English or French fact-check, with the verdict shown and the reply still drafted in German. A score threshold separates "match" from "no match found" — the service must say "no match" honestly rather than stretch; a bad match destroys user trust faster than no match. **Technique hints** (scapegoating, decontextualization, fake experts, emotional manipulation...) come from the same LLM call as normalization, using the taxonomy validated in the EU prebunking literature; they're displayed as "possible manipulation techniques" — hedged, never asserted.

### 3.3 Fact-Check Ingest

Nightly jobs pulling: **Google Fact Check Tools API** (aggregates ClaimReview markup globally — the single highest-leverage free source), **EUvsDisinfo** (pro-Kremlin disinformation database, CSV/API), and scraped/RSS feeds of **GADMO members and German fact-checkers** (Correctiv, dpa-Faktencheck, AFP DE, BR24 Faktenfuchs — respecting robots.txt and ideally with informal blessing; these orgs generally want distribution). Normalize into one schema (`claim_text, verdict, rating_raw, publisher, url, published_at, lang`), embed, upsert. Store only claim + verdict + link metadata — not article bodies — which keeps the database redistributable and copyright-clean. The ingest pipeline doubles as a standalone open dataset artifact ("EU fact-check index") that has value independent of the extension and makes a good first-contribution area.

### 3.4 Composer Service

Endpoint: `POST /compose {normalized_claim, match, lang, register}` → up to 3 drafts (brief-factual / empathic / technique-naming). LLM access in two modes: **default hosted mode** using an EU-hosted model (Mistral Large via EU endpoint — keeps content data in EU jurisdiction, consistent with the project's positioning) paid by the project within rate limits, and **BYO-key mode** (user's own Mistral/OpenAI/Anthropic key, or a local Ollama endpoint) for power users and cost relief.

**Guardrails live here as code, not policy text:**
- The endpoint *requires* a `match` object; requests without matched evidence are rejected at the schema level. The composer cannot draft "against" arbitrary text with an arbitrary stance.
- The system prompt enforces debunking-handbook structure (fact first, myth once with flag, technique, source link, calm tone) and the source URL is injected programmatically into every draft.
- A post-generation check rejects drafts containing insults/ad-hominems (small classifier or rule pass) and drafts exceeding platform length limits.
- **Stylistic variance by construction:** temperature + persona-seed randomization per request, so two users countering the same post never emit near-identical text (CIB self-protection, see framework doc §8.3).
- Soft client-side rate limiting (e.g. cooldown after N drafts/hour) to keep users out of spam-enforcement territory.

## 4. Data flow (happy path)

User highlights/clicks a post → adapter extracts text → extension POSTs to Claim Service → overlay shows: normalized claim, best matches with publisher + verdict + date, technique hints, and source-credibility context where available → user clicks "Antwort entwerfen" → Composer returns 3 registers → user picks, edits inline, hits "copy" or "open compose box" → user posts manually. Total round trip target: <8s with hosted LLM, <3s for match-only.

No-match path: overlay says so plainly, offers the source links that *were* searched, and (phase 2) a "request verification" queue. Never a generated guess.

## 5. Privacy & GDPR posture

Local-first by default; the only personal-ish data in transit is the text the user explicitly submits. **No accounts in the PoC** (BYO keys stored in extension local storage). Server logs: aggregate counters only, no post text retention beyond request lifetime (configurable; default 0 retention) — state this in a short, honest Datenschutzerklärung. EU hosting (Hetzner/Scaleway class) for all services. This posture is cheap to implement now and impossible to retrofit credibly later; it is also the project's differentiation and should be documented as an explicit design principle in the repo (`PRIVACY.md`).

## 6. Open-source strategy

**License: AGPL-3.0** for services and extension. Rationale: the main misuse vector is someone forking the pipeline into a closed astroturfing service; AGPL forces network-service forks to publish source, which doesn't prevent abuse but removes the quiet-commercial-fork path and matches the project's trust positioning. The fact-check index data under **CC BY-SA 4.0** (verdicts/links are facts + attribution). If maximum adoption ever outweighs fork-protection, individual libraries (e.g. adapters SDK) can be MIT-carved later — easy in that direction, impossible in reverse.

**Repo layout:** monorepo (`/extension`, `/services/claim`, `/services/composer`, `/ingest`, `/deploy`), one-command local stack, recorded-fixture tests for adapters, CI on all of it. **Docs that must exist at launch:** README with the 30-second demo GIF, `PRIVACY.md`, `GUARDRAILS.md` (the §8.3 invariants and *why* — this is the document journalists and funders will read), `CONTRIBUTING.md` pointing newcomers at adapters and ingest sources as entry tasks.

**Governance for a solo-founder start:** BDFL-with-documented-invariants. The guardrails (no auto-posting, evidence-grounding, variance) are declared non-negotiable in `GOVERNANCE.md` so drive-by PRs "adding auto-reply mode" have a citable rejection basis. Security: no keys in repo, secrets via env, a `SECURITY.md` contact.

**Funding fit:** the profile (EU, privacy-first, public-interest OSS, counter-disinformation, solo Berlin dev) matches **Prototype Fund (BMBF)** and **NLnet / NGI Zero** almost exactly; both fund individuals, both like guardrails-conscious projects. Apply with this architecture doc — it is essentially the technical annex.

## 7. Build phases

**Phase 0 (1–2 weekends):** ingest pipeline + pgvector matching as a CLI — validates the core bet (match rate on real viral German misinformation) before any UI exists. If match rates are poor, the product needs rethinking and you've spent two weekends, not three months.
**Phase 1 (PoC, ~4–6 weeks part-time):** extension with X + Reddit + generic adapters, Claim Service, overlay UI, match display. No composer yet — shippable and demoable as a pure "fact-check lookup" tool.
**Phase 2:** Composer Service with full guardrails, hosted-EU + BYO-key modes. This is the headline feature; shipping it after the lookup core means guardrails get implemented calmly, not bolted on.
**Phase 3 (post-PoC, optional):** verification agent for unmatched claims (framework Layer 2), Firefox Android support, share-sheet mobile entry point, community adapter program.

## 8. Cost envelope (PoC scale)

One small EU VPS (4 vCPU/8GB: Postgres+pgvector, both services, ingest cron) ≈ €15–25/mo. Embeddings on CPU at user-triggered volumes: fine. Hosted LLM (normalization + composing, Mistral): roughly €0.002–0.01 per full interaction; at 1,000 interactions/day ≈ €60–300/mo worst case — capped by rate limits and offloaded by BYO-key users. Total PoC burn: well under €100/mo until real traction, which is inside hobby-project tolerance and trivially inside grant budgets.

## 9. Top risks (PoC-stage)

**Adapter rot** — platforms change DOM weekly; mitigated by the generic selection-based adapter as permanent fallback and fixture-based tests that fail loudly. **Match-rate disappointment** — the entire UX depends on the fact-check index being good; Phase 0 exists to measure this before sunk cost. **Guardrail erosion via forks** — acknowledged, mitigated by AGPL + invariants documentation + evidence-grounding architecture; cannot be fully prevented and should be communicated honestly. **Solo-maintainer bus factor / burnout** — scope discipline (the non-goals list) is the mitigation; the phases are sequenced so every phase ends in something independently useful and abandonable-with-dignity. **Legal edges** (scraping fact-checker sites, UrhG/database rights): store claims + links only, seek informal cooperation with GADMO members early — they are also the natural first user community.
