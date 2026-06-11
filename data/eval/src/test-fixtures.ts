// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Test-only helpers. All data is synthetic — invented claims, example.org
// URLs, no real posts or user data (CLAUDE.md Testing discipline). Golden
// fixtures are inline JSONL strings in the tests, never golden-*.jsonl
// files in the package root: that glob is reserved for the human-curated
// sets (#15) and the CLI's discovery would pick fixtures up.

import {
  readSnapshot,
  writeSnapshot,
  type GgxMetaRecord,
  type GgxSnapshot,
} from "@gegenrede/index-format";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_REVISION,
  type EmbeddingProvider,
} from "@gegenrede/shared";

import type { LoadedGoldenItem } from "./golden.js";

/**
 * Unit vector along one axis. Snapshots must be EMBEDDING_DIM-dimensional
 * because the queries come through shared/embedText, which enforces it.
 */
export function basisVector(axis: number, dim = EMBEDDING_DIM): Float32Array {
  const vector = new Float32Array(dim);
  vector[axis] = 1;
  return vector;
}

/**
 * Unit vector with an exact cosine against basisVector(primaryAxis). Keep
 * asserted scores ≥ 0.05 away from any threshold: per-vector int8
 * quantization perturbs the recovered cosine by up to ~0.004.
 */
export function vectorWithCosine(
  primaryAxis: number,
  secondaryAxis: number,
  cosine: number,
): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIM);
  vector[primaryAxis] = cosine;
  vector[secondaryAxis] = Math.sqrt(1 - cosine * cosine);
  return vector;
}

/**
 * Provider that only knows the exact prefixed strings in `map` and throws
 * on anything else — a test that passes proves the precise `query: ` +
 * cleaned text reached the provider (Hard Rule 6 / §6a discipline).
 */
export function fakeProvider(
  map: Map<string, Float32Array>,
): EmbeddingProvider {
  return {
    embed: (prefixedText) => {
      const vector = map.get(prefixedText);
      if (vector === undefined) {
        throw new Error(
          `fake provider has no vector for ${JSON.stringify(prefixedText)}`,
        );
      }
      return Promise.resolve(vector);
    },
  };
}

export interface SyntheticRecord {
  url: string;
  lang: "de" | "en";
  vector: Float32Array;
}

export const SYNTHETIC_SNAPSHOT_VERSION = "2026-06-08";

/**
 * Builds a real .ggx in memory (writeSnapshot) and reads it back, so tests
 * exercise the same container the CLI consumes. Identity uses the real
 * pinned model/revision — readSnapshot enforces parity (§6c).
 */
export async function buildSyntheticSnapshot(
  records: readonly SyntheticRecord[],
): Promise<{ bytes: Uint8Array; sha256: string; snapshot: GgxSnapshot }> {
  const meta = (record: SyntheticRecord, i: number): GgxMetaRecord => ({
    id: `fc-${String(i).padStart(4, "0")}`,
    claim: `Erfundene Beispielbehauptung Nummer ${i} über ein fiktives Ereignis.`,
    verdict: "false",
    ratingRaw: "Falsch",
    publisher: "Beispiel-Faktencheck",
    url: record.url,
    publishedAt: "2026-05-31",
    lang: record.lang,
  });
  const { bytes, sha256 } = await writeSnapshot(
    records.map((record, i) => ({
      vector: record.vector,
      meta: meta(record, i),
    })),
    {
      version: SYNTHETIC_SNAPSHOT_VERSION,
      model: EMBEDDING_MODEL_ID,
      modelRevision: EMBEDDING_MODEL_REVISION,
      dim: EMBEDDING_DIM,
    },
  );
  const snapshot = await readSnapshot(bytes, {
    expectedSha256: sha256,
    pinned: {
      model: EMBEDDING_MODEL_ID,
      modelRevision: EMBEDDING_MODEL_REVISION,
    },
  });
  return { bytes, sha256, snapshot };
}

/** Golden item with fixture provenance defaults. */
export function goldenItem(
  overrides: Partial<LoadedGoldenItem> & Pick<LoadedGoldenItem, "claim">,
): LoadedGoldenItem {
  return {
    expectedUrl: null,
    lang: "de",
    file: "fixture.jsonl",
    line: 1,
    ...overrides,
  };
}
