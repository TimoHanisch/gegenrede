// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

export {
  EMBEDDING_DIM,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_REVISION,
  embedText,
  initEmbedding,
  l2Normalize,
  resetEmbedding,
  type EmbedKind,
  type EmbeddingProvider,
} from "./embedding.js";
export { CLEANUP_MAX_TOKENS, cleanPostText } from "./cleanup.js";
export {
  LANGUAGE_CONFIDENCE_THRESHOLD,
  detectPostLanguage,
  type LanguageDetection,
} from "./detect-language.js";
export { Technique, Verdict } from "./taxonomies.js";
export { CheckResult, ExtractedPost, FactCheckMatch } from "./core-types.js";
export { VERDICT_MAP, mapVerdict, verdictMapKey } from "./verdict-map.js";
export { OUTBOUND_SCHEMAS, OutboundPost, toOutboundPost } from "./outbound.js";
