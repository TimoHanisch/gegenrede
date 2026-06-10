// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { afterEach, describe, expect, it } from "vitest";

import {
  EMBEDDING_DIM,
  embedText,
  initEmbedding,
  l2Normalize,
  resetEmbedding,
  type EmbeddingProvider,
} from "./embedding.js";

function recordingProvider(
  vector: Float32Array = new Float32Array(EMBEDDING_DIM).fill(3),
): EmbeddingProvider & { received: string[] } {
  const received: string[] = [];
  return {
    received,
    embed(prefixedText: string): Promise<Float32Array> {
      received.push(prefixedText);
      return Promise.resolve(vector);
    },
  };
}

function norm(vector: Float32Array): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

afterEach(() => {
  resetEmbedding();
});

describe("embedText prefix discipline (spec §6a)", () => {
  it('prepends "query: " for kind "query"', async () => {
    const provider = recordingProvider();
    initEmbedding(provider);
    await embedText("query", "Die Erde ist flach");
    expect(provider.received).toEqual(["query: Die Erde ist flach"]);
  });

  it('prepends "passage: " for kind "passage"', async () => {
    const provider = recordingProvider();
    initEmbedding(provider);
    await embedText("passage", "Die Erde ist flach");
    expect(provider.received).toEqual(["passage: Die Erde ist flach"]);
  });

  it("treats input as raw content — call sites cannot construct prefixes", async () => {
    const provider = recordingProvider();
    initEmbedding(provider);
    await embedText("passage", "query: trick");
    expect(provider.received).toEqual(["passage: query: trick"]);
  });

  it("rejects empty and whitespace-only text", async () => {
    initEmbedding(recordingProvider());
    await expect(embedText("query", "")).rejects.toThrow(/empty text/);
    await expect(embedText("query", "  \n ")).rejects.toThrow(/empty text/);
  });

  it("throws if no provider was registered", async () => {
    await expect(embedText("query", "x")).rejects.toThrow(/initEmbedding/);
  });
});

describe("embedText output invariants (spec §6b)", () => {
  it("L2-normalizes provider output to unit norm", async () => {
    initEmbedding(recordingProvider());
    const result = await embedText("query", "x");
    expect(result.length).toBe(EMBEDDING_DIM);
    expect(norm(result)).toBeCloseTo(1, 6);
  });

  it("rejects vectors with the wrong dimensionality", async () => {
    initEmbedding(recordingProvider(new Float32Array(7).fill(1)));
    await expect(embedText("query", "x")).rejects.toThrow(
      /7 dimensions, expected 384/,
    );
  });

  it("rejects zero vectors instead of returning NaN", async () => {
    initEmbedding(recordingProvider(new Float32Array(EMBEDDING_DIM)));
    await expect(embedText("query", "x")).rejects.toThrow(/zero or non-finite/);
  });
});

describe("l2Normalize", () => {
  it("returns a unit-norm copy without mutating the input", () => {
    const input = new Float32Array([3, 4]);
    const result = l2Normalize(input);
    expect(Array.from(input)).toEqual([3, 4]);
    expect(result[0]).toBeCloseTo(0.6, 6);
    expect(result[1]).toBeCloseTo(0.8, 6);
    expect(norm(result)).toBeCloseTo(1, 6);
  });
});
