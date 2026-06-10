// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// .ggx snapshot container (spec §5): writer for the snapshot builder,
// reader for the extension. Pure TS, no runtime dependencies (§3).

export { GgxError, type GgxErrorCode } from "./errors.js";
export { GGX_MAGIC, GGX_METRIC, GGX_QUANT, type GgxHeader } from "./header.js";
export { type GgxMetaRecord } from "./meta.js";
export {
  dequantizeVector,
  quantizeVector,
  type QuantizedVector,
} from "./quant.js";
export {
  readSnapshot,
  type GgxSnapshot,
  type ReadSnapshotOptions,
} from "./read.js";
export {
  SEARCH_CHUNK_ROWS,
  searchSnapshot,
  searchTopK,
  type SearchableIndex,
  type SearchHit,
  type SearchOptions,
  type SnapshotSearchHit,
} from "./search.js";
export {
  encodeSnapshot,
  writeSnapshot,
  type EncodedSnapshot,
  type SnapshotBody,
  type SnapshotIdentity,
  type SnapshotRecord,
} from "./write.js";
