// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Golden schema + loader tests. Fixture lines are synthetic — invented
// claims and example.org URLs only.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EvalError } from "./errors.js";
import { loadGoldenFile, parseGoldenLine } from "./golden.js";

const POSITIVE = JSON.stringify({
  claim: "Die fiktive Stadt Beispielhausen hat alle Autos verboten.",
  expectedUrl: "https://factcheck.example.org/artikel/1",
  lang: "de",
});

const NEGATIVE = JSON.stringify({
  claim: "An invented club presented a fictitious new logo.",
  expectedUrl: null,
  lang: "en",
});

function expectBadGolden(run: () => unknown, fragment: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EvalError);
    expect((error as EvalError).code).toBe("bad-golden");
    expect((error as EvalError).message).toContain(fragment);
    return;
  }
  throw new Error("expected an EvalError with code bad-golden");
}

describe("golden item schema", () => {
  it("accepts a positive with file:line provenance", () => {
    const item = parseGoldenLine(POSITIVE, "golden-de.jsonl", 3);
    expect(item).toMatchObject({
      expectedUrl: "https://factcheck.example.org/artikel/1",
      lang: "de",
      file: "golden-de.jsonl",
      line: 3,
    });
  });

  it("accepts an out-of-index negative (expectedUrl null)", () => {
    expect(parseGoldenLine(NEGATIVE, "f", 1).expectedUrl).toBeNull();
  });

  it("rejects a missing expectedUrl — null must be explicit", () => {
    const line = JSON.stringify({ claim: "Erfundene Behauptung.", lang: "de" });
    expectBadGolden(() => parseGoldenLine(line, "f", 7), "f:7");
  });

  it("rejects an unknown key (curation typo)", () => {
    const line = JSON.stringify({
      claim: "Erfundene Behauptung.",
      expectedUrl: null,
      lang: "de",
      expectedURL: "https://factcheck.example.org/x",
    });
    expectBadGolden(() => parseGoldenLine(line, "f", 2), "f:2");
  });

  it("rejects an unsupported language", () => {
    const line = JSON.stringify({
      claim: "Une affirmation inventée.",
      expectedUrl: null,
      lang: "fr",
    });
    expectBadGolden(() => parseGoldenLine(line, "f", 1), 'at "lang"');
  });

  it("rejects a non-URL expectedUrl", () => {
    const line = JSON.stringify({
      claim: "Erfundene Behauptung.",
      expectedUrl: "not a url",
      lang: "de",
    });
    expectBadGolden(() => parseGoldenLine(line, "f", 4), 'at "expectedUrl"');
  });

  it("rejects a blank claim", () => {
    const line = JSON.stringify({ claim: "  ", expectedUrl: null, lang: "de" });
    expectBadGolden(() => parseGoldenLine(line, "f", 1), 'at "claim"');
  });

  it("rejects a line that is not JSON", () => {
    expectBadGolden(
      () => parseGoldenLine("{nope", "f", 9),
      "f:9 is not valid JSON",
    );
  });
});

describe("golden file loader", () => {
  async function write(content: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "gegenrede-golden-"));
    const file = path.join(dir, "fixture.jsonl");
    await writeFile(file, content);
    return file;
  }

  it("loads items in file order with line numbers", async () => {
    const file = await write(`${POSITIVE}\n${NEGATIVE}\n`);
    const items = await loadGoldenFile(file);
    expect(items.map((item) => item.line)).toEqual([1, 2]);
    expect(items.map((item) => item.lang)).toEqual(["de", "en"]);
  });

  it("tolerates CRLF endings and a missing trailing newline", async () => {
    const file = await write(`${POSITIVE}\r\n${NEGATIVE}`);
    const items = await loadGoldenFile(file);
    expect(items).toHaveLength(2);
    expect(items[0]?.lang).toBe("de");
  });

  it("returns [] for an empty file", async () => {
    expect(await loadGoldenFile(await write(""))).toEqual([]);
    expect(await loadGoldenFile(await write("\n"))).toEqual([]);
  });

  it("rejects an interior blank line instead of skipping it", async () => {
    const file = await write(`${POSITIVE}\n\n${NEGATIVE}\n`);
    await expect(loadGoldenFile(file)).rejects.toThrow(/:2 is a blank line/);
  });

  it("aborts on the first invalid line with file:line", async () => {
    const file = await write(`${POSITIVE}\n{broken\n`);
    await expect(loadGoldenFile(file)).rejects.toThrow(/:2 is not valid JSON/);
  });
});
