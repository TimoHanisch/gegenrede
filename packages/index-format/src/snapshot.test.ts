// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Round-trip and rejection tests for the .ggx container (§5, §14). All
// fixture data is synthetic — invented claims, example.org URLs, no real
// posts, publishers' content, or user data.

import { describe, expect, it } from "vitest";

import { gzip, sha256Hex } from "./binary.js";
import { GgxError } from "./errors.js";
import { dequantizeVector } from "./quant.js";
import { readSnapshot } from "./read.js";
import type { GgxMetaRecord } from "./meta.js";
import {
  encodeSnapshot,
  writeSnapshot,
  type SnapshotIdentity,
  type SnapshotRecord,
} from "./write.js";

const IDENTITY: SnapshotIdentity = {
  version: "2026-06-08",
  model: "intfloat/multilingual-e5-small",
  modelRevision: "614241f622f53c4eeff9890bdc4f31cfecc418b3",
  dim: 16, // small dim keeps fixtures readable; layout math is dim-agnostic
};

const PINNED = {
  model: IDENTITY.model,
  modelRevision: IDENTITY.modelRevision,
};

// mulberry32 — tiny deterministic PRNG so vector fixtures are reproducible.
function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticVector(seed: number, dim = IDENTITY.dim): Float32Array {
  const next = prng(seed);
  return Float32Array.from({ length: dim }, () => next() * 2 - 1);
}

function syntheticMeta(i: number): GgxMetaRecord {
  return {
    id: `fc-${String(i).padStart(4, "0")}`,
    claim: `Erfundene Beispielbehauptung Nummer ${i} über ein fiktives Ereignis.`,
    verdict: i % 2 === 0 ? "false" : "misleading",
    ratingRaw: i % 2 === 0 ? "Falsch" : "Fehlender Kontext",
    publisher: "Beispiel-Faktencheck",
    url: `https://factcheck.example.org/artikel/${i}`,
    publishedAt: "2026-05-31",
    lang: i % 3 === 0 ? "en" : "de",
  };
}

function syntheticRecords(count: number): SnapshotRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    vector: syntheticVector(i + 1),
    meta: syntheticMeta(i),
  }));
}

async function expectCode(run: Promise<unknown>, code: string): Promise<void> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(GgxError);
    expect((error as GgxError).code).toBe(code);
    return;
  }
  throw new Error(`expected a GgxError with code ${code}`);
}

describe("snapshot round trip (§14)", () => {
  it("write → read recovers every record and the header", async () => {
    const records = syntheticRecords(7);
    const { bytes, sha256 } = await writeSnapshot(records, IDENTITY);
    const snapshot = await readSnapshot(bytes, {
      expectedSha256: sha256,
      pinned: PINNED,
    });

    expect(snapshot.header).toMatchObject({
      ...IDENTITY,
      count: 7,
      metric: "cosine",
      quant: "int8-pervec",
    });
    // langs computed from the records: i % 3 === 0 → en (3 of 7)
    expect(snapshot.header.langs).toEqual({ de: 4, en: 3 });

    expect(snapshot.meta).toEqual(records.map((record) => record.meta));

    expect(snapshot.vectors.length).toBe(7 * IDENTITY.dim);
    expect(snapshot.scales.length).toBe(7);
    for (let i = 0; i < records.length; i += 1) {
      const restored = dequantizeVector(
        snapshot.vectors.subarray(i * IDENTITY.dim, (i + 1) * IDENTITY.dim),
        snapshot.scales[i] as number,
      );
      const original = (records[i] as SnapshotRecord).vector;
      const step = (snapshot.scales[i] as number) / 2 + 1e-7;
      for (let d = 0; d < IDENTITY.dim; d += 1) {
        expect(
          Math.abs((restored[d] as number) - (original[d] as number)),
        ).toBeLessThanOrEqual(step);
      }
    }
  });

  it("write → read → re-encode is byte-identical", async () => {
    const records = syntheticRecords(5);
    const first = await writeSnapshot(records, IDENTITY);
    const snapshot = await readSnapshot(first.bytes, {
      expectedSha256: first.sha256,
      pinned: PINNED,
    });
    const second = await encodeSnapshot(IDENTITY, snapshot);
    expect(second.bytes).toEqual(first.bytes);
    expect(second.sha256).toBe(first.sha256);
  });

  it("round-trips an empty snapshot (count 0)", async () => {
    const { bytes, sha256 } = await writeSnapshot([], IDENTITY);
    const snapshot = await readSnapshot(bytes, {
      expectedSha256: sha256,
      pinned: PINNED,
    });
    expect(snapshot.header.count).toBe(0);
    expect(snapshot.header.langs).toEqual({});
    expect(snapshot.meta).toEqual([]);
    expect(snapshot.vectors.length).toBe(0);
  });

  it("accepts the published sha256 in upper case", async () => {
    const { bytes, sha256 } = await writeSnapshot(
      syntheticRecords(1),
      IDENTITY,
    );
    const snapshot = await readSnapshot(bytes, {
      expectedSha256: sha256.toUpperCase(),
      pinned: PINNED,
    });
    expect(snapshot.header.count).toBe(1);
  });
});

