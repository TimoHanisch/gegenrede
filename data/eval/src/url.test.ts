// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { describe, expect, it } from "vitest";

import { canonicalUrl } from "./url.js";

describe("canonicalUrl", () => {
  it("strips one trailing slash from a non-root path", () => {
    expect(canonicalUrl("https://factcheck.example.org/artikel/1/")).toBe(
      "https://factcheck.example.org/artikel/1",
    );
  });

  it("treats the root path as empty", () => {
    expect(canonicalUrl("https://factcheck.example.org/")).toBe(
      canonicalUrl("https://factcheck.example.org"),
    );
  });

  it("lowercases scheme and host but preserves path case", () => {
    expect(canonicalUrl("HTTPS://FactCheck.Example.ORG/Artikel/A")).toBe(
      "https://factcheck.example.org/Artikel/A",
    );
  });

  it("drops the fragment", () => {
    expect(canonicalUrl("https://factcheck.example.org/a#section")).toBe(
      "https://factcheck.example.org/a",
    );
  });

  it("keeps the query string", () => {
    expect(canonicalUrl("https://factcheck.example.org/a?id=2")).toBe(
      "https://factcheck.example.org/a?id=2",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(canonicalUrl("  https://factcheck.example.org/a ")).toBe(
      "https://factcheck.example.org/a",
    );
  });

  it("throws on unparseable input", () => {
    expect(() => canonicalUrl("not a url")).toThrow(TypeError);
  });
});
