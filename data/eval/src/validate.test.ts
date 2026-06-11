// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Validator tests (issue #15). All fixture lines are synthetic — invented
// claims, example.org URLs, invented handles — and live inline here, never
// in committed golden-*.jsonl files (CLAUDE.md Testing discipline).

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  renderValidationReport,
  validateGoldenFiles,
  type ValidationResult,
} from "./validate.js";

let uniqueCounter = 0;

/** One synthetic, valid golden line; fields can be overridden per test. */
function goldenLine(overrides: Record<string, unknown> = {}): string {
  uniqueCounter += 1;
  return JSON.stringify({
    claim: `Erfundene Behauptung Nummer ${uniqueCounter} über ein fiktives Ereignis.`,
    expectedUrl: null,
    lang: "de",
    source: "factcheck.example.org",
    ...overrides,
  });
}

async function writeGolden(lines: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "gegenrede-validate-"));
  const file = path.join(dir, "golden.jsonl");
  await writeFile(file, `${lines.join("\n")}\n`);
  return file;
}

function problems(issues: ValidationResult["errors"]): string[] {
  return issues.map((issue) => issue.problem);
}

describe("validateGoldenFiles", () => {
  it("collects every problem instead of aborting on the first", async () => {
    const file = await writeGolden([
      "{broken",
      goldenLine(),
      JSON.stringify({ claim: "Erfundene Behauptung.", lang: "de" }),
    ]);
    const result = await validateGoldenFiles([file]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((issue) => issue.line)).toEqual([1, 3]);
    expect(result.items).toHaveLength(1);
  });

  it("records an interior blank line and keeps going", async () => {
    const file = await writeGolden([goldenLine(), "", goldenLine()]);
    const result = await validateGoldenFiles([file]);
    expect(problems(result.errors)).toEqual(["is a blank line"]);
    expect(result.items).toHaveLength(2);
  });

  it("flags @-handles in the claim, including the Mastodon form", async () => {
    const file = await writeGolden([
      goldenLine({ claim: "Laut @erfundener_account ist alles erfunden." }),
      goldenLine({
        claim: "Auch @erfunden@instanz.example sagt erfundene Dinge.",
      }),
      goldenLine(),
    ]);
    const result = await validateGoldenFiles([file]);
    expect(result.errors).toHaveLength(2);
    for (const issue of result.errors) {
      expect(issue.problem).toContain("@-handle");
    }
  });

  it("flags an @-handle in source", async () => {
    const file = await writeGolden([
      goldenLine({ source: "@erfundenes_archiv" }),
    ]);
    const result = await validateGoldenFiles([file]);
    expect(problems(result.errors)).toEqual([
      'has an @-handle in "source" — use the archive name or domain',
    ]);
  });

  it("requires per-item provenance (#15)", async () => {
    const noSource = JSON.parse(goldenLine()) as Record<string, unknown>;
    delete noSource["source"];
    const file = await writeGolden([JSON.stringify(noSource)]);
    const result = await validateGoldenFiles([file]);
    expect(problems(result.errors)).toEqual([
      'is missing "source" — per-item provenance is required (#15)',
    ]);
  });

  it("flags duplicate claims across files, naming the first location", async () => {
    const duplicated = goldenLine();
    const fileA = await writeGolden([duplicated, goldenLine()]);
    const fileB = await writeGolden([goldenLine(), duplicated]);
    const result = await validateGoldenFiles([fileA, fileB]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ file: fileB, line: 2 });
    expect(result.errors[0]?.problem).toBe(
      `duplicates the claim at ${fileA}:1`,
    );
  });

  it("flags a claim that §8 cleanup reduces to nothing", async () => {
    const file = await writeGolden([
      goldenLine({ claim: "https://example.org/erfunden 🔥🔥" }),
    ]);
    const result = await validateGoldenFiles([file]);
    expect(problems(result.errors)).toEqual([
      "claim cleans to empty text (§8 step 1) — nothing would embed",
    ]);
  });

  it("warns when detection confidently disagrees with the lang label", async () => {
    const file = await writeGolden([
      goldenLine({
        claim:
          "This entirely invented story claims that the weather service " +
          "secretly controls the rain across the whole country every single day.",
        lang: "de",
      }),
    ]);
    const result = await validateGoldenFiles([file]);
    expect(result.errors).toHaveLength(0);
    const mismatch = result.warnings.filter((issue) =>
      issue.problem.includes("disagrees"),
    );
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]?.problem).toContain('"en"');
  });

  it("warns about §14 composition shortfalls without failing", async () => {
    const file = await writeGolden([
      goldenLine({ expectedUrl: "https://factcheck.example.org/artikel/1" }),
      goldenLine({ lang: "en", claim: "An invented English claim, alone." }),
    ]);
    const result = await validateGoldenFiles([file]);
    expect(result.errors).toHaveLength(0);
    const composition = problems(result.warnings).filter((problem) =>
      problem.includes("§14 target"),
    );
    expect(composition).toEqual([
      "de positives: 1 of the §14 target ~100",
      "de negatives: 0 of the §14 target ~50",
      "en items: 1 of the §14 target 50",
    ]);
  });

  it("stops warning once the §14 floors are met", async () => {
    const lines = [
      ...Array.from({ length: 90 }, (_, i) =>
        goldenLine({
          expectedUrl: `https://factcheck.example.org/artikel/${i}`,
        }),
      ),
      ...Array.from({ length: 45 }, () => goldenLine()),
      ...Array.from({ length: 50 }, (_, i) =>
        goldenLine({
          lang: "en",
          claim: `Invented English claim number ${i} about a fictitious event.`,
        }),
      ),
    ];
    const result = await validateGoldenFiles([await writeGolden(lines)]);
    expect(result.errors).toHaveLength(0);
    expect(
      problems(result.warnings).filter((p) => p.includes("§14 target")),
    ).toEqual([]);
  });

  it("treats an empty set as one error, with no composition noise", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gegenrede-validate-"));
    const file = path.join(dir, "golden.jsonl");
    await writeFile(file, "");
    const result = await validateGoldenFiles([file]);
    expect(problems(result.errors)).toEqual([
      "the golden set is empty — curation lands with issue #15",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("reports an unreadable file instead of throwing", async () => {
    const missing = path.join(tmpdir(), "gegenrede-validate-missing.jsonl");
    const result = await validateGoldenFiles([missing]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ file: missing, line: null });
    expect(result.errors[0]?.problem).toContain("cannot be read");
  });
});

