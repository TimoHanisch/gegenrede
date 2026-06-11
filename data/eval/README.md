# data/eval

Golden evaluation sets and the eval runner (spec §14, the Phase-0 gate).

The golden sets are **human-curated** (issue #15); agents must never add,
remove, or edit eval items (see `CLAUDE.md`). Until they land, `pnpm eval`
fails with a clear error. The runner itself never skips an item: any
invalid line aborts the whole run.

## Golden set format (`golden-de.jsonl`, `golden-en.jsonl`)

One JSON object per line:

| field         | type             | meaning                                                                 |
| ------------- | ---------------- | ----------------------------------------------------------------------- |
| `claim`       | string, non-blank | the viral claim text, as collected                                      |
| `expectedUrl` | URL or `null`    | fact-check the pipeline must retrieve (positive), or `null` for an out-of-index negative |
| `lang`        | `"de"` \| `"en"` | human label; drives the per-language breakdown                          |
| `source`      | string, optional in schema | provenance: which fact-checker archive the claim came from (#15). `--validate` requires it on every item |

Unknown keys are rejected (curation typos must surface). Example lines —
synthetic URLs, not real fact-checks:

```jsonl
{"claim":"Die fiktive Stadt Beispielhausen hat alle Autos verboten.","expectedUrl":"https://factcheck.example.org/artikel/1","lang":"de","source":"correctiv"}
{"claim":"An invented club presented a fictitious new logo.","expectedUrl":null,"lang":"en","source":"factcheck.example.org"}
```

## Running

```
pnpm eval --snapshot path/to/snapshot.ggx
```

| flag                | default                      | meaning                                                                |
| ------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| `--snapshot <path>` | required                     | `.ggx` snapshot to evaluate against                                     |
| `--golden <path>`   | every `data/eval/golden-*.jsonl` | golden JSONL file; repeatable                                       |
| `--sha256 <hex>`    | self-computed                | published snapshot hash to verify against. Without it the file's own hash is used: quality is measured, **integrity against a published manifest is not verified** |
| `--threshold <n>`   | `0.82` (spec §8 step 4)      | cosine threshold for "would be shown to the user"                       |
| `--top-k <n>`       | `5` (spec §14)               | hits retrieved per query — the K in recall@K                            |
| `--out <dir>`       | `data/eval/reports`          | where the report pair is written                                        |

The pipeline per item is deterministic: cleanup (§8 step 1) → embed
`query:` (§6a) → search (§8 step 4). LLM normalization (§8 step 3) is not
part of the eval — it measures the retrieval floor every install gets.

## Validating during curation (`--validate`)

```
pnpm eval --validate            # every data/eval/golden-*.jsonl
pnpm eval --validate --golden path/to/file.jsonl
```

Checks the golden sets themselves — no snapshot, no embedding model — and
collects **every** problem in one pass (unlike an eval run, which aborts on
the first bad line). Exit 1 on any error:

- a line that is not valid JSON or fails the schema above
- an interior blank line
- a missing `source` (per-item provenance, #15)
- an `@`-handle in `claim` or `source` — committed eval data must contain
  no real user handles (`CLAUDE.md` Testing discipline)
- a duplicate claim (within or across files)
- a claim that §8 cleanup reduces to empty text (nothing would embed)

Warnings (exit stays 0): §14 composition shortfalls (de positives below
~100, de negatives below ~50, en items below 50 — expected mid-curation)
and claims whose detected language confidently disagrees with the `lang`
label (diagnostic only, mirrors the eval run's `detectionAgrees`). The
output reports locations as `file:line` and never echoes claim text.

## Harvesting candidates (optional, semi-automated)

```
pnpm harvest --lang de --since 2026-05-01
pnpm harvest --lang de --since 2026-05-01 --site some-other-publisher.example
pnpm harvest --lang en --since 2026-05-01 --connector euvsdisinfo --out data/eval/candidates-en-euvsdisinfo.jsonl
```

Pulls records through an ingest connector into a staging file
`candidates-<lang>.jsonl` — **gitignored, never committed, never read by
the eval**. Each candidate pre-fills `claim`/`expectedUrl`/`lang`/`source`
plus review helpers (`rating`, `publishedAt`). An existing staging file is
never overwritten without `--force` (use `--out` for separate batches);
URLs already curated in the golden sets are skipped.

Connectors:

- `google` (default) — Google Fact Check Tools API (`GOOGLE_FC_API_KEY`
  required, env only). Defaults to the `sources.json` publisher sites
  (in-index → positive candidates); pass `--site` with non-ingested
  publishers to find negative candidates.
- `euvsdisinfo` — the EUvsDisinfo database (en only, no key); the main
  source of in-index English content. The live export route is unresolved
  (#70) — until then this pull is expected to fail against the configured
  base URL.

**The harvested claim text must not be promoted verbatim.** It is the
fact-checker's ClaimReview phrasing — the same text the index embeds — so
copying it unchanged turns recall@5 into a self-match test. Review means:
verify the claim really circulated, rephrase it to its circulating wording,
drop the helper fields, set `expectedUrl` to `null` for negatives, then move
the line into `golden-*.jsonl` and run `pnpm eval --validate` (which also
rejects unedited candidate lines — the helper fields fail the strict golden
schema). Record the methodology (harvested + manually reviewed, n of m
accepted) on issue #15 so the eval report's provenance is honest.

## Curation guide (human-only, issue #15)

Agents must never write these files; everything below is for the human
maintainer. Target composition (§14): `golden-de.jsonl` with ~100 in-index
positives + ~50 out-of-index negatives, `golden-en.jsonl` with 50 items.

- **Collect real viral claims from fact-checker archives** — the de archives
  configured for ingest (`services/ingest/sources.json`): Correctiv,
  dpa-Faktencheck, AFP Faktencheck, BR24 Faktenfuchs; plus the Google Fact
  Check Tools API for both languages. Set `source` to the archive's domain
  (e.g. `correctiv.org`, `dpa-factchecking.com`).
- **Positives**: the claim's fact-check is expected in the snapshot;
  `expectedUrl` is that fact-check's URL. **Negatives**: a viral claim whose
  fact-check is *not* in the index; `expectedUrl` is `null`.
- **No real user handles** anywhere in item text — rephrase the claim
  rather than quoting a post verbatim (`--validate` enforces this).
- **Loop**: add a batch → `pnpm eval --validate` → fix what it lists →
  repeat until green.
- **In-index check**: `--validate` cannot know what the snapshot contains.
  After curation, run the full `pnpm eval --snapshot <m1.ggx>` and check
  `expectedInIndex` per item in the JSON report — `false` on a positive
  means an index-coverage gap (swap the item or note it), not a retrieval
  failure. Those recall numbers feed the #17 go/no-go gate.

## Metrics

- **recall@K** (positives): `expectedUrl` appears in the raw top-K,
  regardless of threshold. Spec §14 target ≥ 0.80.
- **recall@K at threshold** (positives): same, counting only hits scoring
  ≥ threshold — what a user would actually see.
- **false-match rate** (negatives): fraction with ≥ 1 hit scoring
  ≥ threshold. Spec §14 target ≤ 5%.
- Buckets are reported overall and per `lang` label.

URLs are compared canonically: lowercased scheme/host, fragment dropped,
query kept, one trailing slash stripped. Changing these rules changes the
metrics — treat them like a threshold (human approval + committed report).

## Reports

`pnpm eval` writes `reports/eval-<snapshotVersion>-<timestamp>.md` (human
summary) and `.json` (full machine-readable artifact, including per-item
results). Spec §8: any threshold or model change must be committed alongside
its eval report. Exit code 0 means the run completed — judging the numbers
against the §14 targets is the human go/no-go gate (issue #17), not the
runner's.

## Tests

`pnpm -F @gegenrede/eval test` is hermetic (fake embedding provider,
synthetic in-memory snapshot). `EMBEDDING_INTEGRATION=1` additionally runs
the runner against the real pinned model (~120 MB download on first use).
