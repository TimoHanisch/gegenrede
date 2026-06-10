// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// .ggx reader (spec §5). Nothing is returned until the container passes,
// in order: magic, sha256 against the published hash, header validation,
// model+revision parity against the locally pinned model (§6c), section
// length checks, and meta JSONL/offset consistency. A snapshot that fails
// any check is rejected with a GgxError — never partially installed.

import { gunzip, sha256Hex } from "./binary.js";
import { GgxError } from "./errors.js";
import { decodeContainerPrefix, hasGgxMagic } from "./header.js";
import type { GgxHeader } from "./header.js";
import { parseMetaRecord, serializeMetaRecord } from "./meta.js";
import type { GgxMetaRecord } from "./meta.js";

export interface ReadSnapshotOptions {
  /** Hex sha256 from the snapshot's latest.json pointer (§5, §12). */
  expectedSha256: string;
  /**
   * The locally pinned embedding model (EMBEDDING_MODEL_ID /
   * EMBEDDING_MODEL_REVISION from packages/shared). Passed in rather than
   * imported so this package stays free of runtime dependencies (§3).
   */
  pinned: { model: string; modelRevision: string };
}

export interface GgxSnapshot {
  header: GgxHeader;
  /** count × dim int8 values, row-major. */
  vectors: Int8Array;
  /** count f32 dequantization scales. */
  scales: Float32Array;
  meta: GgxMetaRecord[];
}

const LINE_FEED = 0x0a;

function parseMetaBlock(jsonl: Uint8Array, count: number): GgxMetaRecord[] {
  const decoder = new TextDecoder();
  const meta: GgxMetaRecord[] = [];
  let lineStart = 0;
  for (let i = 0; i < jsonl.byteLength; i += 1) {
    if (jsonl[i] !== LINE_FEED) {
      continue;
    }
    meta.push(
      parseMetaRecord(
        decoder.decode(jsonl.subarray(lineStart, i)),
        meta.length,
      ),
    );
    lineStart = i + 1;
  }
  if (lineStart !== jsonl.byteLength) {
    throw new GgxError("bad-meta", "meta block does not end with a newline");
  }
  if (meta.length !== count) {
    throw new GgxError(
      "bad-meta",
      `meta block has ${meta.length} records, header says ${count}`,
    );
  }
  return meta;
}

export async function readSnapshot(
  bytes: Uint8Array,
  options: ReadSnapshotOptions,
): Promise<GgxSnapshot> {
  if (!hasGgxMagic(bytes)) {
    throw new GgxError("bad-magic", "container does not start with GGX1");
  }
  const actualSha256 = await sha256Hex(bytes);
  if (actualSha256 !== options.expectedSha256.toLowerCase()) {
    throw new GgxError(
      "sha256-mismatch",
      "container sha256 does not match the published hash",
    );
  }
  const { header, bodyOffset } = decodeContainerPrefix(bytes);
  if (
    header.model !== options.pinned.model ||
    header.modelRevision !== options.pinned.modelRevision
  ) {
    // §6c embedding parity: vectors from another model/revision are not
    // comparable to locally embedded queries; refuse rather than degrade.
    throw new GgxError(
      "model-mismatch",
      `snapshot was built with ${header.model}@${header.modelRevision}, ` +
        `local pin is ${options.pinned.model}@${options.pinned.modelRevision}`,
    );
  }

  const { count, dim } = header;
  const vectorsLength = count * dim;
  const scalesOffset = bodyOffset + vectorsLength;
  const offsetsOffset = scalesOffset + count * 4;
  const metaGzOffset = offsetsOffset + count * 8;
  if (bytes.byteLength < metaGzOffset) {
    throw new GgxError("truncated", "container ends inside the body sections");
  }

  // Sections are copied out (slice) so the snapshot owns aligned buffers
  // independent of the (arbitrarily offset) input.
  const vectors = new Int8Array(bytes.slice(bodyOffset, scalesOffset).buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const scales = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const scale = view.getFloat32(scalesOffset + i * 4, true);
    if (!Number.isFinite(scale) || scale < 0) {
      throw new GgxError("bad-body", `scale ${i} is not a valid f32 scale`);
    }
    scales[i] = scale;
  }

  let jsonl: Uint8Array;
  try {
    jsonl = await gunzip(bytes.subarray(metaGzOffset));
  } catch {
    throw new GgxError("bad-meta", "meta block is not valid gzip");
  }
  const meta = parseMetaBlock(jsonl, count);

  // The stored offsets are an access aid for partial readers; verify they
  // agree with the actual line layout instead of trusting them blindly.
  const encoder = new TextEncoder();
  let expectedOffset = 0n;
  let recordIndex = 0;
  for (const record of meta) {
    const storedOffset = view.getBigUint64(
      offsetsOffset + recordIndex * 8,
      true,
    );
    if (storedOffset !== expectedOffset) {
      throw new GgxError(
        "bad-meta",
        `meta offset ${recordIndex} is ${storedOffset}, expected ${expectedOffset}`,
      );
    }
    expectedOffset += BigInt(
      encoder.encode(serializeMetaRecord(record) + "\n").byteLength,
    );
    recordIndex += 1;
  }

  return { header, vectors, scales, meta };
}
