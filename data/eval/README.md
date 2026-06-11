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

Unknown keys are rejected (curation typos must surface). Example lines —
synthetic URLs, not real fact-checks:

```jsonl
{"claim":"Die fiktive Stadt Beispielhausen hat alle Autos verboten.","expectedUrl":"https://factcheck.example.org/artikel/1","lang":"de"}
{"claim":"An invented club presented a fictitious new logo.","expectedUrl":null,"lang":"en"}
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
