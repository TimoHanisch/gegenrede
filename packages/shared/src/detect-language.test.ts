// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Spec §8 step 2 — hermetic: tinyld is pure JS with bundled profiles, no
// network. Fixture sentences are synthetic.

import { describe, expect, it } from "vitest";

import {
  LANGUAGE_CONFIDENCE_THRESHOLD,
  detectPostLanguage,
} from "./detect-language.js";

describe("detectPostLanguage", () => {
  it("detects clear German without falling back", () => {
    const result = detectPostLanguage(
      "Die Bundesregierung hat heute neue Maßnahmen zum Klimaschutz beschlossen.",
      "en",
    );
    expect(result.lang).toBe("de");
    expect(result.usedFallback).toBe(false);
    expect(result.confidence).toBeGreaterThanOrEqual(
      LANGUAGE_CONFIDENCE_THRESHOLD,
    );
  });

  it("detects clear English without falling back", () => {
    const result = detectPostLanguage(
      "The government announced new climate policies today in parliament.",
      "de",
    );
    expect(result.lang).toBe("en");
    expect(result.usedFallback).toBe(false);
  });

  it("falls back to the UI language below the confidence threshold", () => {
    // Nonsense trigrams: tinyld scores some language far below 0.7.
    const result = detectPostLanguage("xqz zqx qzx", "de");
    expect(result.lang).toBe("de");
    expect(result.usedFallback).toBe(true);
    expect(result.confidence).toBeLessThan(LANGUAGE_CONFIDENCE_THRESHOLD);
  });

  it("falls back with confidence 0 when nothing is detected", () => {
    const result = detectPostLanguage("", "de");
    expect(result).toEqual({ lang: "de", confidence: 0, usedFallback: true });
  });

  it("uses the caller-supplied UI language, not a hardcoded default", () => {
    expect(detectPostLanguage("", "en").lang).toBe("en");
  });
});
