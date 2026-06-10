// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { describe, expect, it } from "vitest";

import { GgxError } from "./errors.js";
import { quantizeVector } from "./quant.js";
import type { GgxSnapshot } from "./read.js";
import { SEARCH_CHUNK_ROWS, searchSnapshot, searchTopK } from "./search.js";
import type { SearchableIndex, SearchHit } from "./search.js";

// Deterministic PRNG (mulberry32) — the accuracy gate below must be
// hermetic and reproducible, never flaky (§14).
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

function gaussian(random: () => number): number {
  // Box-Muller; guard against log(0).
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function randomUnitVector(dim: number, random: () => number): Float32Array {
  const vector = new Float32Array(dim);
  let normSq = 0;
  for (let i = 0; i < dim; i += 1) {
    const value = gaussian(random);
    vector[i] = value;
    normSq += value * value;
  }
  const norm = Math.sqrt(normSq);
  for (let i = 0; i < dim; i += 1) {
    vector[i] = (vector[i] as number) / norm;
  }
  return vector;
}

function buildIndex(rows: Float32Array[], dim: number): SearchableIndex {
  const count = rows.length;
  const vectors = new Int8Array(count * dim);
  const scales = new Float32Array(count);
  rows.forEach((row, i) => {
    const { values, scale } = quantizeVector(row);
    vectors.set(values, i * dim);
    scales[i] = scale;
  });
  return { dim, count, vectors, scales };
}

// Independent reference: per-row score computed the same way the kernel
// defines it (integer dot × scales, clamped), but via a full sort instead
// of chunked bounded insertion. Integer accumulation is exact in f64, so
// kernel and reference must agree bit-for-bit.
function referenceSearch(
  index: SearchableIndex,
  query: Float32Array,
  topK: number,
  threshold: number,
): SearchHit[] {
  const { values: q, scale: queryScale } = quantizeVector(query);
  const hits: SearchHit[] = [];
  for (let row = 0; row < index.count; row += 1) {
    let dot = 0;
    for (let i = 0; i < index.dim; i += 1) {
      dot += (index.vectors[row * index.dim + i] as number) * (q[i] as number);
    }
    const cosine = dot * queryScale * (index.scales[row] as number);
    const score = Math.min(1, Math.max(0, cosine));
    if (score >= threshold) {
      hits.push({ row, score });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.row - b.row);
  return hits.slice(0, topK);
}

// Exact f32 ground truth on the *unquantized* vectors, for the §14 recall
// comparison. Same deterministic tie-break as the kernel.
function f32TopK(
  rows: Float32Array[],
  query: Float32Array,
  topK: number,
): number[] {
  const scored = rows.map((row, index) => {
    let dot = 0;
    for (let i = 0; i < row.length; i += 1) {
      dot += (row[i] as number) * (query[i] as number);
    }
    return { row: index, score: dot };
  });
  scored.sort((a, b) => b.score - a.score || a.row - b.row);
  return scored.slice(0, topK).map((hit) => hit.row);
}

describe("searchTopK", () => {
  it("ranks rows by cosine similarity to the query", async () => {
    const dim = 4;
    const rows = [
      new Float32Array([0, 1, 0, 0]),
      new Float32Array([1, 0, 0, 0]),
      new Float32Array([0, 0, 0, 1]),
    ];
    const query = new Float32Array([1, 0, 0, 0]);
    const hits = await searchTopK(buildIndex(rows, dim), query, {
      topK: 2,
      threshold: 0,
    });
    expect(hits.map((hit) => hit.row)).toEqual([1, 0]);
    expect(hits[0]?.score).toBeCloseTo(1, 5);
    expect(hits[1]?.score).toBe(0);
  });

  it("matches a full-sort reference exactly on random data", async () => {
    const random = mulberry32(7);
    const dim = 32;
    const rows = Array.from({ length: 500 }, () =>
      randomUnitVector(dim, random),
    );
    const index = buildIndex(rows, dim);
    for (let i = 0; i < 10; i += 1) {
      const query = randomUnitVector(dim, random);
      const hits = await searchTopK(index, query, { topK: 5, threshold: 0 });
      expect(hits).toEqual(referenceSearch(index, query, 5, 0));
    }
  });

  it("drops hits below the threshold", async () => {
    const dim = 2;
    const rows = [
      new Float32Array([1, 0]),
      new Float32Array([Math.SQRT1_2, Math.SQRT1_2]),
      new Float32Array([0, 1]),
    ];
    const hits = await searchTopK(
      buildIndex(rows, dim),
      new Float32Array([1, 0]),
      { topK: 5, threshold: 0.9 },
    );
    expect(hits.map((hit) => hit.row)).toEqual([0]);
  });

  it("clamps scores to [0, 1] (§4.3) — opposite vectors score 0", async () => {
    const dim = 2;
    const rows = [new Float32Array([-1, 0])];
    const hits = await searchTopK(
      buildIndex(rows, dim),
      new Float32Array([1, 0]),
      { topK: 1, threshold: 0 },
    );
    expect(hits).toEqual([{ row: 0, score: 0 }]);
  });

  it("breaks score ties by lower row for deterministic results", async () => {
    const dim = 2;
    const same = new Float32Array([1, 0]);
    const rows = [same, same, same, same];
    const hits = await searchTopK(
      buildIndex(rows, dim),
      new Float32Array([1, 0]),
      { topK: 2, threshold: 0 },
    );
    expect(hits.map((hit) => hit.row)).toEqual([0, 1]);
  });

  it("returns every row above threshold when count < topK", async () => {
    const dim = 2;
    const rows = [new Float32Array([1, 0]), new Float32Array([0.9, 0.1])];
    const hits = await searchTopK(
      buildIndex(rows, dim),
      new Float32Array([1, 0]),
      { topK: 5, threshold: 0 },
    );
    expect(hits).toHaveLength(2);
  });

  it("returns no hits and no chunk callbacks on an empty index", async () => {
    const calls: number[] = [];
    const hits = await searchTopK(
      {
        dim: 4,
        count: 0,
        vectors: new Int8Array(0),
        scales: new Float32Array(0),
      },
      new Float32Array(4),
      {
        topK: 5,
        threshold: 0,
        onChunk: (processed) => void calls.push(processed),
      },
    );
    expect(hits).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("scores everything 0 for an all-zero query", async () => {
    const dim = 2;
    const rows = [new Float32Array([1, 0]), new Float32Array([0, 1])];
    const hits = await searchTopK(
      buildIndex(rows, dim),
      new Float32Array(dim),
      {
        topK: 5,
        threshold: 0,
      },
    );
    expect(hits.map((hit) => hit.score)).toEqual([0, 0]);
  });

  describe("chunked processing (§5: 8k rows)", () => {
    function flatIndex(count: number, dim: number): SearchableIndex {
      // All-equal rows; the chunking tests only observe callback cadence.
      const vectors = new Int8Array(count * dim).fill(1);
      const scales = new Float32Array(count).fill(0.01);
      return { dim, count, vectors, scales };
    }

    it("reports progress after every 8k-row chunk plus the remainder", async () => {
      const count = SEARCH_CHUNK_ROWS * 2 + 100;
      const calls: Array<[number, number]> = [];
      await searchTopK(flatIndex(count, 4), new Float32Array(4).fill(0.5), {
        topK: 1,
        threshold: 0,
        onChunk: (processed, total) => void calls.push([processed, total]),
      });
      expect(calls).toEqual([
        [SEARCH_CHUNK_ROWS, count],
        [SEARCH_CHUNK_ROWS * 2, count],
        [count, count],
      ]);
    });

    it("does not emit an empty trailing chunk on exact multiples", async () => {
      const count = SEARCH_CHUNK_ROWS;
      const calls: Array<[number, number]> = [];
      await searchTopK(flatIndex(count, 4), new Float32Array(4).fill(0.5), {
        topK: 1,
        threshold: 0,
        onChunk: (processed, total) => void calls.push([processed, total]),
      });
      expect(calls).toEqual([[count, count]]);
    });

    it("awaits async callbacks and propagates their errors (cancellation)", async () => {
      const count = SEARCH_CHUNK_ROWS + 1;
      let calls = 0;
      await expect(
        searchTopK(flatIndex(count, 4), new Float32Array(4).fill(0.5), {
          topK: 1,
          threshold: 0,
          onChunk: async () => {
            calls += 1;
            await Promise.resolve();
            throw new Error("cancelled");
          },
        }),
      ).rejects.toThrowError("cancelled");
      expect(calls).toBe(1);
    });

    it("finds hits across chunk boundaries", async () => {
      const dim = 4;
      const count = SEARCH_CHUNK_ROWS + 10;
      const rows = Array.from(
        { length: count },
        () => new Float32Array([0, 1, 0, 0]),
      );
      rows[SEARCH_CHUNK_ROWS + 5] = new Float32Array([1, 0, 0, 0]);
      const hits = await searchTopK(
        buildIndex(rows, dim),
        new Float32Array([1, 0, 0, 0]),
        { topK: 1, threshold: 0.5 },
      );
      expect(hits.map((hit) => hit.row)).toEqual([SEARCH_CHUNK_ROWS + 5]);
    });
  });

  describe("input validation", () => {
    const index = (): SearchableIndex => ({
      dim: 2,
      count: 1,
      vectors: new Int8Array([127, 0]),
      scales: new Float32Array([0.01]),
    });
    const query = (): Float32Array => new Float32Array([1, 0]);

    it("rejects a query whose dimensionality differs from the index", async () => {
      await expect(
        searchTopK(index(), new Float32Array(3), { topK: 1, threshold: 0 }),
      ).rejects.toThrowError(GgxError);
    });

    it("rejects vectors/scales sections inconsistent with count × dim", async () => {
      await expect(
        searchTopK({ ...index(), vectors: new Int8Array(3) }, query(), {
          topK: 1,
          threshold: 0,
        }),
      ).rejects.toThrowError(/vectors/);
      await expect(
        searchTopK({ ...index(), scales: new Float32Array(2) }, query(), {
          topK: 1,
          threshold: 0,
        }),
      ).rejects.toThrowError(/scales/);
    });

    it("rejects non-positive or fractional topK", async () => {
      for (const topK of [0, -1, 1.5]) {
        await expect(
          searchTopK(index(), query(), { topK, threshold: 0 }),
        ).rejects.toThrowError(/topK/);
      }
    });

    it("rejects thresholds outside [0, 1] and NaN", async () => {
      for (const threshold of [-0.1, 1.1, Number.NaN]) {
        await expect(
          searchTopK(index(), query(), { topK: 1, threshold }),
        ).rejects.toThrowError(/threshold/);
      }
    });

    it("rejects a non-finite query (via quantizeVector)", async () => {
      await expect(
        searchTopK(index(), new Float32Array([1, Number.NaN]), {
          topK: 1,
          threshold: 0,
        }),
      ).rejects.toThrowError(/non-finite/);
    });
  });
});

describe("int8 vs f32 numerical accuracy (§14)", () => {
  // The §14 gate: int8 quantization must cost less than 1% recall @ top-5
  // on a 5k synthetic sample at the production dimensionality. Recall is
  // the §14 retrieval metric (does the relevant record make the top-5?):
  // each query is a noisy restatement of one known index row, and recall@5
  // under exact f32 is compared with recall@5 under the int8 kernel. Noise
  // levels run from trivial to past the retrieval limit, so a share of the
  // positives sits right at the top-5 boundary where quantization can
  // actually flip the outcome. Fully seeded — the result is a constant.
  it(
    "recall delta < 1% @ top-5 on a 5k sample",
    { timeout: 60_000 },
    async () => {
      const random = mulberry32(20260610);
      const dim = 384;
      const count = 5000;
      const topK = 5;
      // Perturbation norms relative to the unit source row; cosine to the
      // source ≈ 1/√(1+λ²). Background top-5 cosines on a 5k uniform sample
      // sit near 0.17–0.19, so the last levels are at/past the boundary.
      const noiseLevels = [0.1, 0.5, 1.0, 2.0, 3.5, 4.5, 5.5, 7.0];
      const queriesPerLevel = 30;

      const rows = Array.from({ length: count }, () =>
        randomUnitVector(dim, random),
      );
      const index = buildIndex(rows, dim);

      const queries: Array<{ vector: Float32Array; sourceRow: number }> = [];
      for (const level of noiseLevels) {
        for (let i = 0; i < queriesPerLevel; i += 1) {
          const sourceRow = Math.floor(random() * count);
          const source = rows[sourceRow] as Float32Array;
          const noisy = new Float32Array(dim);
          let normSq = 0;
          for (let j = 0; j < dim; j += 1) {
            const value =
              (source[j] as number) +
              (level * gaussian(random)) / Math.sqrt(dim);
            noisy[j] = value;
            normSq += value * value;
          }
          const norm = Math.sqrt(normSq);
          for (let j = 0; j < dim; j += 1) {
            noisy[j] = (noisy[j] as number) / norm;
          }
          queries.push({ vector: noisy, sourceRow });
        }
      }

      let f32Found = 0;
      let int8Found = 0;
      let overlap = 0;
      for (const { vector, sourceRow } of queries) {
        const truth = f32TopK(rows, vector, topK);
        const hits = await searchTopK(index, vector, { topK, threshold: 0 });
        if (truth.includes(sourceRow)) {
          f32Found += 1;
        }
        if (hits.some((hit) => hit.row === sourceRow)) {
          int8Found += 1;
        }
        const truthSet = new Set(truth);
        for (const hit of hits) {
          if (truthSet.has(hit.row)) {
            overlap += 1;
          }
        }
      }

      const f32Recall = f32Found / queries.length;
      const int8Recall = int8Found / queries.length;
      console.log(
        `[accuracy] recall@5 f32 ${f32Recall.toFixed(4)}, ` +
          `int8 ${int8Recall.toFixed(4)}, ` +
          `top-5 overlap ${(overlap / (queries.length * topK)).toFixed(4)}`,
      );
      // Sanity on the sample itself: the noise ladder must produce both easy
      // and boundary cases, or the delta below would be vacuous.
      expect(f32Recall).toBeGreaterThan(0.5);
      expect(f32Recall).toBeLessThan(1);
      // The §14 gate.
      expect(Math.abs(f32Recall - int8Recall)).toBeLessThan(0.01);
      // Tripwire against gross numerical errors: even where exact top-5
      // membership is decided by sub-quantization-step margins, the int8
      // top-5 must stay close to the exact-f32 top-5.
      expect(overlap / (queries.length * topK)).toBeGreaterThan(0.95);
    },
  );
});

describe("searchSnapshot", () => {
  function makeSnapshot(): GgxSnapshot {
    const dim = 2;
    const rows = [
      new Float32Array([0, 1]),
      new Float32Array([1, 0]),
      new Float32Array([Math.SQRT1_2, Math.SQRT1_2]),
    ];
    const index = buildIndex(rows, dim);
    return {
      header: {
        version: "2026-06-10",
        model: "intfloat/multilingual-e5-small",
        modelRevision: "0000000000000000000000000000000000000000",
        dim,
        count: rows.length,
        metric: "cosine",
        quant: "int8-pervec",
        langs: { de: rows.length },
      },
      vectors: index.vectors,
      scales: index.scales,
      meta: rows.map((_, i) => ({
        id: `fc-${i}`,
        claim: `claim ${i}`,
        verdict: "false",
        ratingRaw: "Falsch",
        publisher: "example",
        url: `https://example.org/fc-${i}`,
        publishedAt: "2026-01-01",
        lang: "de",
      })),
    };
  }

  it("resolves hit rows to meta record ids", async () => {
    const hits = await searchSnapshot(
      makeSnapshot(),
      new Float32Array([1, 0]),
      { topK: 2, threshold: 0.5 },
    );
    expect(hits.map(({ id, row }) => ({ id, row }))).toEqual([
      { id: "fc-1", row: 1 },
      { id: "fc-2", row: 2 },
    ]);
    expect(hits[0]?.score).toBeCloseTo(1, 5);
  });

  it("rejects a snapshot whose meta is shorter than its hits", async () => {
    const snapshot = makeSnapshot();
    snapshot.meta = snapshot.meta.slice(0, 1);
    await expect(
      searchSnapshot(snapshot, new Float32Array([1, 0]), {
        topK: 2,
        threshold: 0.5,
      }),
    ).rejects.toThrowError(/meta has no record/);
  });
});
