# ADR 0007: Brute-force search in v1; HNSW as the upgrade path past ~500k vectors

- **Status:** proposed (documents spec §5's v1 decision)
- **Date:** 2026-06-10
- **Spec sections affected:** §5, §15

## Context

The Local-Mode matcher scans the snapshot with a brute-force int8
dot-product kernel (spec §5). At the v1 reference size — 100k × 384 int8,
~38 MB of vectors — a full scan fits the ≤ 300 ms search budget (§15) on
2020-class hardware with a wide margin (see
`packages/index-format/BENCHMARKS.md`). Brute force is exact (recall cost
comes only from int8 quantization, gated at < 1% by the §14 test), has no
build step, no graph state in the snapshot, and no tuning parameters.

An ANN structure (HNSW being the standard candidate) would buy sub-linear
search at the cost of: an index-build step in the snapshot builder, a graph
section in the `.ggx` format (a format version bump), meaningful memory
overhead on top of the raw vectors, approximate recall that would need its
own evaluation against the golden set, and tuning (`M`, `efSearch`) that
varies by corpus. None of that is justified while a full scan is this far
under budget. A third option — product quantization / IVF — saves memory
rather than time and is even less relevant at this corpus size.

## Decision

We will ship brute-force scanning in v1 and revisit with HNSW only when
the index approaches ~500k vectors, where linear scaling of the measured
numbers projects the scan toward the 300 ms budget.

## Consequences

Search cost grows linearly with the corpus: the ~5× headroom implied by the
v1 measurements is consumed at roughly 5× the corpus. The snapshot builder
(or the eval runner, which reports corpus size) should flag when a
published snapshot crosses ~500k records so the upgrade is triggered by
data, not by surprise. Upgrading later means: a new `.ggx` section (or
side file) for the graph, a header `quant`/format version bump that old
readers reject cleanly (the v1 reader already rejects unknown layouts),
and a recall re-run of the §14 accuracy gate plus the golden eval with ANN
approximation included. Nothing in the v1 kernel API needs to change for
callers: `searchTopK` / `searchSnapshot` keep their contract and an HNSW
implementation would slot in behind the same signature.
