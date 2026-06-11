// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Harvester tests (issue #15). Hermetic: the Google connector is replaced
// by a fake at the Connector seam — no network, no API key. All records are
// synthetic (invented claims, example.org URLs).

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Connector, RawFactCheck } from "@gegenrede/ingest";

import {
  CandidateItem,
  harvestMain,
  parseHarvestArgs,
  runHarvest,
  type HarvestConfig,
} from "./harvest.js";
import { EvalError } from "./errors.js";

let uniqueCounter = 0;

function record(overrides: Partial<RawFactCheck> = {}): RawFactCheck {
  uniqueCounter += 1;
  return {
    claimText: `Erfundene Behauptung Nummer ${uniqueCounter} über ein fiktives Ereignis.`,
    ratingRaw: "Falsch",
    publisher: "Beispiel-Faktencheck",
    url: `https://factcheck.example.org/artikel/${uniqueCounter}`,
    publishedAt: "2026-05-01",
    lang: "de",
    ...overrides,
  };
}

function fakeConnector(records: RawFactCheck[]): Connector {
  return { id: "fake", fetchSince: () => Promise.resolve(records) };
}

async function tempOut(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "gegenrede-harvest-"));
  return path.join(dir, "candidates-de.jsonl");
}

function config(overrides: Partial<HarvestConfig> = {}): HarvestConfig {
  return {
    lang: "de",
    since: new Date("2026-01-01T00:00:00.000Z"),
    sites: [],
    out: "unset.jsonl",
    force: false,
    ...overrides,
  };
}

async function readCandidates(file: string): Promise<CandidateItem[]> {
  const text = await readFile(file, "utf8");
  return text
    .slice(0, -1)
    .split("\n")
    .map((line) => CandidateItem.parse(JSON.parse(line)));
}

describe("parseHarvestArgs", () => {
  it("applies defaults and builds the per-language staging path", () => {
    const parsed = parseHarvestArgs(["--lang", "de", "--since", "2026-01-01"]);
    expect(parsed.lang).toBe("de");
    expect(parsed.since.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.sites).toEqual([]);
    expect(parsed.force).toBe(false);
    expect(parsed.out.endsWith("candidates-de.jsonl")).toBe(true);
  });

  it("collects repeated --site flags", () => {
    const parsed = parseHarvestArgs([
      "--lang",
      "en",
      "--since",
      "2026-01-01",
      "--site",
      "a.example",
      "--site",
      "b.example",
    ]);
    expect(parsed.sites).toEqual(["a.example", "b.example"]);
  });

  it.each([
    [["--since", "2026-01-01"], "missing --lang"],
    [["--lang", "fr", "--since", "2026-01-01"], "unsupported --lang"],
    [["--lang", "de"], "missing --since"],
    [["--lang", "de", "--since", "01.06.2026"], "non-ISO --since"],
    [["--lang", "de", "--since", "2026-13-45"], "impossible --since"],
    [["--lang", "de", "--since", "2026-01-01", "--bogus"], "unknown flag"],
  ])("rejects %j (%s)", (argv) => {
    try {
      parseHarvestArgs(argv as string[]);
    } catch (error) {
      expect(error).toBeInstanceOf(EvalError);
      expect((error as EvalError).code).toBe("usage");
      return;
    }
    throw new Error("expected an EvalError with code usage");
  });
});

describe("runHarvest", () => {
  it("writes candidates newest-first with the helper fields", async () => {
    const out = await tempOut();
    const older = record({ publishedAt: "2026-04-01" });
    const newer = record({ publishedAt: "2026-05-20" });
    const outcome = await runHarvest(config({ out }), {
      connector: fakeConnector([older, newer]),
      goldenFiles: [],
    });
    expect(outcome).toEqual({
      written: 2,
      skippedCurated: 0,
      skippedOtherLang: 0,
    });
    const candidates = await readCandidates(out);
    expect(candidates.map((c) => c.publishedAt)).toEqual([
      "2026-05-20",
      "2026-04-01",
    ]);
    expect(candidates[0]).toMatchObject({
      claim: newer.claimText,
      expectedUrl: newer.url,
      lang: "de",
      source: newer.publisher,
      rating: newer.ratingRaw,
    });
  });

  it("skips records in another language than the pull", async () => {
    const out = await tempOut();
    const outcome = await runHarvest(config({ out }), {
      connector: fakeConnector([record(), record({ lang: "en" })]),
      goldenFiles: [],
    });
    expect(outcome.written).toBe(1);
    expect(outcome.skippedOtherLang).toBe(1);
  });

  it("skips URLs already curated, compared canonically", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gegenrede-harvest-"));
    const golden = path.join(dir, "golden-de.jsonl");
    const curated = record();
    await writeFile(
      golden,
      `${JSON.stringify({
        claim: "Bereits kuratierte erfundene Behauptung.",
        // Trailing slash on purpose — canonical comparison must still match.
        expectedUrl: `${curated.url}/`,
        lang: "de",
        source: "factcheck.example.org",
      })}\n`,
    );
    const out = path.join(dir, "candidates-de.jsonl");
    const outcome = await runHarvest(config({ out }), {
      connector: fakeConnector([curated, record()]),
      goldenFiles: [golden],
    });
    expect(outcome.written).toBe(1);
    expect(outcome.skippedCurated).toBe(1);
  });

  it("refuses to overwrite an existing staging file without --force", async () => {
    const out = await tempOut();
    await writeFile(out, "reviewed work in progress\n");
    await expect(
      runHarvest(config({ out }), {
        connector: fakeConnector([record()]),
        goldenFiles: [],
      }),
    ).rejects.toMatchObject({ code: "harvest" });

    const outcome = await runHarvest(config({ out, force: true }), {
      connector: fakeConnector([record()]),
      goldenFiles: [],
    });
    expect(outcome.written).toBe(1);
  });

  it("writes no file when nothing was harvested", async () => {
    const out = await tempOut();
    const outcome = await runHarvest(config({ out }), {
      connector: fakeConnector([]),
      goldenFiles: [],
    });
    expect(outcome.written).toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it("candidates are NOT golden-valid — promotion must edit the line", async () => {
    const out = await tempOut();
    await runHarvest(config({ out }), {
      connector: fakeConnector([record()]),
      goldenFiles: [],
    });
    const [candidate] = await readCandidates(out);
    const { GoldenItem } = await import("./golden.js");
    expect(GoldenItem.safeParse(candidate).success).toBe(false);
  });
});

describe("harvestMain", () => {
  it("prints usage and exits 1 on bad arguments", async () => {
    const lines: string[] = [];
    const code = await harvestMain([], { log: (line) => lines.push(line) });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("Usage: pnpm harvest");
  });

  it("exits 0 and logs counts only — never claim text or URLs", async () => {
    const out = await tempOut();
    const noisy = record({
      claimText: "Höchst erfundene Behauptung, die nie geloggt werden darf.",
    });
    const lines: string[] = [];
    const code = await harvestMain(
      ["--lang", "de", "--since", "2026-01-01", "--out", out],
      {
        connector: fakeConnector([noisy, record()]),
        goldenFiles: [],
        log: (line) => lines.push(line),
      },
    );
    expect(code).toBe(0);
    const output = lines.join("\n");
    expect(output).toContain("harvested 2 de candidate(s)");
    expect(output).toContain("never commit candidates");
    expect(output).not.toContain(noisy.claimText);
    expect(output).not.toContain("factcheck.example.org");
  });
});
