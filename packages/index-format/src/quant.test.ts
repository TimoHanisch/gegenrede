// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { describe, expect, it } from "vitest";

import { GgxError } from "./errors.js";
import { dequantizeVector, quantizeVector } from "./quant.js";

describe("quantizeVector", () => {
  it("round-trips within one quantization step", () => {
    const vector = new Float32Array([0.5, -0.25, 0.125, -1, 0.99, 0.000001]);
    const { values, scale } = quantizeVector(vector);
    const restored = dequantizeVector(values, scale);
    const step = scale; // one int8 step == scale
    for (let i = 0; i < vector.length; i += 1) {
      expect(
        Math.abs((restored[i] as number) - (vector[i] as number)),
      ).toBeLessThanOrEqual(step / 2 + 1e-7);
    }
  });

  it("maps the largest magnitude to ±127, never -128", () => {
    const { values } = quantizeVector(new Float32Array([-0.8, 0.4, 0.8]));
    expect(Math.min(...values)).toBe(-127);
    expect(Math.max(...values)).toBe(127);
  });

  it("quantizes the zero vector to all zeros with scale 0", () => {
    const { values, scale } = quantizeVector(new Float32Array(4));
    expect(scale).toBe(0);
    expect([...values]).toEqual([0, 0, 0, 0]);
    expect([...dequantizeVector(values, scale)]).toEqual([0, 0, 0, 0]);
  });

  it("stores the scale at f32 precision", () => {
    const { scale } = quantizeVector(new Float32Array([0.123456789, -0.5]));
    expect(scale).toBe(Math.fround(scale));
  });

  it("rejects non-finite vectors", () => {
    expect(() =>
      quantizeVector(new Float32Array([0.1, Number.NaN])),
    ).toThrowError(GgxError);
    expect(() =>
      quantizeVector(new Float32Array([Number.POSITIVE_INFINITY])),
    ).toThrowError(/non-finite/);
  });
});
