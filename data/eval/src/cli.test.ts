// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// CLI tests. The end-to-end smoke runs against a synthetic golden set and
// snapshot in a temp directory with an injected fake provider — hermetic,
// no model, no network. All data synthetic.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resetEmbedding } from "@gegenrede/shared";

import {
  main,
  parseCliArgs,
  type CliConfig,
  type EvalCliConfig,
} from "./cli.js";
import { EvalError } from "./errors.js";
import type { EvalReport } from "./report.js";
import {
  basisVector,
  buildSyntheticSnapshot,
  fakeProvider,
} from "./test-fixtures.js";

function expectUsage(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EvalError);
    expect((error as EvalError).code).toBe("usage");
    return;
  }
  throw new Error("expected an EvalError with code usage");
}

function asEvalConfig(config: CliConfig): EvalCliConfig {
  if (config.mode !== "eval") {
    throw new Error("expected an eval-mode config");
  }
  return config;
}

describe("parseCliArgs", () => {
  it("applies the spec defaults", () => {
    const config = asEvalConfig(parseCliArgs(["--snapshot", "snap.ggx"]));
    expect(config.snapshotPath).toBe("snap.ggx");
    expect(config.threshold).toBe(0.82);
    expect(config.topK).toBe(5);
    expect(config.goldenPaths).toEqual([]);
    expect(config.sha256).toBeUndefined();
    expect(config.outDir.endsWith("reports")).toBe(true);
  });

  it("collects repeated --golden flags", () => {
    const config = parseCliArgs([
      "--snapshot",
      "snap.ggx",
      "--golden",
      "a.jsonl",
      "--golden",
      "b.jsonl",
    ]);
    expect(config.goldenPaths).toEqual(["a.jsonl", "b.jsonl"]);
  });

  it("requires --snapshot", () => {
    expectUsage(() => parseCliArgs([]));
  });

  it("parses --validate with optional --golden", () => {
    expect(parseCliArgs(["--validate"])).toEqual({
      mode: "validate",
      goldenPaths: [],
    });
    expect(parseCliArgs(["--validate", "--golden", "a.jsonl"])).toEqual({
      mode: "validate",
      goldenPaths: ["a.jsonl"],
    });
  });

  it("rejects eval-only flags combined with --validate", () => {
    expectUsage(() => parseCliArgs(["--validate", "--snapshot", "s.ggx"]));
    expectUsage(() => parseCliArgs(["--validate", "--threshold", "0.9"]));
    expectUsage(() => parseCliArgs(["--validate", "--out", "reports"]));
  });

  it("rejects a threshold outside [0, 1] or non-numeric", () => {
    expectUsage(() =>
      parseCliArgs(["--snapshot", "s.ggx", "--threshold", "1.5"]),
    );
    expectUsage(() =>
      parseCliArgs(["--snapshot", "s.ggx", "--threshold", "abc"]),
    );
  });

  it("rejects a non-integer or zero top-k", () => {
    expectUsage(() => parseCliArgs(["--snapshot", "s.ggx", "--top-k", "0"]));
    expectUsage(() => parseCliArgs(["--snapshot", "s.ggx", "--top-k", "2.5"]));
  });

  it("rejects unknown flags", () => {
    expectUsage(() => parseCliArgs(["--snapshot", "s.ggx", "--bogus"]));
  });
});

