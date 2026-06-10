// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { describe, expect, it } from "vitest";

import { GgxError } from "./errors.js";
import {
  decodeContainerPrefix,
  encodeContainerPrefix,
  GGX_METRIC,
  GGX_PREFIX_LENGTH,
  GGX_QUANT,
  hasGgxMagic,
} from "./header.js";
import type { GgxHeader } from "./header.js";

const HEADER: GgxHeader = {
  version: "2026-06-08",
  model: "intfloat/multilingual-e5-small",
  modelRevision: "614241f622f53c4eeff9890bdc4f31cfecc418b3",
  dim: 384,
  count: 3,
  metric: GGX_METRIC,
  quant: GGX_QUANT,
  langs: { de: 2, en: 1 },
};

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof GgxError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("expected a GgxError");
}

describe("container prefix codec", () => {
  it("round-trips a header", () => {
    const bytes = encodeContainerPrefix(HEADER);
    const { header, bodyOffset } = decodeContainerPrefix(bytes);
    expect(header).toEqual(HEADER);
    expect(bodyOffset).toBe(bytes.byteLength);
  });

  it("encodes byte-identically regardless of langs key order", () => {
    const reordered = { ...HEADER, langs: { en: 1, de: 2 } };
    expect(encodeContainerPrefix(reordered)).toEqual(
      encodeContainerPrefix(HEADER),
    );
  });

  it("starts with the GGX1 magic and a little-endian length", () => {
    const bytes = encodeContainerPrefix(HEADER);
    expect(hasGgxMagic(bytes)).toBe(true);
    expect([...bytes.subarray(0, 4)]).toEqual([0x47, 0x47, 0x58, 0x31]);
    const headerLen = new DataView(bytes.buffer).getUint32(4, true);
    expect(GGX_PREFIX_LENGTH + headerLen).toBe(bytes.byteLength);
  });

  it("rejects a wrong magic", () => {
    const bytes = encodeContainerPrefix(HEADER);
    bytes[0] = 0x58;
    expect(code(() => decodeContainerPrefix(bytes))).toBe("bad-magic");
  });

  it("rejects a container truncated inside the header", () => {
    const bytes = encodeContainerPrefix(HEADER);
    expect(code(() => decodeContainerPrefix(bytes.subarray(0, 12)))).toBe(
      "truncated",
    );
  });

  it.each([
    ["version", ""],
    ["model", 7],
    ["modelRevision", undefined],
    ["dim", 0],
    ["dim", 1.5],
    ["count", -1],
    ["metric", "l2"],
    ["quant", "f16"],
    ["langs", ["de"]],
    ["langs", { de: -1 }],
  ])("rejects a header with bad %s = %j", (field, value) => {
    const json: Record<string, unknown> = { ...HEADER, [field]: value };
    if (value === undefined) {
      delete json[field];
    }
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const bytes = new Uint8Array(GGX_PREFIX_LENGTH + jsonBytes.byteLength);
    bytes.set(new TextEncoder().encode("GGX1"));
    new DataView(bytes.buffer).setUint32(4, jsonBytes.byteLength, true);
    bytes.set(jsonBytes, GGX_PREFIX_LENGTH);
    expect(code(() => decodeContainerPrefix(bytes))).toBe("bad-header");
  });

  it("rejects non-JSON header bytes", () => {
    const jsonBytes = new TextEncoder().encode("not json");
    const bytes = new Uint8Array(GGX_PREFIX_LENGTH + jsonBytes.byteLength);
    bytes.set(new TextEncoder().encode("GGX1"));
    new DataView(bytes.buffer).setUint32(4, jsonBytes.byteLength, true);
    bytes.set(jsonBytes, GGX_PREFIX_LENGTH);
    expect(code(() => decodeContainerPrefix(bytes))).toBe("bad-header");
  });
});
