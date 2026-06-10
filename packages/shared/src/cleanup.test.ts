// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Golden table-driven tests for spec §8 step 1. All fixture texts are
// synthetic — no real handles or post content (CLAUDE.md privacy rules).

import { describe, expect, it } from "vitest";

import { CLEANUP_MAX_TOKENS, cleanPostText } from "./cleanup.js";

interface GoldenCase {
  name: string;
  input: string;
  expected: string;
}

const GOLDEN_CASES: GoldenCase[] = [
  {
    name: "strips http URLs",
    input: "Lest selbst http://example.com/artikel?id=1 unglaublich",
    expected: "Lest selbst unglaublich",
  },
  {
    name: "strips https URLs",
    input: "Quelle: https://example.org/beweis.html dazu",
    expected: "Quelle: dazu",
  },
  {
    name: "strips bare www URLs",
    input: "Steht alles auf www.example.com/wahrheit nach",
    expected: "Steht alles auf nach",
  },
  {
    name: "strips @-handles",
    input: "Genau wie @beispielkonto schon sagte",
    expected: "Genau wie schon sagte",
  },
  {
    name: "strips fediverse-style @user@instance handles",
    input: "Laut @konto@instanz.example ist das so",
    expected: "Laut ist das so",
  },
  {
    name: "expands camel-case hashtags to words (spec example)",
    input: "#KlimaLüge",
    expected: "Klima Lüge",
  },
  {
    name: "keeps all-caps hashtags as one word",
    input: "Die #NATO war es",
    expected: "Die NATO war es",
  },
  {
    name: "splits leading all-caps runs from following words",
    input: "#COVIDIstEineLüge",
    expected: "COVID Ist Eine Lüge",
  },
  {
    name: "turns hashtag underscores into spaces",
    input: "#klima_lüge ist überall",
    expected: "klima lüge ist überall",
  },
  {
    name: "strips emoji",
    input: "Das ist doch 🤡 alles gelogen 😂😂",
    expected: "Das ist doch alles gelogen",
  },
  {
    name: "strips composed emoji (flags, skin tones, ZWJ sequences)",
    input: "Wacht auf 🇩🇪 Leute 👍🏼 wir 👨‍👩‍👧 wissen es",
    expected: "Wacht auf Leute wir wissen es",
  },
  {
    name: "collapses repeated punctuation",
    input: "Unglaublich!!! Wirklich??? Ja....",
    expected: "Unglaublich! Wirklich? Ja.",
  },
  {
    name: "collapses whitespace including newlines and tabs",
    input: "Erstens.\n\nZweitens.\t Drittens.",
    expected: "Erstens. Zweitens. Drittens.",
  },
  {
    name: "applies all transformations together",
    input:
      "Krass @irgendwer was die wieder verschweigen 🤡!!! #KlimaLüge https://example.com/x \n mehr dazu",
    expected: "Krass was die wieder verschweigen ! Klima Lüge mehr dazu",
  },
  {
    name: "returns empty string for emoji-only input",
    input: "🤡😂👍",
    expected: "",
  },
  {
    name: "returns empty string for empty input",
    input: "",
    expected: "",
  },
];

describe("cleanPostText", () => {
  it.each(GOLDEN_CASES)("$name", ({ input, expected }) => {
    expect(cleanPostText(input)).toBe(expected);
  });

  it("is idempotent on every golden case", () => {
    for (const { input } of GOLDEN_CASES) {
      const once = cleanPostText(input);
      expect(cleanPostText(once)).toBe(once);
    }
  });

  describe("truncation to CLEANUP_MAX_TOKENS whitespace tokens", () => {
    const word = "wort";

    it("keeps text at exactly the limit", () => {
      const input = Array.from({ length: CLEANUP_MAX_TOKENS }, () => word).join(
        " ",
      );
      expect(cleanPostText(input)).toBe(input);
    });

    it("cuts text one token over the limit", () => {
      const tokens = Array.from(
        { length: CLEANUP_MAX_TOKENS + 1 },
        (_, i) => `${word}${i}`,
      );
      const result = cleanPostText(tokens.join(" "));
      expect(result.split(" ")).toHaveLength(CLEANUP_MAX_TOKENS);
      expect(result.endsWith(`${word}${CLEANUP_MAX_TOKENS - 1}`)).toBe(true);
    });

    it("counts tokens after the other transformations", () => {
      const overlong = Array.from(
        { length: CLEANUP_MAX_TOKENS + 50 },
        () => word,
      ).join("  \n ");
      expect(cleanPostText(overlong).split(" ")).toHaveLength(
        CLEANUP_MAX_TOKENS,
      );
    });
  });
});
