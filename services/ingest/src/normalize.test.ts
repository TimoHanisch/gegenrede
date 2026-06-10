// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { describe, expect, it } from "vitest";

import { dedupHash, factcheckId, normalizeRawFactCheck } from "./normalize.js";
import {
  FIXTURE_SOURCE,
  rawFactcheckFixture,
} from "./fixtures/raw-factchecks.js";

describe("factcheckId", () => {
  it("is sha256(publisher|url) truncated to 16 hex chars", () => {
    const id = factcheckId("Beispiel-Faktencheck", "https://example.org/a");
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    // Deterministic and sensitive to both inputs.
    expect(factcheckId("Beispiel-Faktencheck", "https://example.org/a")).toBe(
      id,
    );
    expect(
      factcheckId("Anderer-Faktencheck", "https://example.org/a"),
    ).not.toBe(id);
    expect(
      factcheckId("Beispiel-Faktencheck", "https://example.org/b"),
    ).not.toBe(id);
  });
});

describe("dedupHash", () => {
  it("lowercases the claim, so casing variants collide", () => {
    expect(dedupHash("Die Erde ist FLACH", "P")).toBe(
      dedupHash("die erde ist flach", "P"),
    );
    expect(dedupHash("die erde ist flach", "P")).not.toBe(
      dedupHash("die erde ist flach", "Q"),
    );
    expect(dedupHash("a", "P")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("normalizeRawFactCheck", () => {
  it("maps a raw record onto the canonical §9.2 column set", () => {
    const raw = rawFactcheckFixture[0]!;
    const warnings: string[] = [];
    const normalized = normalizeRawFactCheck(raw, FIXTURE_SOURCE, (m) =>
      warnings.push(m),
    );
    expect(normalized).toEqual({
      id: factcheckId(raw.publisher, raw.url),
      claimText: raw.claimText,
      verdict: "unproven", // VERDICT_MAP has no entries yet (see verdict-map.ts)
      ratingRaw: raw.ratingRaw,
      publisher: raw.publisher,
      url: raw.url,
      publishedAt: "2026-01-12",
      lang: "de",
      dedupHash: dedupHash(raw.claimText, raw.publisher),
      source: FIXTURE_SOURCE,
    });
  });

  it("falls back to unproven with a warning on unknown ratings (§4.1)", () => {
    const warnings: string[] = [];
    const normalized = normalizeRawFactCheck(
      rawFactcheckFixture[2]!,
      FIXTURE_SOURCE,
      (m) => warnings.push(m),
    );
    expect(normalized.verdict).toBe("unproven");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("unmapped publisher rating");
    // Hard Rule 5: the warning names the rating key, never the claim text.
    expect(warnings[0]).not.toContain("bicycles");
  });

  it("defaults publishedAt to null when absent", () => {
    const normalized = normalizeRawFactCheck(
      rawFactcheckFixture[2]!,
      FIXTURE_SOURCE,
      () => {},
    );
    expect(normalized.publishedAt).toBeNull();
  });

  it("rejects records that do not match the RawFactCheck contract", () => {
    expect(() =>
      normalizeRawFactCheck(
        { claimText: "x", ratingRaw: "y", publisher: "z", url: "not-a-url" },
        FIXTURE_SOURCE,
        () => {},
      ),
    ).toThrow();
  });
});
