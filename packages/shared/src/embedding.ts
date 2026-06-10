// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Spec §6 — the single embedding pathway. Every embed call in the project
// goes through embedText (CLAUDE.md Hard Rule 6): the E5 prefix (§6a) and
// L2 normalization (§6b) are applied here so no provider or call site can
// skip or duplicate them. Direct tokenizer/model imports outside the shared
// embedding providers are lint-banned (eslint.config.js).

export const EMBEDDING_MODEL_ID = "intfloat/multilingual-e5-small";

// Pinned HF revision (§6c) — recorded in every snapshot header; client and
// ingest refuse to operate across mismatched revisions. Changing it is a
// maintainer-only decision tied to snapshot compatibility (Hard Rule 6,
// ADR-0001); this initial pin was confirmed by the maintainer in issue #7.
export const EMBEDDING_MODEL_REVISION =
  "614241f622f53c4eeff9890bdc4f31cfecc418b3";

export const EMBEDDING_DIM = 384;

// §6a — claims are indexed as passages, lookups are embedded as queries.
export type EmbedKind = "query" | "passage";

const E5_PREFIX: Record<EmbedKind, string> = {
  query: "query: ",
  passage: "passage: ",
};

/**
 * Runtime-specific embedding backend. Implementations receive text that is
 * already E5-prefixed and must return a raw (not necessarily normalized)
 * EMBEDDING_DIM-dimensional vector. Node: `./embedding-node.js`; browser:
 * deferred to the extension milestone behind this same interface.
 */
export interface EmbeddingProvider {
  embed(prefixedText: string): Promise<Float32Array>;
}

let provider: EmbeddingProvider | undefined;

/** Registers the runtime's provider; must be called once before embedText. */
export function initEmbedding(next: EmbeddingProvider): void {
  provider = next;
}

/** Clears the registered provider (test isolation). */
export function resetEmbedding(): void {
  provider = undefined;
}

/**
 * Embeds text with E5 prefix discipline and returns an L2-normalized
 * EMBEDDING_DIM vector (cosine == dot). `text` is treated as raw content:
 * the prefix is always prepended here, exactly once.
 */
export async function embedText(
  kind: EmbedKind,
  text: string,
): Promise<Float32Array> {
  if (provider === undefined) {
    throw new Error(
      "[gegenrede] embedText called before initEmbedding(provider)",
    );
  }
  if (text.trim().length === 0) {
    throw new Error("[gegenrede] embedText called with empty text");
  }
  const raw = await provider.embed(E5_PREFIX[kind] + text);
  if (raw.length !== EMBEDDING_DIM) {
    throw new Error(
      `[gegenrede] embedding provider returned ${raw.length} dimensions, expected ${EMBEDDING_DIM}`,
    );
  }
  return l2Normalize(raw);
}

/** Returns a unit-norm copy of the vector (§6b). */
export function l2Normalize(vector: Float32Array): Float32Array {
  let sumOfSquares = 0;
  for (const value of vector) {
    sumOfSquares += value * value;
  }
  const norm = Math.sqrt(sumOfSquares);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error(
      "[gegenrede] cannot L2-normalize a zero or non-finite vector",
    );
  }
  return vector.map((value) => value / norm);
}
