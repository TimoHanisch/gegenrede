// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Container prefix codec (spec §5): 4-byte "GGX1" magic, little-endian u32
// header length, then the UTF-8 JSON header. Encoding uses a fixed key
// order (and sorted `langs`) so identical headers serialize to identical
// bytes — the round-trip byte-equality test (§14) depends on that.

import { GgxError } from "./errors.js";

export const GGX_MAGIC = "GGX1";
export const GGX_METRIC = "cosine";
export const GGX_QUANT = "int8-pervec";

/** Byte length of magic + headerLen, i.e. where the JSON header starts. */
export const GGX_PREFIX_LENGTH = 8;

export interface GgxHeader {
  /** Snapshot version, e.g. "2026-06-08". */
  version: string;
  /** Embedding model id, e.g. "intfloat/multilingual-e5-small". */
  model: string;
  /** Pinned HF commit sha of the embedding model (§6c parity). */
  modelRevision: string;
  /** Embedding dimensionality, e.g. 384. */
  dim: number;
  /** Number of indexed records. */
  count: number;
  metric: typeof GGX_METRIC;
  quant: typeof GGX_QUANT;
  /** Record counts per ISO-639-1 language code, e.g. { de: 41000 }. */
  langs: Record<string, number>;
}

export function encodeContainerPrefix(header: GgxHeader): Uint8Array {
  const sortedLangs: Record<string, number> = {};
  for (const lang of Object.keys(header.langs).sort()) {
    sortedLangs[lang] = header.langs[lang] as number;
  }
  const json = JSON.stringify({
    version: header.version,
    model: header.model,
    modelRevision: header.modelRevision,
    dim: header.dim,
    count: header.count,
    metric: header.metric,
    quant: header.quant,
    langs: sortedLangs,
  });
  const jsonBytes = new TextEncoder().encode(json);
  const out = new Uint8Array(GGX_PREFIX_LENGTH + jsonBytes.byteLength);
  for (let i = 0; i < GGX_MAGIC.length; i += 1) {
    out[i] = GGX_MAGIC.charCodeAt(i);
  }
  new DataView(out.buffer).setUint32(4, jsonBytes.byteLength, true);
  out.set(jsonBytes, GGX_PREFIX_LENGTH);
  return out;
}

export function hasGgxMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < GGX_MAGIC.length) {
    return false;
  }
  for (let i = 0; i < GGX_MAGIC.length; i += 1) {
    if (bytes[i] !== GGX_MAGIC.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function requireNonEmptyString(field: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GgxError("bad-header", `header field ${field} is invalid`);
  }
  return value;
}

function parseHeaderJson(json: string): GgxHeader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new GgxError("bad-header", "header is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new GgxError("bad-header", "header is not a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const { dim, count, metric, quant, langs } = record;
  const version = requireNonEmptyString("version", record["version"]);
  const model = requireNonEmptyString("model", record["model"]);
  const modelRevision = requireNonEmptyString(
    "modelRevision",
    record["modelRevision"],
  );
  if (!isCount(dim) || dim === 0) {
    throw new GgxError("bad-header", "header field dim is invalid");
  }
  if (!isCount(count)) {
    throw new GgxError("bad-header", "header field count is invalid");
  }
  // v1 readers only understand this exact layout; anything else is a
  // different (future) format, not a tolerable variation.
  if (metric !== GGX_METRIC) {
    throw new GgxError("bad-header", `header metric must be "${GGX_METRIC}"`);
  }
  if (quant !== GGX_QUANT) {
    throw new GgxError("bad-header", `header quant must be "${GGX_QUANT}"`);
  }
  if (typeof langs !== "object" || langs === null || Array.isArray(langs)) {
    throw new GgxError("bad-header", "header field langs is invalid");
  }
  const validatedLangs: Record<string, number> = {};
  for (const [lang, value] of Object.entries(langs)) {
    if (!isCount(value)) {
      throw new GgxError("bad-header", "header field langs is invalid");
    }
    validatedLangs[lang] = value;
  }
  return {
    version,
    model,
    modelRevision,
    dim,
    count,
    metric: GGX_METRIC,
    quant: GGX_QUANT,
    langs: validatedLangs,
  };
}

export function decodeContainerPrefix(bytes: Uint8Array): {
  header: GgxHeader;
  bodyOffset: number;
} {
  if (!hasGgxMagic(bytes)) {
    throw new GgxError(
      "bad-magic",
      `container does not start with ${GGX_MAGIC}`,
    );
  }
  if (bytes.byteLength < GGX_PREFIX_LENGTH) {
    throw new GgxError("truncated", "container ends inside the prefix");
  }
  const headerLen = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(4, true);
  const bodyOffset = GGX_PREFIX_LENGTH + headerLen;
  if (bytes.byteLength < bodyOffset) {
    throw new GgxError("truncated", "container ends inside the JSON header");
  }
  const json = new TextDecoder().decode(
    bytes.subarray(GGX_PREFIX_LENGTH, bodyOffset),
  );
  return { header: parseHeaderJson(json), bodyOffset };
}