describe("renderValidationReport", () => {
  it("summarizes counts, sources, and the verdict", async () => {
    const file = await writeGolden([
      goldenLine({
        expectedUrl: "https://factcheck.example.org/artikel/1",
        source: "archiv-a.example",
      }),
      goldenLine({ source: "archiv-a.example" }),
      goldenLine({ source: "archiv-b.example" }),
    ]);
    const result = await validateGoldenFiles([file]);
    const output = renderValidationReport(result, 1).join("\n");
    expect(output).toContain("golden set: 3 item(s) across 1 file(s)");
    expect(output).toContain("de: 1 positive(s) + 2 negative(s) = 3");
    expect(output).toContain(
      "sources: archiv-a.example ×2, archiv-b.example ×1",
    );
    expect(output).toContain("validation passed — 3 item(s)");
  });

  it("renders failures with file:line and never echoes claim text", async () => {
    const claim =
      "Laut @erfundener_account regnet es nur noch erfundenen Regen.";
    const file = await writeGolden([goldenLine({ claim })]);
    const result = await validateGoldenFiles([file]);
    const lines = renderValidationReport(result, 1);
    expect(lines.join("\n")).toContain(`${file}:1 claim contains an @-handle`);
    expect(lines.join("\n")).toContain("validation FAILED — 1 error(s)");
    for (const line of lines) {
      expect(line).not.toContain(claim);
      expect(line).not.toContain("@erfundener_account");
    }
  });
});
