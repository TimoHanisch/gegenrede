// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Search-time benchmark at the spec's reference size, 100k × 384 (§15:
// search step ≤ 300 ms). Recorded, not CI-gated: it only runs via
// `pnpm -F @gegenrede/index-format bench` (GGX_BENCH=1) and is skipped by
// plain `pnpm test`. Recorded results live in
// packages/index-format/BENCHMARKS.md.

import { describe, expect, it } from "vitest";

import { searchTopK } from "./search.js";
import type { SearchableIndex } from "./search.js";

// This package has no runtime deps, so node globals are untyped here
// (no @types/node); the env lookup goes through globalThis instead.
const RUN_BENCH =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.["GGX_BENCH"] === "1";

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sortedMs: number[], p: number): number {
  const at = Math.min(
    sortedMs.length - 1,
    Math.ceil((p / 100) * sortedMs.length) - 1,
  );
  return sortedMs[Math.max(0, at)] as number;
}

describe.skipIf(!RUN_BENCH)("search benchmark (§15, recorded)", () => {
  it("records search time at 100k × 384", { timeout: 300_000 }, async () => {
    const dim = 384;
    const count = 100_000;
    const random = mulberry32(42);

    // Random int8 rows + plausible e5-scale dequant scales; the kernel's
    // cost is data-independent, so synthetic content times the same as a
    // real snapshot of this shape.
    const vectors = new Int8Array(count * dim);
    for (let i = 0; i < vectors.length; i += 1) {
      vectors[i] = Math.floor(random() * 255) - 127;
    }
    const scales = new Float32Array(count).fill(0.005);
    const index: SearchableIndex = { dim, count, vectors, scales };

    const queries = Array.from({ length: 25 }, () => {
      const query = new Float32Array(dim);
      let normSq = 0;
      for (let i = 0; i < dim; i += 1) {
        const value = random() * 2 - 1;
        query[i] = value;
        normSq += value * value;
      }
      const norm = Math.sqrt(normSq);
      for (let i = 0; i < dim; i += 1) {
        query[i] = (query[i] as number) / norm;
      }
      return query;
    });

    const warmupRuns = 5;
    const timings: number[] = [];
    for (let run = 0; run < queries.length; run += 1) {
      const query = queries[run] as Float32Array;
      const start = performance.now();
      const hits = await searchTopK(index, query, { topK: 5, threshold: 0 });
      const elapsed = performance.now() - start;
      expect(hits).toHaveLength(5);
      if (run >= warmupRuns) {
        timings.push(elapsed);
      }
    }

    timings.sort((a, b) => a - b);
    const median = percentile(timings, 50);
    const p95 = percentile(timings, 95);
    const max = timings[timings.length - 1] as number;
    console.log(
      `[bench] search 100k×384, ${timings.length} measured runs ` +
        `(after ${warmupRuns} warmup): median ${median.toFixed(1)} ms, ` +
        `p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms ` +
        `(budget ≤ 300 ms, §15)`,
    );
  });
});