describe("main", () => {
  afterEach(() => {
    resetEmbedding();
  });

  it("prints usage and exits 1 on bad arguments", async () => {
    const lines: string[] = [];
    const code = await main([], { log: (line) => lines.push(line) });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("--snapshot <path.ggx> is required");
    expect(lines.join("\n")).toContain("Usage: pnpm eval");
  });

  it("exits 1 when the golden set has zero items, pointing at #15", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gegenrede-eval-"));
    const golden = path.join(dir, "empty.jsonl");
    await writeFile(golden, "");
    const lines: string[] = [];
    const code = await main(
      ["--snapshot", "irrelevant.ggx", "--golden", golden],
      { log: (line) => lines.push(line) },
    );
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("#15");
  });

  it("exits 1 with a readable error for a missing snapshot file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gegenrede-eval-"));
    const golden = path.join(dir, "golden.jsonl");
    await writeFile(
      golden,
      `${JSON.stringify({ claim: "Erfundene Behauptung.", expectedUrl: null, lang: "de" })}\n`,
    );
    const lines: string[] = [];
    const code = await main(
      ["--snapshot", path.join(dir, "does-not-exist.ggx"), "--golden", golden],
      { log: (line) => lines.push(line) },
    );
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("does-not-exist.ggx");
  });

  it("runs end to end and writes both report artifacts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gegenrede-eval-"));
    const urlHit = "https://factcheck.example.org/artikel/treffer";

    const { bytes, sha256 } = await buildSyntheticSnapshot([
      { url: urlHit, lang: "de", vector: basisVector(0) },
      {
        url: "https://factcheck.example.org/artikel/anders",
        lang: "en",
        vector: basisVector(1),
      },
    ]);
    const snapshotPath = path.join(dir, "test.ggx");
    await writeFile(snapshotPath, bytes);

    const claimHit = "Erfundene Behauptung mit Treffer.";
    const claimNeg = "Invented claim with no counterpart.";
    const golden = path.join(dir, "golden.jsonl");
    await writeFile(
      golden,
      [
        JSON.stringify({ claim: claimHit, expectedUrl: urlHit, lang: "de" }),
        JSON.stringify({ claim: claimNeg, expectedUrl: null, lang: "en" }),
      ].join("\n") + "\n",
    );

    const provider = fakeProvider(
      new Map([
        [`query: ${claimHit}`, basisVector(0)],
        [`query: ${claimNeg}`, basisVector(50)],
      ]),
    );
    const outDir = path.join(dir, "reports");
    const lines: string[] = [];
    const code = await main(
      [
        "--snapshot",
        snapshotPath,
        "--golden",
        golden,
        "--sha256",
        sha256,
        "--out",
        outDir,
      ],
      {
        provider,
        now: () => new Date("2026-06-11T10:20:30.000Z"),
        log: (line) => lines.push(line),
      },
    );
    expect(code).toBe(0);

    const base = path.join(outDir, "eval-2026-06-08-2026-06-11T10-20-30Z");
    const report = JSON.parse(
      await readFile(`${base}.json`, "utf8"),
    ) as EvalReport;
    expect(report.snapshot.version).toBe("2026-06-08");
    expect(report.snapshot.count).toBe(2);
    expect(report.snapshot.sha256Source).toBe("cli-flag");
    expect(report.golden).toMatchObject({ positives: 1, negatives: 1 });
    expect(report.metrics.overall).toMatchObject({
      recallAtK: 1,
      recallAtKAtThreshold: 1,
      falseMatchRate: 0,
    });

    const markdown = await readFile(`${base}.md`, "utf8");
    expect(markdown).toContain("# Eval report — snapshot 2026-06-08");
    expect(lines.join("\n")).toContain("recall@5: 1.000 raw");
  });

  it("self-computes the sha256 when --sha256 is absent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gegenrede-eval-"));
    const urlHit = "https://factcheck.example.org/artikel/solo";
    const { bytes } = await buildSyntheticSnapshot([
      { url: urlHit, lang: "de", vector: basisVector(0) },
    ]);
    const snapshotPath = path.join(dir, "test.ggx");
    await writeFile(snapshotPath, bytes);

    const claim = "Erfundene Einzelbehauptung.";
    const golden = path.join(dir, "golden.jsonl");
    await writeFile(
      golden,
      `${JSON.stringify({ claim, expectedUrl: urlHit, lang: "de" })}\n`,
    );

    const outDir = path.join(dir, "reports");
    const code = await main(
      ["--snapshot", snapshotPath, "--golden", golden, "--out", outDir],
      {
        provider: fakeProvider(new Map([[`query: ${claim}`, basisVector(0)]])),
        now: () => new Date("2026-06-11T11:00:00.000Z"),
        log: () => {},
      },
    );
    expect(code).toBe(0);

    const report = JSON.parse(
      await readFile(
        path.join(outDir, "eval-2026-06-08-2026-06-11T11-00-00Z.json"),
        "utf8",
      ),
    ) as EvalReport;
    expect(report.snapshot.sha256Source).toBe("self-computed");
    expect(report.snapshot.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("--validate exits 0 on a well-formed golden file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gegenrede-eval-"));
    const golden = path.join(dir, "golden.jsonl");
    await writeFile(
      golden,
      [
        JSON.stringify({
          claim: "Die fiktive Stadt Beispielhausen hat alle Autos verboten.",
          expectedUrl: "https://factcheck.example.org/artikel/1",
          lang: "de",
          source: "factcheck.example.org",
        }),
        JSON.stringify({
          claim: "An invented club presented a fictitious new logo.",
          expectedUrl: null,
          lang: "en",
          source: "factcheck.example.org",
        }),
      ].join("\n") + "\n",
    );
    const lines: string[] = [];
    const code = await main(["--validate", "--golden", golden], {
      log: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    const output = lines.join("\n");
    expect(output).toContain("validation passed");
    expect(output).toContain("factcheck.example.org ×2");
  });

  it("--validate exits 1 and lists every problem in a broken file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gegenrede-eval-"));
    const golden = path.join(dir, "golden.jsonl");
    await writeFile(
      golden,
      [
        "{broken",
        JSON.stringify({
          claim: "Erfundene Behauptung ohne Quelle.",
          expectedUrl: null,
          lang: "de",
        }),
      ].join("\n") + "\n",
    );
    const lines: string[] = [];
    const code = await main(["--validate", "--golden", golden], {
      log: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    const output = lines.join("\n");
    expect(output).toContain(`${golden}:1 is not valid JSON`);
    expect(output).toContain(`${golden}:2 is missing "source"`);
    expect(output).toContain("validation FAILED — 2 error(s)");
  });

  it("--validate exits 1 on an empty golden set, pointing at #15", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gegenrede-eval-"));
    const golden = path.join(dir, "empty.jsonl");
    await writeFile(golden, "");
    const lines: string[] = [];
    const code = await main(["--validate", "--golden", golden], {
      log: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("#15");
  });
});
