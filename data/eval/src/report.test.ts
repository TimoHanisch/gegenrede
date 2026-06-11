// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Report shaping tests against a hand-built EvalRun — no embedding, no
// snapshot. All data synthetic.

import { describe, expect, it } from "vitest";

import {
  buildReport,
  renderMarkdown,
  reportBaseName,
  type GoldenSetInfo,
  type SnapshotInfo,
} from "./report.js";
import type { EvalRun, ItemResult } from "./run-eval.js";
import { goldenItem } from "./test-fixtures.js";

const URL_HIT = "https://factcheck.example.org/artikel/treffer";
const URL_EXPECTED = "https://factcheck.example.org/artikel/erwartet";

const MISSED_POSITIVE: ItemResult = {
  item: goldenItem({
    claim: "Erfundene Behauptung ohne Treffer.",
    expectedUrl: URL_EXPECTED,
    file: "golden-de.jsonl",
    line: 12,
  }),
  cleanedClaim: "Erfundene Behauptung ohne Treffer.",
  detectedLang: "de",
  detectionAgrees: true,
  hits: [{ id: "fc-0001", url: URL_HIT, score: 0.61 }],
  matched: false,
  matchedAtThreshold: false,
  falseMatch: false,
  expectedInIndex: true,
};

const FALSE_MATCH_NEGATIVE: ItemResult = {
  item: goldenItem({
    claim: "Invented negative claim.",
    lang: "en",
    file: "golden-en.jsonl",
    line: 3,
  }),
  cleanedClaim: "Invented negative claim.",
  detectedLang: "en",
  detectionAgrees: false,
  hits: [{ id: "fc-0002", url: URL_HIT, score: 0.9 }],
  matched: false,
  matchedAtThreshold: false,
  falseMatch: true,
  expectedInIndex: null,
};

const RUN: EvalRun = {
  params: { threshold: 0.82, topK: 5 },
  items: [MISSED_POSITIVE, FALSE_MATCH_NEGATIVE],
  overall: {
    positives: 1,
    negatives: 1,
    recallAtK: 0,
    recallAtKAtThreshold: 0,
    falseMatchRate: 1,
  },
  perLang: {
    de: {
      positives: 1,
      negatives: 0,
      recallAtK: 0,
      recallAtKAtThreshold: 0,
      falseMatchRate: null,
    },
    en: {
      positives: 0,
      negatives: 1,
      recallAtK: null,
      recallAtKAtThreshold: null,
      falseMatchRate: 1,
    },
  },
};

const SNAPSHOT_INFO: SnapshotInfo = {
  version: "2026-06-08",
  model: "intfloat/multilingual-e5-small",
  modelRevision: "614241f622f53c4eeff9890bdc4f31cfecc418b3",
  count: 2,
  langs: { de: 1, en: 1 },
  sha256: "ab".repeat(32),
  sha256Source: "self-computed",
};

const GOLDEN_INFO: GoldenSetInfo = {
  files: ["data/eval/golden-de.jsonl", "data/eval/golden-en.jsonl"],
  positives: 1,
  negatives: 1,
  perLang: {
    de: { positives: 1, negatives: 0 },
    en: { positives: 0, negatives: 1 },
  },
};

const GENERATED_AT = "2026-06-11T10:20:30.000Z";

describe("buildReport", () => {
  const report = buildReport(RUN, SNAPSHOT_INFO, GOLDEN_INFO, GENERATED_AT);

  it("carries snapshot identity, params, and golden counts", () => {
    expect(report.generatedAt).toBe(GENERATED_AT);
    expect(report.pipeline).toEqual({ cleanup: true, normalization: "none" });
    expect(report.snapshot).toEqual(SNAPSHOT_INFO);
    expect(report.golden).toEqual(GOLDEN_INFO);
    expect(report.params).toEqual({ threshold: 0.82, topK: 5 });
    expect(report.metrics.overall.falseMatchRate).toBe(1);
    expect(report.metrics.perLang["en"]?.recallAtK).toBeNull();
  });

  it("lists missed positives with index-coverage diagnosis", () => {
    expect(report.misses).toEqual([
      {
        file: "golden-de.jsonl",
        line: 12,
        lang: "de",
        claim: "Erfundene Behauptung ohne Treffer.",
        expectedUrl: URL_EXPECTED,
        expectedInIndex: true,
        topHit: { url: URL_HIT, score: 0.61 },
      },
    ]);
  });

  it("lists false matches with their top hit", () => {
    expect(report.falseMatches).toEqual([
      {
        file: "golden-en.jsonl",
        line: 3,
        lang: "en",
        claim: "Invented negative claim.",
        topHit: { url: URL_HIT, score: 0.9 },
      },
    ]);
  });

  it("keeps one entry per item plus detection counts", () => {
    expect(report.items).toHaveLength(2);
    expect(report.items[0]?.matched).toBe(false);
    expect(report.detection).toEqual({
      de: { agree: 1, total: 1 },
      en: { agree: 0, total: 1 },
    });
  });
});

describe("renderMarkdown", () => {
  const markdown = renderMarkdown(
    buildReport(RUN, SNAPSHOT_INFO, GOLDEN_INFO, GENERATED_AT),
  );

  it("shows headline metrics with the §14 targets", () => {
    expect(markdown).toContain("# Eval report — snapshot 2026-06-08");
    expect(markdown).toContain("recall@5 ≥ 80.0%");
    expect(markdown).toContain("false-match rate ≤ 5.0% at threshold 0.82");
    expect(markdown).toContain("| overall | 1 | 1 | 0.0% | 0.0% | 100.0% |");
    expect(markdown).toContain("| de | 1 | 0 | 0.0% | 0.0% | n/a |");
  });

  it("flags a self-computed sha256 as unverified", () => {
    expect(markdown).toContain("NOT verified against a published manifest");
  });

  it("renders miss and false-match tables", () => {
    expect(markdown).toContain("## Missed positives (1)");
    expect(markdown).toContain(
      `| golden-de.jsonl:12 | de | ${URL_EXPECTED} | yes |`,
    );
    expect(markdown).toContain("## False matches (1)");
    expect(markdown).toContain(`${URL_HIT} (0.900)`);
  });
});

describe("reportBaseName", () => {
  it("combines snapshot version and a filesystem-safe timestamp", () => {
    const report = buildReport(RUN, SNAPSHOT_INFO, GOLDEN_INFO, GENERATED_AT);
    expect(reportBaseName(report)).toBe("eval-2026-06-08-2026-06-11T10-20-30Z");
  });
});
