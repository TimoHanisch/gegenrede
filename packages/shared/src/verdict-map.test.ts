// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { describe, expect, it, vi } from "vitest";

import { VERDICT_MAP, mapVerdict, verdictMapKey } from "./verdict-map.js";

describe("verdictMapKey", () => {
  it("builds lowercased publisher:rating keys", () => {
    expect(verdictMapKey("Correctiv", "Falsch")).toBe("correctiv:falsch");
  });
});

describe("mapVerdict", () => {
  it("returns the mapped verdict for a known key without warning", () => {
    const warn = vi.fn();
    VERDICT_MAP["test publisher:test rating"] = "satire";
    try {
      expect(mapVerdict("Test Publisher", "Test Rating", warn)).toBe("satire");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      delete VERDICT_MAP["test publisher:test rating"];
    }
  });

  it("falls back to unproven for an unknown rating and warns once (§4.1)", () => {
    const warn = vi.fn();
    expect(mapVerdict("Unknown Publisher", "Four Pinocchios", warn)).toBe(
      "unproven",
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown publisher:four pinocchios"),
    );
  });

  it("never guesses toward false: fallback is unproven, not false", () => {
    expect(mapVerdict("Unknown Publisher", "Totally False!!", vi.fn())).toBe(
      "unproven",
    );
  });

  it("maps EUvsDisinfo ratings to false/misleading only (§9.3)", () => {
    const warn = vi.fn();
    expect(mapVerdict("EUvsDisinfo", "disinfo", warn)).toBe("false");
    expect(mapVerdict("EUvsDisinfo", "Misleading", warn)).toBe("misleading");
    expect(warn).not.toHaveBeenCalled();
    // Anything outside their schema still takes the §4.1 fallback.
    expect(mapVerdict("EUvsDisinfo", "unexpected rating", vi.fn())).toBe(
      "unproven",
    );
  });
});
