// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// `pnpm eval --validate` (issue #15) — format validation for the
// human-curated golden sets, with no snapshot and no embedding model.
// Unlike the eval loader (abort on first bad line, so a run can never
// silently skew), curation wants every problem in one pass, so this module
// collects all of them. It only reports — editing items is human-only
// (CLAUDE.md Testing discipline). Output never quotes claim text, only
// file:line locations.

import { readFile } from "node:fs/promises";

import { cleanPostText, detectPostLanguage } from "@gegenrede/shared";

import {
  checkGoldenLine,
  splitJsonlLines,
  type LoadedGoldenItem,
} from "./golden.js";

// Mirrors the §8 cleanup handle definition (HANDLE_PATTERN is module-private
// in packages/shared/src/cleanup.ts): platform mentions including Mastodon's
// @user@instance form. Emails match too — also unwanted in committed data.
const HANDLE_PATTERN = /@[\p{L}\p{N}_]+(?:@[\p{L}\p{N}][\p{L}\p{N}.-]*)?/u;

// Spec §14 composition. The "~" targets warn below a 90% floor so a
// half-curated batch doesn't nag on every run; the exact en target is firm.
const COMPOSITION_FLOORS: ReadonlyArray<{
  lang: "de" | "en";
  which: "positives" | "negatives" | "items";
  target: string;
  floor: number;
}> = [
  { lang: "de", which: "positives", target: "~100", floor: 90 },
  { lang: "de", which: "negatives", target: "~50", floor: 45 },
  { lang: "en", which: "items", target: "50", floor: 50 },
];

export interface ValidationIssue {
  /** Null for set-level issues (composition, empty set). */
  file: string | null;
  /** 1-indexed JSONL line; null for file- and set-level issues. */
  line: number | null;
  /** Phrased to follow a "file:line" location prefix. */
  problem: string;
}

