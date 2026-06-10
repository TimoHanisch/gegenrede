// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { describe, expect, it } from "vitest";

import { CheckResult, ExtractedPost, FactCheckMatch } from "./core-types.js";
import { Technique, Verdict } from "./taxonomies.js";

const validPost = {
  text: "Example claim text long enough to pass.",
  url: "https://example.com/post/1",
  platform: "x",
} as const;

const validMatch = {
  id: "fc-1",
  claim: "Example claim",
  verdict: "false",
  ratingRaw: "Falsch",
  publisher: "Example Publisher",
  url: "https://example.com/factcheck/1",
  publishedAt: "2026-01-15",
  lang: "de",
  score: 0.87,
} as const;

const validResult = {
  normalizedClaim: "Example claim",
  matches: [validMatch],
  techniqueHints: ["scapegoating"],
  matcher: "local",
  snapshotVersion: "2026-06-08",
} as const;

describe("Verdict", () => {
  it("accepts the seven canonical verdicts", () => {
    for (const v of [
      "false",
      "mostly_false",
      "misleading",
      "unproven",
      "mostly_true",
      "true",
      "satire",
    ]) {
      expect(Verdict.parse(v)).toBe(v);
    }
  });

  it("rejects values outside the taxonomy", () => {
    expect(() => Verdict.parse("pants-fire")).toThrow();
  });
});

describe("Technique", () => {
  it("accepts the eight specced techniques", () => {
    for (const t of [
      "scapegoating",
      "decontextualization",
      "discrediting",
      "fake_experts",
      "emotional_manipulation",
      "polarization",
      "conspiracy_framing",
      "impersonation",
    ]) {
      expect(Technique.parse(t)).toBe(t);
    }
  });

  it("rejects values outside the taxonomy", () => {
    expect(() => Technique.parse("whataboutism")).toThrow();
  });
});

describe("ExtractedPost", () => {
  it("accepts a valid post, with lang and authorHandle optional", () => {
    expect(ExtractedPost.parse(validPost)).toEqual(validPost);
    expect(
      ExtractedPost.parse({
        ...validPost,
        lang: "de",
        authorHandle: "@someone",
      }).authorHandle,
    ).toBe("@someone");
  });

  it("enforces text bounds of 8 to 8000 characters", () => {
    expect(() =>
      ExtractedPost.parse({ ...validPost, text: "short" }),
    ).toThrow();
    expect(() =>
      ExtractedPost.parse({ ...validPost, text: "a".repeat(8001) }),
    ).toThrow();
    expect(
      ExtractedPost.parse({ ...validPost, text: "a".repeat(8000) }).text,
    ).toHaveLength(8000);
  });

  it("rejects invalid urls, platforms, and lang codes", () => {
    expect(() =>
      ExtractedPost.parse({ ...validPost, url: "not a url" }),
    ).toThrow();
    expect(() =>
      ExtractedPost.parse({ ...validPost, platform: "facebook" }),
    ).toThrow();
    expect(() => ExtractedPost.parse({ ...validPost, lang: "deu" })).toThrow();
  });
});

describe("FactCheckMatch", () => {
  it("accepts a valid match", () => {
    expect(FactCheckMatch.parse(validMatch)).toEqual(validMatch);
  });

  it("bounds score to [0, 1]", () => {
    expect(() =>
      FactCheckMatch.parse({ ...validMatch, score: -0.1 }),
    ).toThrow();
    expect(() => FactCheckMatch.parse({ ...validMatch, score: 1.1 })).toThrow();
  });

  it("requires an ISO date string for publishedAt", () => {
    expect(() =>
      FactCheckMatch.parse({ ...validMatch, publishedAt: "15.01.2026" }),
    ).toThrow();
  });
});

describe("CheckResult", () => {
  it("accepts a valid result", () => {
    expect(CheckResult.parse(validResult)).toEqual(validResult);
  });

  it("caps matches at 5 and techniqueHints at 3", () => {
    expect(() =>
      CheckResult.parse({ ...validResult, matches: Array(6).fill(validMatch) }),
    ).toThrow();
    expect(() =>
      CheckResult.parse({
        ...validResult,
        techniqueHints: [
          "scapegoating",
          "polarization",
          "discrediting",
          "fake_experts",
        ],
      }),
    ).toThrow();
  });

  it("rejects matcher values outside local/server", () => {
    expect(() =>
      CheckResult.parse({ ...validResult, matcher: "remote" }),
    ).toThrow();
  });
});
