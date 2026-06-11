// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// The eval core (spec §14): runs the deterministic matching pipeline —
// cleanup (§8 step 1) → embed `query:` (§8 step 4) → search the snapshot —
// for every golden item and derives recall@K / false-match metrics. LLM
// normalization (§8 step 3) is deliberately absent: the eval measures the
// retrieval floor every install gets, with no LLM configured.
//
// Items are processed exactly as loaded — never edited, filtered, skipped,
// or reweighted (CLAUDE.md Testing discipline). The output carries one
// ItemResult per input item, in input order.

import {
  searchSnapshot,
  type GgxSnapshot,
  type SnapshotSearchHit,
} from "@gegenrede/index-format";
import {
  cleanPostText,
  detectPostLanguage,
  embedText,
} from "@gegenrede/shared";

import { EvalError } from "./errors.js";
import { canonicalUrl } from "./url.js";
import type { LoadedGoldenItem } from "./golden.js";

// Spec §8 step 4 default cosine threshold. Frozen only after the Phase-0
// eval (§8); changing it requires human approval and a committed eval
// report. Defined here pending a shared home (the extension settings UI,
// #27, will need it too — flagged in the issue #14 task summary).
export const DEFAULT_THRESHOLD = 0.82;

// Spec §14 — recall@5 / top-5 above threshold (§8 step 4).
export const DEFAULT_TOP_K = 5;

export interface EvalParams {
  /** Cosine threshold in [0, 1] a hit must reach to count as a match. */
  threshold: number;
  /** Hits retrieved per query (the K in recall@K). */
  topK: number;
}

/** One retrieved fact-check, resolved against the snapshot meta block. */
export interface EvalHit {
  id: string;
  url: string;
  /** Cosine score in [0, 1] from the int8 search kernel. */
  score: number;
}

export interface ItemResult {
  item: LoadedGoldenItem;
  cleanedClaim: string;
  /** §8 step 2 diagnostic: tinyld on the cleaned claim, fallback = label. */
  detectedLang: string;
  detectionAgrees: boolean;
  /** Top-K of an unthresholded search, score descending. */
  hits: EvalHit[];
  /** Positives: expectedUrl is among the raw top-K (canonicalized). */
  matched: boolean;
  /** Positives: expectedUrl is among the hits scoring ≥ threshold. */
  matchedAtThreshold: boolean;
  /** Negatives: at least one hit scores ≥ threshold. */
  falseMatch: boolean;
  /** Positives: expectedUrl exists anywhere in the snapshot (else the miss
   *  is an index-coverage gap, not a retrieval failure). Null for negatives. */
  expectedInIndex: boolean | null;
}

export interface MetricBucket {
  positives: number;
  negatives: number;
  /** Null instead of NaN when the bucket has no positives. */
  recallAtK: number | null;
  recallAtKAtThreshold: number | null;
  /** Null instead of NaN when the bucket has no negatives. */
  falseMatchRate: number | null;
}

export interface EvalRun {
  params: EvalParams;
  /** Same length and order as the input items — guaranteed. */
  items: ItemResult[];
  overall: MetricBucket;
  perLang: Record<string, MetricBucket>;
}

function bucketOf(results: readonly ItemResult[]): MetricBucket {
  const positives = results.filter((r) => r.item.expectedUrl !== null);
  const negatives = results.filter((r) => r.item.expectedUrl === null);
  return {
    positives: positives.length,
    negatives: negatives.length,
    recallAtK:
      positives.length === 0
        ? null
        : positives.filter((r) => r.matched).length / positives.length,
    recallAtKAtThreshold:
      positives.length === 0
        ? null
        : positives.filter((r) => r.matchedAtThreshold).length /
          positives.length,
    falseMatchRate:
      negatives.length === 0
        ? null
        : negatives.filter((r) => r.falseMatch).length / negatives.length,
  };
}

function resolveHits(
  snapshot: GgxSnapshot,
  hits: readonly SnapshotSearchHit[],
): EvalHit[] {
  return hits.map((hit) => {
    const meta = snapshot.meta[hit.row];
    if (meta === undefined) {
      // searchSnapshot only returns rows < header.count; reaching this
      // means the snapshot is internally inconsistent.
      throw new EvalError(
        "bad-claim",
        `search returned row ${hit.row} outside the snapshot meta block`,
      );
    }
    return { id: hit.id, url: meta.url, score: hit.score };
  });
}

/**
 * Runs the pipeline for every item against the snapshot. One search per
 * item at threshold 0: the kernel filters by threshold *before* top-K
 * selection, so the unthresholded top-K is computed once and both the raw
 * and at-threshold metrics derive from it (threshold filters, never
 * reorders). Requires initEmbedding() to have been called.
 */
export async function runEval(
  items: readonly LoadedGoldenItem[],
  snapshot: GgxSnapshot,
  params: EvalParams,
): Promise<EvalRun> {
  const indexedUrls = new Set(
    snapshot.meta.map((record) => canonicalUrl(record.url)),
  );

  const results: ItemResult[] = [];
  for (const item of items) {
    const cleanedClaim = cleanPostText(item.claim);
    if (cleanedClaim === "") {
      throw new EvalError(
        "bad-claim",
        `${item.file}:${item.line} cleans to empty text — the item needs rewording (#15), it was NOT skipped`,
      );
    }
    // Diagnostic only (§8 step 2 "feeds the eval breakdown"): metrics group
    // by the human label; uiLang = label, so a low-confidence fallback
    // counts as agreement, mirroring a user whose UI language matches.
    const detection = detectPostLanguage(cleanedClaim, item.lang);

    const query = await embedText("query", cleanedClaim);
    const hits = resolveHits(
      snapshot,
      await searchSnapshot(snapshot, query, {
        topK: params.topK,
        threshold: 0,
      }),
    );

    const expected =
      item.expectedUrl === null ? null : canonicalUrl(item.expectedUrl);
    const hitUrls = hits.map((hit) => canonicalUrl(hit.url));
    results.push({
      item,
      cleanedClaim,
      detectedLang: detection.lang,
      detectionAgrees: detection.lang === item.lang,
      hits,
      matched: expected !== null && hitUrls.includes(expected),
      matchedAtThreshold:
        expected !== null &&
        hits.some(
          (hit, i) => hit.score >= params.threshold && hitUrls[i] === expected,
        ),
      falseMatch:
        expected === null && hits.some((hit) => hit.score >= params.threshold),
      expectedInIndex: expected === null ? null : indexedUrls.has(expected),
    });
  }

  const perLang: Record<string, MetricBucket> = {};
  for (const lang of [...new Set(items.map((item) => item.lang))].sort()) {
    perLang[lang] = bucketOf(results.filter((r) => r.item.lang === lang));
  }

  return { params, items: results, overall: bucketOf(results), perLang };
}
