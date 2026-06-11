// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Golden-set JSONL schema and loader (spec §14). The items themselves are
// human-curated (#15); per CLAUDE.md the runner must never add, remove,
// edit, filter, or reweight them. The loader therefore validates and
// aborts on the first bad line — it never skips one, because a silently
// dropped item would skew the reported metrics.

import { readFile } from "node:fs/promises";

import { z } from "zod";

import { EvalError } from "./errors.js";

/**
 * One golden item, one JSONL line. `expectedUrl` is the fact-check URL the
 * pipeline is expected to retrieve (in-index positive); `null` marks an
 * out-of-index negative that must stay below the match threshold. `strict`
 * so a curation typo (unknown key) fails loudly instead of being ignored.
 *
 * `source` is the item's provenance — which fact-checker archive the claim
 * was collected from (#15). Optional here so existing eval runs are
 * unaffected, but `pnpm eval --validate` requires it on every item.
 */
export const GoldenItem = z
  .object({
    claim: z
      .string()
      .refine((value) => value.trim().length > 0, "claim must not be blank"),
    expectedUrl: z.string().url().nullable(),
    lang: z.enum(["de", "en"]),
    source: z
      .string()
      .refine((value) => value.trim().length > 0, "source must not be blank")
      .optional(),
  })
  .strict();

export type GoldenItem = z.infer<typeof GoldenItem>;

/** Golden item plus its provenance for error messages and reports. */
export interface LoadedGoldenItem extends GoldenItem {
  file: string;
  line: number;
}

export type GoldenLineResult =
  | { ok: true; item: GoldenItem }
  | { ok: false; problem: string };

/**
 * Checks one JSONL line against the golden schema without throwing. The
 * `problem` string is phrased to follow a "file:line" location prefix —
 * the eval loader turns it into an EvalError, the #15 validator collects it.
 */
export function checkGoldenLine(line: string): GoldenLineResult {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { ok: false, problem: "is not valid JSON" };
  }
  const parsed = GoldenItem.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const at =
      issue !== undefined && issue.path.length > 0
        ? ` at "${issue.path.join(".")}"`
        : "";
    return {
      ok: false,
      problem: `fails the golden schema${at}: ${issue?.message ?? "invalid"}`,
    };
  }
  return { ok: true, item: parsed.data };
}

/** Parses one JSONL line; throws EvalError("bad-golden") with file:line. */
export function parseGoldenLine(
  line: string,
  file: string,
  lineNo: number,
): LoadedGoldenItem {
  const result = checkGoldenLine(line);
  if (!result.ok) {
    throw new EvalError("bad-golden", `${file}:${lineNo} ${result.problem}`);
  }
  return { ...result.item, file, line: lineNo };
}

/**
 * Splits JSONL text into lines, tolerating CRLF endings and one trailing
 * newline. Interior blank lines are preserved as "" — how to treat them is
 * the caller's policy (the loader aborts, the validator records and goes on).
 */
export function splitJsonlLines(text: string): string[] {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (body === "") {
    return [];
  }
  return body
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

/**
 * Loads one golden JSONL file. Tolerates CRLF endings and one trailing
 * newline; an interior blank line or any invalid line aborts the run. An
 * empty file yields [] — the CLI rejects a run with zero items overall.
 */
export async function loadGoldenFile(
  path: string,
): Promise<LoadedGoldenItem[]> {
  const text = await readFile(path, "utf8");
  return splitJsonlLines(text).map((line, index) => {
    if (line === "") {
      throw new EvalError("bad-golden", `${path}:${index + 1} is a blank line`);
    }
    return parseGoldenLine(line, path, index + 1);
  });
}
