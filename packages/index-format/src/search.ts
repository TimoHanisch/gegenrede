// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Brute-force int8 search kernel (spec §5): the query is quantized once
// with the same per-vector symmetric scheme as the index, each row is
// scored as an integer int8·int8 dot product, and the cosine is recovered
// by multiplying the two f32 scales ("f32 scale correction"). Integer
// products stay below 2^53 (127 × 127 × dim), so the accumulation is exact
// and independent of summation order. Rows are processed in 8k chunks with
// an awaited callback between chunks so a Web Worker driver (#28) can
// report progress, yield, or cancel — no ANN structure in v1 (ADR 0007).

import { GgxError } from "./errors.js";
import { quantizeVector } from "./quant.js";
import type { GgxSnapshot } from "./read.js";

/** Rows per processed chunk (spec §5: "8k-row chunks"). */
export const SEARCH_CHUNK_ROWS = 8192;

/** The typed-array sections the kernel scans — satisfied by a loaded
 * snapshot's body plus its header `dim`/`count` (see `searchSnapshot`). */
export interface SearchableIndex {
  /** Embedding dimensionality of every row. */
  dim: number;
  /** Number of rows. */
  count: number;
  /** count × dim int8 values, row-major. */
  vectors: Int8Array;
  /** count f32 dequantization scales. */
  scales: Float32Array;
}

export interface SearchHit {
  /** Row index into the index (aligned with the snapshot's meta array). */
  row: number;
  /** Cosine similarity clamped to [0, 1] per FactCheckMatch.score (§4.3). */
  score: number;
}

export interface SearchOptions {
  /** Maximum number of hits to return (≥ 1). */
  topK: number;
  /** Hits scoring below this [0, 1] cosine are dropped. */
  threshold: number;
  /**
   * Awaited after every processed chunk with the number of rows scanned so
   * far. A Web Worker driver (#28) reports progress and yields here; a
   * callback that throws cancels the search (the error propagates).
   */
  onChunk?: (processedRows: number, totalRows: number) => void | Promise<void>;
}

/** Hit resolved against the snapshot meta block: id + score (§4.3). */
export interface SnapshotSearchHit extends SearchHit {
  /** `FactCheckMatch.id` of the matched record. */
  id: string;
}

function validateSearchInput(
  index: SearchableIndex,
  query: Float32Array,
  options: SearchOptions,
): void {
  const { dim, count, vectors, scales } = index;
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new GgxError("bad-input", `index dim ${dim} is invalid`);
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new GgxError("bad-input", `index count ${count} is invalid`);
  }
  if (vectors.length !== count * dim) {
    throw new GgxError(
      "bad-input",
      `vectors has ${vectors.length} values, expected count × dim = ${count * dim}`,
    );
  }
  if (scales.length !== count) {
    throw new GgxError(
      "bad-input",
      `scales has ${scales.length} values, expected count = ${count}`,
    );
  }
  if (query.length !== dim) {
    throw new GgxError(
      "bad-input",
      `query has ${query.length} dimensions, index has ${dim}`,
    );
  }
  if (!Number.isInteger(options.topK) || options.topK < 1) {
    throw new GgxError("bad-input", `topK ${options.topK} is invalid`);
  }
  if (!(options.threshold >= 0 && options.threshold <= 1)) {
    throw new GgxError(
      "bad-input",
      `threshold ${options.threshold} is not in [0, 1]`,
    );
  }
}

// Bounded insertion keeping `hits` sorted by score descending, ties broken
// by lower row, so results are deterministic. topK is ≤ 5 in practice
// (CheckResult.matches caps at 5), so insertion beats a heap.
function insertHit(
  hits: SearchHit[],
  row: number,
  score: number,
  topK: number,
): void {
  const last = hits[hits.length - 1];
  if (
    hits.length === topK &&
    last !== undefined &&
    (score < last.score || (score === last.score && row > last.row))
  ) {
    return;
  }
  let at = hits.length;
  while (at > 0) {
    const prev = hits[at - 1] as SearchHit;
    if (prev.score > score || (prev.score === score && prev.row < row)) {
      break;
    }
    at -= 1;
  }
  hits.splice(at, 0, { row, score });
  if (hits.length > topK) {
    hits.pop();
  }
}

/**
 * Scans every row of the index (no ANN in v1, spec §5) and returns up to
 * `topK` hits with cosine ≥ `threshold`, sorted by score descending.
 * `query` must be the L2-normalized f32 embedding from `shared/embedText`
 * (`query:` prefix, §6a) so that cosine == dot.
 */
export async function searchTopK(
  index: SearchableIndex,
  query: Float32Array,
  options: SearchOptions,
): Promise<SearchHit[]> {
  validateSearchInput(index, query, options);
  const { values: quantizedQuery, scale: queryScale } = quantizeVector(query);
  const { dim, count, vectors, scales } = index;
  const { topK, threshold, onChunk } = options;
  const hits: SearchHit[] = [];
  for (
    let chunkStart = 0;
    chunkStart < count;
    chunkStart += SEARCH_CHUNK_ROWS
  ) {
    const chunkEnd = Math.min(chunkStart + SEARCH_CHUNK_ROWS, count);
    let offset = chunkStart * dim;
    for (let row = chunkStart; row < chunkEnd; row += 1) {
      let dot = 0;
      for (let i = 0; i < dim; i += 1) {
        dot += (vectors[offset + i] as number) * (quantizedQuery[i] as number);
      }
      offset += dim;
      const cosine = dot * queryScale * (scales[row] as number);
      // Quantization noise can push the cosine slightly outside [0, 1];
      // clamp instead of remapping so thresholds keep their meaning (§4.3).
      const score = cosine < 0 ? 0 : cosine > 1 ? 1 : cosine;
      if (score >= threshold) {
        insertHit(hits, row, score, topK);
      }
    }
    if (onChunk !== undefined) {
      await onChunk(chunkEnd, count);
    }
  }
  return hits;
}

/**
 * `searchTopK` over a loaded snapshot, with each hit resolved to its
 * record id via the row-aligned meta block.
 */
export async function searchSnapshot(
  snapshot: GgxSnapshot,
  query: Float32Array,
  options: SearchOptions,
): Promise<SnapshotSearchHit[]> {
  const hits = await searchTopK(
    {
      dim: snapshot.header.dim,
      count: snapshot.header.count,
      vectors: snapshot.vectors,
      scales: snapshot.scales,
    },
    query,
    options,
  );
  return hits.map((hit) => {
    const record = snapshot.meta[hit.row];
    if (record === undefined) {
      throw new GgxError(
        "bad-input",
        `snapshot meta has no record for row ${hit.row}`,
      );
    }
    return { id: record.id, row: hit.row, score: hit.score };
  });
}
