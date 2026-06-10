# Recorded search benchmarks

Spec §15 budget: search step ≤ 300 ms at 100k × 384 on 2020-class hardware.
Recorded, not CI-gated — re-run with `pnpm -F @gegenrede/index-format bench`
and append a row when the kernel changes.

| Date       | Kernel                               | Index      | Median | p95   | Max   | Environment                                            |
| ---------- | ------------------------------------ | ---------- | ------ | ----- | ----- | ------------------------------------------------------ |
| 2026-06-10 | brute-force int8 (`searchTopK`, #10) | 100k × 384 | 63 ms  | 65 ms | 66 ms | Node 22.22.2, Intel Xeon @ 2.10 GHz (4 vCPU container) |

20 measured runs after 5 warmups, single thread, `topK: 5`, `threshold: 0`.

Numerical accuracy companion (§14 gate, asserted in CI by
`src/search.test.ts`): on the seeded 5k × 384 sample, recall@5 f32 0.8708
vs int8 0.8708 (delta 0.0%), top-5 set overlap 98.5%.

Linear scaling projects ~315 ms at 500k rows on this machine — the trigger
point for the HNSW upgrade path (ADR 0007).