export interface ValidationResult {
  /** Items that parsed; lines with schema errors are absent. */
  items: LoadedGoldenItem[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/**
 * Validates golden JSONL files for curation (#15): schema per line, no
 * @-handles, provenance (`source`) on every item, no duplicate claims, no
 * claim that §8 cleanup reduces to nothing — plus advisory warnings for
 * §14 composition shortfalls and language-label disagreements.
 */
export async function validateGoldenFiles(
  paths: string[],
): Promise<ValidationResult> {
  const items: LoadedGoldenItem[] = [];
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const firstSeen = new Map<string, string>();

  for (const file of paths) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      errors.push({
        file,
        line: null,
        problem: `cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    for (const [index, line] of splitJsonlLines(text).entries()) {
      const lineNo = index + 1;
      if (line === "") {
        errors.push({ file, line: lineNo, problem: "is a blank line" });
        continue;
      }
      const result = checkGoldenLine(line);
      if (!result.ok) {
        errors.push({ file, line: lineNo, problem: result.problem });
        continue;
      }
      const item: LoadedGoldenItem = { ...result.item, file, line: lineNo };
      items.push(item);
      checkItem(item, firstSeen, errors, warnings);
    }
  }

  if (items.length === 0) {
    if (errors.length === 0) {
      errors.push({
        file: null,
        line: null,
        problem: "the golden set is empty — curation lands with issue #15",
      });
    }
  } else {
    warnings.push(...compositionWarnings(items));
  }
  return { items, errors, warnings };
}

function checkItem(
  item: LoadedGoldenItem,
  firstSeen: Map<string, string>,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  const { file, line } = item;

  if (HANDLE_PATTERN.test(item.claim)) {
    errors.push({
      file,
      line,
      problem:
        "claim contains an @-handle — rephrase it; committed eval data " +
        "must hold no real user handles (CLAUDE.md Testing discipline)",
    });
  }
  if (item.source === undefined) {
    errors.push({
      file,
      line,
      problem: 'is missing "source" — per-item provenance is required (#15)',
    });
  } else if (HANDLE_PATTERN.test(item.source)) {
    errors.push({
      file,
      line,
      problem: 'has an @-handle in "source" — use the archive name or domain',
    });
  }

  const duplicateKey = item.claim.trim();
  const first = firstSeen.get(duplicateKey);
  if (first === undefined) {
    firstSeen.set(duplicateKey, `${file}:${line}`);
  } else {
    errors.push({
      file,
      line,
      problem: `duplicates the claim at ${first}`,
    });
  }

  const cleaned = cleanPostText(item.claim);
  if (cleaned === "") {
    errors.push({
      file,
      line,
      problem: "claim cleans to empty text (§8 step 1) — nothing would embed",
    });
    return;
  }
  // Same diagnostic as the eval run's detectionAgrees (run-eval.ts): the
  // item's own label is the fallback, so only a confident disagreement warns.
  const detection = detectPostLanguage(cleaned, item.lang);
  if (!detection.usedFallback && detection.lang !== item.lang) {
    warnings.push({
      file,
      line,
      problem:
        `detected language "${detection.lang}" disagrees with the ` +
        `"${item.lang}" label (confidence ${detection.confidence.toFixed(2)}) — diagnostic only`,
    });
  }
}

function compositionWarnings(
  items: readonly LoadedGoldenItem[],
): ValidationIssue[] {
  const counts = countByLang(items);
  return COMPOSITION_FLOORS.flatMap(({ lang, which, target, floor }) => {
    const bucket = counts.get(lang) ?? { positives: 0, negatives: 0 };
    const actual =
      which === "items" ? bucket.positives + bucket.negatives : bucket[which];
    if (actual >= floor) {
      return [];
    }
    return [
      {
        file: null,
        line: null,
        problem: `${lang} ${which}: ${actual} of the §14 target ${target}`,
      },
    ];
  });
}

interface LangCounts {
  positives: number;
  negatives: number;
}

function countByLang(
  items: readonly LoadedGoldenItem[],
): Map<string, LangCounts> {
  const counts = new Map<string, LangCounts>();
  for (const item of items) {
    let bucket = counts.get(item.lang);
    if (bucket === undefined) {
      bucket = { positives: 0, negatives: 0 };
      counts.set(item.lang, bucket);
    }
    bucket[item.expectedUrl === null ? "negatives" : "positives"] += 1;
  }
  return counts;
}

/** Renders the validation outcome as CLI lines (no claim text, ever). */
export function renderValidationReport(
  result: ValidationResult,
  fileCount: number,
): string[] {
  const lines: string[] = [];
  const counts = countByLang(result.items);

  lines.push(
    `golden set: ${result.items.length} item(s) across ${fileCount} file(s)`,
  );
  for (const [lang, bucket] of [...counts.entries()].sort()) {
    lines.push(
      `  ${lang}: ${bucket.positives} positive(s) + ${bucket.negatives} ` +
        `negative(s) = ${bucket.positives + bucket.negatives}`,
    );
  }
  const sources = new Map<string, number>();
  for (const item of result.items) {
    if (item.source !== undefined) {
      sources.set(item.source, (sources.get(item.source) ?? 0) + 1);
    }
  }
  if (sources.size > 0) {
    const rendered = [...sources.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([source, count]) => `${source} ×${count}`)
      .join(", ");
    lines.push(`  sources: ${rendered}`);
  }

  for (const [label, issues] of [
    ["warnings", result.warnings],
    ["errors", result.errors],
  ] as const) {
    if (issues.length === 0) {
      continue;
    }
    lines.push(`${label} (${issues.length}):`);
    for (const issue of issues) {
      lines.push(`  ${renderLocation(issue)}${issue.problem}`);
    }
  }

  lines.push(
    result.errors.length === 0
      ? `validation passed — ${result.items.length} item(s), ` +
          `${result.warnings.length} warning(s)`
      : `validation FAILED — ${result.errors.length} error(s)`,
  );
  return lines;
}

function renderLocation(issue: ValidationIssue): string {
  if (issue.file === null) {
    return "";
  }
  return issue.line === null
    ? `${issue.file} `
    : `${issue.file}:${issue.line} `;
}
