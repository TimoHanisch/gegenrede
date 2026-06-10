// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Per-vector symmetric int8 quantization (spec §5: "int8-pervec"). One f32
// scale per vector; dequantized value = int8 * scale. The range is the
// symmetric [-127, 127] (never -128) so that +maxAbs and -maxAbs quantize
// with the same precision.

import { GgxError } from "./errors.js";

export interface QuantizedVector {
  values: Int8Array;
  scale: number;
}

export function quantizeVector(vector: Float32Array): QuantizedVector {
  let maxAbs = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new GgxError("bad-input", "cannot quantize a non-finite vector");
    }
    const abs = Math.abs(value);
    if (abs > maxAbs) {
      maxAbs = abs;
    }
  }
  // The scale is rounded to f32 *before* quantizing because the container
  // stores it as f32 (§5) — quantizing against the stored precision keeps
  // write → read → re-write byte-stable.
  const scale = Math.fround(maxAbs / 127);
  const values = new Int8Array(vector.length);
  if (scale > 0) {
    let i = 0;
    for (const value of vector) {
      values[i] = Math.max(-127, Math.min(127, Math.round(value / scale)));
      i += 1;
    }
  }
  return { values, scale };
}

export function dequantizeVector(
  values: Int8Array,
  scale: number,
): Float32Array {
  const out = new Float32Array(values.length);
  let i = 0;
  for (const value of values) {
    out[i] = value * scale;
    i += 1;
  }
  return out;
}
