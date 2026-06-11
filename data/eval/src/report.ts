// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Report shaping (spec §14): the JSON file is the machine-readable artifact
// committed alongside threshold/model decisions (§8); the markdown is the
// human-readable summary of the same numbers. Golden claims are curated
// public fact-check claims (no user posts, no handles), so per-item results
// may appear verbatim.

import type {
  EvalParams,
  EvalRun,
  ItemResult,
  MetricBucket,
} from "./run-eval.js";

export interface SnapshotInfo {
  version: string;
  model: string;
  modelRevision: string;
  count: number;
  langs: Record<string, number>;
  sha256: string;
  /** "cli-flag" = verified against a published hash; "self-computed" = not. */
  sha256Source: "cli-flag" | "self-computed";
}

export interface GoldenSetInfo {
  files: string[];
  positives: number;
  negatives: number;
  perLang: Record<string, { positives: number; negatives: number }>;
}

export interface MissEntry {
  file: string;
  line: number;
  lang: string;
  claim: string;
  expectedUrl: string;
  expectedInIndex: boolean;
  topHit: { url: string; score: number } | null;
}

export interface FalseMatchEntry {
  file: string;
  line: number;
  lang: string;
  claim: string;
  topHit: { url: string; score: number };
}

export interface ItemReportEntry {
  file: string;
  line: number;
  lang: string;
  claim: string;
  expectedUrl: string | null;
  matched: boolean;
  matchedAtThreshold: boolean;
  falseMatch: boolean;
  expectedInIndex: boolean | null;
  hits: { id: string; url: string; score: number }[];
}

export interface EvalReport {
  generatedAt: string;
  /** Which §8 steps ran — distinguishes future LLM-normalized runs. */
  pipeline: { cleanup: true; normalization: "none" };
  snapshot: SnapshotInfo;
  golden: GoldenSetInfo;
  params: EvalParams;
  metrics: {
    overall: MetricBucket;
    perLang: Record<string, MetricBucket>;
  };
  /** §8 step 2 diagnostic: items whose tinyld detection agrees per label. */
  detection: Record<string, { agree: number; total: number }>;
  misses: MissEntry[];
  falseMatches: FalseMatchEntry[];
  items: ItemReportEntry[];
}

function topHitOf(result: ItemResult): { url: string; score: number } | null {
  const top = result.hits[0];
  return top === undefined ? null : { url: top.url, score: top.score };
}

export function buildReport(
  run: EvalRun,
  snapshot: SnapshotInfo,
  golden: GoldenSetInfo,
  generatedAt: string,
): EvalReport {
  const detection: Record<string, { agree: number; total: number }> = {};
  for (const result of run.items) {
    const bucket = (detection[result.item.lang] ??= { agree: 0, total: 0 });
    bucket.total += 1;
    if (result.detectionAgrees) {
      bucket.agree += 1;
    }
  }

  const misses: MissEntry[] = run.items
    .filter((r) => r.item.expectedUrl !== null && !r.matched)
    .map((r) => ({
      file: r.item.file,
      line: r.item.line,
      lang: r.item.lang,
      claim: r.item.claim,
      // The filter above keeps expectedUrl/expectedInIndex non-null.
      expectedUrl: r.item.expectedUrl as string,
      expectedInIndex: r.expectedInIndex as boolean,
      topHit: topHitOf(r),
    }));

  const falseMatches: FalseMatchEntry[] = run.items
    .filter((r) => r.falseMatch)
    .map((r) => ({
      file: r.item.file,
      line: r.item.line,
      lang: r.item.lang,
      claim: r.item.claim,
      // falseMatch implies at least one hit at/above threshold.
      topHit: topHitOf(r) as { url: string; score: number },
    }));

  return {
    generatedAt,
    pipeline: { cleanup: true, normalization: "none" },
    snapshot,
    golden,
    params: run.params,
    metrics: { overall: run.overall, perLang: run.perLang },
    detection,
    misses,
    falseMatches,
    items: run.items.map((r) => ({
      file: r.item.file,
      line: r.item.line,
      lang: r.item.lang,
      claim: r.item.claim,
      expectedUrl: r.item.expectedUrl,
      matched: r.matched,
      matchedAtThreshold: r.matchedAtThreshold,
      falseMatch: r.falseMatch,
      expectedInIndex: r.expectedInIndex,
      hits: r.hits,
    })),
  };
}

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function score(value: number): string {
  return value.toFixed(3);
}

