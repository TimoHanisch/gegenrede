// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// .ggx writer (spec §5). Two layers: writeSnapshot quantizes f32 vectors
// and delegates to encodeSnapshot, which lays out already-quantized
// sections. The reader's output feeds straight back into encodeSnapshot,
// which is how the round-trip test asserts byte equality (§14).

import { concatBytes, gzip, sha256Hex } from "./binary.js";
import { GgxError } from "./errors.js";
import { encodeContainerPrefix, GGX_METRIC, GGX_QUANT } from "./header.js";
import type { GgxHeader } from "./header.js";
import { serializeMetaRecord } from "./meta.js";
import type { GgxMetaRecord } from "./meta.js";
import { quantizeVector } from "./quant.js";

/** Snapshot provenance recorded in the header (§5, §6c). */
export interface SnapshotIdentity {
  /** Snapshot version, e.g. "2026-06-08". */
  version: string;
  /** Embedding model id the vectors were produced with. */
  model: string;
  /** Pinned HF commit sha of that model (§6c parity). */
  modelRevision: string;
  /** Embedding dimensionality. */
  dim: number;
}

/** One record going into a snapshot: an embedding plus its fact-check meta. */
export interface SnapshotRecord {
  /** L2-normalized passage embedding, length must equal identity.dim. */
  vector: Float32Array;
  meta: GgxMetaRecord;
}

/** Already-quantized snapshot sections, as produced by the reader. */
export interface SnapshotBody {
  /** count × dim int8 values, row-major. */
  vectors: Int8Array;
  /** count f32 dequantization scales. */
  scales: Float32Array;
  meta: readonly GgxMetaRecord[];
}

export interface EncodedSnapshot {
  bytes: Uint8Array;
  /** Hex sha256 of `bytes` — published in latest.json next to the asset. */
  sha256: string;
  header: GgxHeader;
}

function countLangs(meta: readonly GgxMetaRecord[]): Record<string, number> {
  const langs: Record<string, number> = {};
  for (const record of meta) {
    langs[record.lang] = (langs[record.lang] ?? 0) + 1;
  }
  return langs;
}

/** Lays out pre-quantized sections into a .ggx container (§5 body order). */
export async function encodeSnapshot(
  identity: SnapshotIdentity,
  body: SnapshotBody,
): Promise<EncodedSnapshot> {
  const count = body.meta.length;
  if (body.vectors.length !== count * identity.dim) {
    throw new GgxError(
      "bad-input",
      `expected ${count}×${identity.dim} int8 values, got ${body.vectors.length}`,
    );
  }
  if (body.scales.length !== count) {
    throw new GgxError(
      "bad-input",
      `expected ${count} scales, got ${body.scales.length}`,
    );
  }
  for (const scale of body.scales) {
    if (!Number.isFinite(scale) || scale < 0) {
      throw new GgxError("bad-input", "scales must be finite and >= 0");
    }
  }

  const header: GgxHeader = {
    version: identity.version,
    model: identity.model,
    modelRevision: identity.modelRevision,
    dim: identity.dim,
    count,
    metric: GGX_METRIC,
    quant: GGX_QUANT,
    langs: countLangs(body.meta),
  };

  const scaleBytes = new Uint8Array(count * 4);
  const scaleView = new DataView(scaleBytes.buffer);
  let scaleIndex = 0;
  for (const scale of body.scales) {
    scaleView.setFloat32(scaleIndex * 4, scale, true);
    scaleIndex += 1;
  }

  // Meta offsets are byte offsets of each record's line start within the
  // *decompressed* JSONL block (offsets into the gzip stream would be
  // useless for record access); every line ends with \n.
  const encoder = new TextEncoder();
  const offsetBytes = new Uint8Array(count * 8);
  const offsetView = new DataView(offsetBytes.buffer);
  const lines: Uint8Array[] = [];
  let metaOffset = 0;
  let recordIndex = 0;
  for (const record of body.meta) {
    offsetView.setBigUint64(recordIndex * 8, BigInt(metaOffset), true);
    const line = encoder.encode(serializeMetaRecord(record) + "\n");
    lines.push(line);
    metaOffset += line.byteLength;
    recordIndex += 1;
  }
  const metaGz = await gzip(concatBytes(lines));

  const bytes = concatBytes([
    encodeContainerPrefix(header),
    new Uint8Array(
      body.vectors.buffer,
      body.vectors.byteOffset,
      count * identity.dim,
    ),
    scaleBytes,
    offsetBytes,
    metaGz,
  ]);
  return { bytes, sha256: await sha256Hex(bytes), header };
}

/** Quantizes f32 embeddings and writes a .ggx container (§5). */
export async function writeSnapshot(
  records: readonly SnapshotRecord[],
  identity: SnapshotIdentity,
): Promise<EncodedSnapshot> {
  const count = records.length;
  const vectors = new Int8Array(count * identity.dim);
  const scales = new Float32Array(count);
  const meta: GgxMetaRecord[] = [];
  let i = 0;
  for (const record of records) {
    if (record.vector.length !== identity.dim) {
      throw new GgxError(
        "bad-input",
        `record ${i} vector has ${record.vector.length} dimensions, expected ${identity.dim}`,
      );
    }
    const quantized = quantizeVector(record.vector);
    vectors.set(quantized.values, i * identity.dim);
    scales[i] = quantized.scale;
    meta.push(record.meta);
    i += 1;
  }
  return encodeSnapshot(identity, { vectors, scales, meta });
}