describe("snapshot rejection (§5 reader requirements)", () => {
  it("rejects a wrong magic before anything else", async () => {
    const { bytes, sha256 } = await writeSnapshot(
      syntheticRecords(2),
      IDENTITY,
    );
    const tampered = bytes.slice();
    tampered[3] = 0x32; // "GGX2"
    await expectCode(
      readSnapshot(tampered, { expectedSha256: sha256, pinned: PINNED }),
      "bad-magic",
    );
  });

  it("rejects a sha256 mismatch", async () => {
    const { bytes, sha256 } = await writeSnapshot(
      syntheticRecords(2),
      IDENTITY,
    );
    const tampered = bytes.slice();
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    await expectCode(
      readSnapshot(tampered, { expectedSha256: sha256, pinned: PINNED }),
      "sha256-mismatch",
    );
  });

  it("rejects a snapshot built with a different model revision (§6c)", async () => {
    // Mismatched-header fixture: valid container, foreign revision.
    const { bytes, sha256 } = await writeSnapshot(syntheticRecords(2), {
      ...IDENTITY,
      modelRevision: "0000000000000000000000000000000000000000",
    });
    await expectCode(
      readSnapshot(bytes, { expectedSha256: sha256, pinned: PINNED }),
      "model-mismatch",
    );
  });

  it("rejects a snapshot built with a different model id (§6c)", async () => {
    const { bytes, sha256 } = await writeSnapshot(syntheticRecords(2), {
      ...IDENTITY,
      model: "example/other-model",
    });
    await expectCode(
      readSnapshot(bytes, { expectedSha256: sha256, pinned: PINNED }),
      "model-mismatch",
    );
  });

  it("rejects a container truncated inside the body", async () => {
    const { bytes } = await writeSnapshot(syntheticRecords(2), IDENTITY);
    // Cut one byte before the meta block so the fixed-size sections
    // (vectors/scales/offsets) no longer fit the header-declared count.
    const truncated = bytes.slice(0, metaOffsetOf(bytes, 2) - 1);
    const sha256 = await shaOf(truncated);
    await expectCode(
      readSnapshot(truncated, { expectedSha256: sha256, pinned: PINNED }),
      "truncated",
    );
  });

  it("rejects a meta block whose record count disagrees with the header", async () => {
    // Build a 2-record container, then splice in the 1-record meta block.
    const two = await writeSnapshot(syntheticRecords(2), IDENTITY);
    const one = await writeSnapshot(syntheticRecords(1), IDENTITY);
    const twoMetaOffset = metaOffsetOf(two.bytes, 2);
    const oneMetaOffset = metaOffsetOf(one.bytes, 1);
    const spliced = new Uint8Array(
      twoMetaOffset + (one.bytes.length - oneMetaOffset),
    );
    spliced.set(two.bytes.subarray(0, twoMetaOffset));
    spliced.set(one.bytes.subarray(oneMetaOffset), twoMetaOffset);
    await expectCode(
      readSnapshot(spliced, {
        expectedSha256: await shaOf(spliced),
        pinned: PINNED,
      }),
      "bad-meta",
    );
  });

  it("rejects stored meta offsets that disagree with the line layout", async () => {
    const { bytes } = await writeSnapshot(syntheticRecords(3), IDENTITY);
    const tampered = bytes.slice();
    // Second u64 meta offset (record 1) — bump it by one byte.
    const offsetsStart = metaOffsetOf(tampered, 3) - 3 * 8;
    const view = new DataView(tampered.buffer);
    view.setBigUint64(
      offsetsStart + 8,
      view.getBigUint64(offsetsStart + 8, true) + 1n,
      true,
    );
    await expectCode(
      readSnapshot(tampered, {
        expectedSha256: await shaOf(tampered),
        pinned: PINNED,
      }),
      "bad-meta",
    );
  });

  it("writer rejects a vector with the wrong dimensionality", async () => {
    await expectCode(
      writeSnapshot(
        [{ vector: syntheticVector(1, 8), meta: syntheticMeta(0) }],
        IDENTITY,
      ),
      "bad-input",
    );
  });

  it("reader rejects meta records carrying a score", async () => {
    // Hand-build a container whose meta line smuggles a score in.
    const record = { ...syntheticMeta(0), score: 0.97 };
    const { bytes } = await writeSnapshot(
      [{ vector: syntheticVector(1), meta: syntheticMeta(0) }],
      IDENTITY,
    );
    const metaStart = metaOffsetOf(bytes, 1);
    const jsonl = new TextEncoder().encode(JSON.stringify(record) + "\n");
    const gz = await gzipBytes(jsonl);
    const tampered = new Uint8Array(metaStart + gz.length);
    tampered.set(bytes.subarray(0, metaStart));
    tampered.set(gz, metaStart);
    await expectCode(
      readSnapshot(tampered, {
        expectedSha256: await shaOf(tampered),
        pinned: PINNED,
      }),
      "bad-meta",
    );
  });
});

/** Byte offset where the gzipped meta block starts, given the record count. */
function metaOffsetOf(bytes: Uint8Array, count: number): number {
  const headerLen = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(4, true);
  return 8 + headerLen + count * IDENTITY.dim + count * 4 + count * 8;
}

const shaOf = sha256Hex;
const gzipBytes = gzip;
