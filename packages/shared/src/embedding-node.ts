// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Node embedding provider (spec §6): the pinned e5 model, q8 ONNX weights,
// executed by transformers.js on its onnxruntime-node backend. Node-only —
// exposed via the `@gegenrede/shared/embedding-node` subpath so the extension
// bundle never pulls it in; the browser provider lives behind the same
// EmbeddingProvider interface in a later milestone.
//
// This file is the only place allowed to import the tokenizer/model library
// (§6a; enforced by no-restricted-imports in eslint.config.js).

import { pipeline } from "@huggingface/transformers";

import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_REVISION,
  type EmbeddingProvider,
} from "./embedding.js";

/**
 * Loads the pinned model (downloads on first use, then cached by the
 * library) and returns a provider for initEmbedding(). Mean pooling per the
 * e5 model card; normalization stays in embedText (§6b), the single locus.
 */
export async function createNodeEmbeddingProvider(): Promise<EmbeddingProvider> {
  const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
    revision: EMBEDDING_MODEL_REVISION,
    dtype: "q8",
  });
  return {
    async embed(prefixedText: string): Promise<Float32Array> {
      const tensor = await extractor(prefixedText, {
        pooling: "mean",
        normalize: false,
      });
      // Tensor#data is a union of typed arrays; feature extraction yields f32.
      const data = tensor.data;
      if (!(data instanceof Float32Array)) {
        throw new Error(
          "[gegenrede] expected Float32Array output from feature extraction",
        );
      }
      return data;
    },
  };
}
