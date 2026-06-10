// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Byte plumbing for the .ggx container (spec §5). Web-standard APIs only
// (CompressionStream, WebCrypto) so the package stays pure TS with no
// runtime dependencies (§3) and runs unchanged in Node and the extension.

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

// Web APIs (Blob, crypto.subtle) reject SharedArrayBuffer-backed views.
// Nothing in this package allocates one, but public entry points accept any
// Uint8Array, so re-back shared views before handing them over.
function asArrayBufferBacked(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    bytes.buffer instanceof SharedArrayBuffer
  ) {
    return new Uint8Array(bytes);
  }
  return bytes as Uint8Array<ArrayBuffer>;
}

async function pipeBytes(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([asArrayBufferBacked(bytes)])
    .stream()
    .pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeBytes(bytes, new CompressionStream("gzip"));
}

export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeBytes(bytes, new DecompressionStream("gzip"));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    asArrayBufferBacked(bytes),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