function metricsRow(label: string, bucket: MetricBucket): string {
  return `| ${label} | ${bucket.positives} | ${bucket.negatives} | ${pct(
    bucket.recallAtK,
  )} | ${pct(bucket.recallAtKAtThreshold)} | ${pct(bucket.falseMatchRate)} |`;
}

/** File base name for the artifact pair: eval-<version>-<YYYY-MM-DDTHH-mm-ssZ>. */
export function reportBaseName(report: EvalReport): string {
  const stamp = report.generatedAt
    .replace(/\.\d+(?=Z$)/, "")
    .replaceAll(":", "-");
  return `eval-${report.snapshot.version}-${stamp}`;
}

export function renderMarkdown(report: EvalReport): string {
  const { snapshot, golden, params, metrics } = report;
  const lines: string[] = [
    `# Eval report — snapshot ${snapshot.version}`,
    "",
    `Generated ${report.generatedAt}. Pipeline: cleanup → embed query → search`,
    `(no LLM normalization). Spec §14 targets: recall@${params.topK} ≥ 80.0%,`,
    `false-match rate ≤ 5.0% at threshold ${params.threshold}.`,
    "",
    "## Snapshot",
    "",
    `- model: \`${snapshot.model}\` @ \`${snapshot.modelRevision}\``,
    `- records: ${snapshot.count} (${
      Object.entries(snapshot.langs)
        .map(([lang, count]) => `${lang}: ${count}`)
        .join(", ") || "empty"
    })`,
    `- sha256: \`${snapshot.sha256}\` (${
      snapshot.sha256Source === "cli-flag"
        ? "verified against published hash"
        : "self-computed — NOT verified against a published manifest"
    })`,
    "",
    "## Golden sets",
    "",
    ...golden.files.map((file) => `- \`${file}\``),
    `- items: ${golden.positives} positives, ${golden.negatives} negatives (${Object.entries(
      golden.perLang,
    )
      .map(([lang, c]) => `${lang}: ${c.positives}+/${c.negatives}−`)
      .join(", ")})`,
    "",
    "## Results",
    "",
    `| set | pos | neg | recall@${params.topK} | recall@${params.topK} ≥ ${params.threshold} | false-match rate |`,
    "|---|---|---|---|---|---|",
    metricsRow("overall", metrics.overall),
    ...Object.entries(metrics.perLang).map(([lang, bucket]) =>
      metricsRow(lang, bucket),
    ),
    "",
    `Language detection agreement (diagnostic, §8 step 2): ${
      Object.entries(report.detection)
        .map(([lang, d]) => `${lang}: ${d.agree}/${d.total}`)
        .join(", ") || "n/a"
    }.`,
    "",
    `## Missed positives (${report.misses.length})`,
    "",
  ];

  if (report.misses.length === 0) {
    lines.push("None.");
  } else {
    lines.push(
      "| item | lang | expected | in index? | top hit |",
      "|---|---|---|---|---|",
      ...report.misses.map(
        (miss) =>
          `| ${miss.file}:${miss.line} | ${miss.lang} | ${miss.expectedUrl} | ${
            miss.expectedInIndex ? "yes" : "no — coverage gap"
          } | ${
            miss.topHit === null
              ? "—"
              : `${miss.topHit.url} (${score(miss.topHit.score)})`
          } |`,
      ),
    );
  }

  lines.push("", `## False matches (${report.falseMatches.length})`, "");
  if (report.falseMatches.length === 0) {
    lines.push("None.");
  } else {
    lines.push(
      "| item | lang | top hit |",
      "|---|---|---|",
      ...report.falseMatches.map(
        (entry) =>
          `| ${entry.file}:${entry.line} | ${entry.lang} | ${entry.topHit.url} (${score(
            entry.topHit.score,
          )}) |`,
      ),
    );
  }

  lines.push("");
  return lines.join("\n");
}
