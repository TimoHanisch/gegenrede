// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Integration-only — skipped unless EMBEDDING_INTEGRATION=1: loads the real
// pinned model, which downloads ~120 MB from huggingface.co on first use.
// Hermetic CI has no network and no model cache (CLAUDE.md Testing
// discipline), so the hermetic coverage of embedText lives in
// embedding.test.ts against a mock provider.

import { afterAll, describe, expect, it } from "vitest";

import { createNodeEmbeddingProvider } from "./embedding-node.js";
import {
  EMBEDDING_DIM,
  embedText,
  initEmbedding,
  resetEmbedding,
} from "./embedding.js";

const INTEGRATION = process.env["EMBEDDING_INTEGRATION"] === "1";

function norm(vector: Float32Array): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += (a[i] as number) * (b[i] as number);
  }
  return sum;
}

describe.skipIf(!INTEGRATION)(
  "node embedding provider (integration, pinned e5 model)",
  () => {
    afterAll(() => {
      resetEmbedding();
    });

    it(
      "produces unit-norm 384-dim vectors that rank a paraphrase above an unrelated claim",
      { timeout: 300_000 },
      async () => {
        initEmbedding(await createNodeEmbeddingProvider());

        const query = await embedText("query", "Die Erde ist eine Scheibe");
        const paraphrase = await embedText(
          "passage",
          "The earth is flat, not a globe",
        );
        const unrelated = await embedText(
          "passage",
          "Der Zug von Hamburg nach München hat heute Verspätung",
        );

        expect(query.length).toBe(EMBEDDING_DIM);
        expect(norm(query)).toBeCloseTo(1, 4);
        expect(norm(paraphrase)).toBeCloseTo(1, 4);

        // Cross-lingual paraphrase must score above an unrelated DE claim
        // (cosine == dot after §6b normalization).
        expect(dot(query, paraphrase)).toBeGreaterThan(dot(query, unrelated));
      },
    );
  },
);
