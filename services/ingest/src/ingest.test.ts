// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Hermetic pipeline tests: fake embedding provider (no model, no network),
// in-memory store (no database) — CLAUDE.md Testing discipline.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EMBEDDING_DIM,
  initEmbedding,
  resetEmbedding,
} from "@gegenrede/shared";

import { ingestRawFactChecks } from "./ingest.js";
import { InMemoryFactcheckStore } from "./store.js";
import {
  FIXTURE_SOURCE,
  rawFactcheckFixture,
} from "./fixtures/raw-factchecks.js";

/** Deterministic non-zero vectors; records every prefixed text it sees. */
function fakeProvider(): {
  seen: string[];
  embed: (t: string) => Promise<Float32Array>;
} {
  const seen: string[] = [];
  return {
    seen,
    embed: (text: string) => {
      seen.push(text);
      const vector = new Float32Array(EMBEDDING_DIM);
      for (let i = 0; i < EMBEDDING_DIM; i += 1) {
        vector[i] = ((text.charCodeAt(i % text.length) % 13) + 1) / 13;
      }
      return Promise.resolve(vector);
    },
  };
}

describe("ingestRawFactChecks", () => {
  let provider: ReturnType<typeof fakeProvider>;
  let store: InMemoryFactcheckStore;

  beforeEach(() => {
    provider = fakeProvider();
    initEmbedding(provider);
    store = new InMemoryFactcheckStore();
  });

  afterEach(() => {
    resetEmbedding();
  });

  it("inserts new records and skips the dedup collision in the fixture", async () => {
    const counters = await ingestRawFactChecks(
      rawFactcheckFixture,
      FIXTURE_SOURCE,
      store,
      () => {},
    );
    // Fixture records 0 and 1 share claim text (modulo casing) + publisher
    // → same dedup_hash → the second one is skipped, never stored.
    expect(counters).toEqual({
      inserted: 2,
      updated: 0,
      skippedDedup: 1,
      invalid: 0,
    });
    expect(store.rows.size).toBe(2);
  });

  it("embeds every stored claim through embedText with the passage prefix (§6a)", async () => {
    await ingestRawFactChecks(
      rawFactcheckFixture,
      FIXTURE_SOURCE,
      store,
      () => {},
    );
    expect(provider.seen.length).toBeGreaterThan(0);
    for (const text of provider.seen) {
      expect(text.startsWith("passage: ")).toBe(true);
    }
    for (const row of store.rows.values()) {
      expect(row.embedding).toHaveLength(EMBEDDING_DIM);
    }
  });

  it("updates on re-ingest of the same publisher|url", async () => {
    const first = rawFactcheckFixture[0]!;
    await ingestRawFactChecks([first], FIXTURE_SOURCE, store, () => {});
    const counters = await ingestRawFactChecks(
      [{ ...first, ratingRaw: "Frei erfunden (aktualisiert)" }],
      FIXTURE_SOURCE,
      store,
      () => {},
    );
    expect(counters.updated).toBe(1);
    expect(store.rows.size).toBe(1);
    const row = [...store.rows.values()][0]!;
    expect(row.ratingRaw).toBe("Frei erfunden (aktualisiert)");
  });

  it("still ingests unknown-rating records as unproven, with a warning", async () => {
    const warnings: string[] = [];
    await ingestRawFactChecks(
      [rawFactcheckFixture[2]!],
      FIXTURE_SOURCE,
      store,
      (m) => warnings.push(m),
    );
    const row = [...store.rows.values()][0]!;
    expect(row.verdict).toBe("unproven");
    expect(warnings.some((m) => m.includes("unmapped publisher rating"))).toBe(
      true,
    );
  });

  it("counts invalid records without aborting the batch or logging bodies", async () => {
    const warnings: string[] = [];
    const counters = await ingestRawFactChecks(
      [{ secret: "Real Post Text" }, rawFactcheckFixture[0]!],
      FIXTURE_SOURCE,
      store,
      (m) => warnings.push(m),
    );
    expect(counters.invalid).toBe(1);
    expect(counters.inserted).toBe(1);
    // Hard Rule 5: validation warnings reference the index, never content.
    expect(warnings.join("\n")).not.toContain("Real Post Text");
  });
});
