// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Hermetic eval-core tests: a synthetic in-memory .ggx and a fake embedding
// provider with hand-placed vectors, so every hit/miss below is controlled.
// All claims and URLs are invented (CLAUDE.md Testing discipline).

import type { GgxSnapshot } from "@gegenrede/index-format";
import {
  cleanPostText,
  initEmbedding,
  resetEmbedding,
} from "@gegenrede/shared";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { EvalError } from "./errors.js";
import { runEval, type EvalParams } from "./run-eval.js";
import {
  basisVector,
  buildSyntheticSnapshot,
  fakeProvider,
  goldenItem,
  vectorWithCosine,
} from "./test-fixtures.js";

const URL_A = "https://factcheck.example.org/artikel/a";
const URL_B = "https://factcheck.example.org/artikel/b";
const URL_C = "https://factcheck.example.org/artikel/c";
// Stored with a trailing slash to exercise canonicalization on the hit side.
const URL_D_INDEXED = "https://factcheck.example.org/artikel/d/";
const URL_D_EXPECTED = "https://factcheck.example.org/artikel/d";
const URL_MISSING = "https://factcheck.example.org/artikel/nicht-indiziert";

const PARAMS: EvalParams = { threshold: 0.82, topK: 5 };

let snapshot: GgxSnapshot;

beforeAll(async () => {
  ({ snapshot } = await buildSyntheticSnapshot([
    { url: URL_A, lang: "de", vector: basisVector(0) },
    // Retrievable but below the 0.82 threshold for a basis(1) query.
    { url: URL_B, lang: "de", vector: vectorWithCosine(1, 10, 0.7) },
    { url: URL_C, lang: "en", vector: basisVector(2) },
    { url: URL_D_INDEXED, lang: "de", vector: basisVector(3) },
  ]));
});

afterEach(() => {
  resetEmbedding();
});

describe("runEval metrics", () => {
  const CLAIM_A = "Erfundene Behauptung Alpha über ein fiktives Verbot.";
  const CLAIM_B = "Erfundene Behauptung Beta über eine fiktive Studie.";
  const CLAIM_C = "Invented claim Gamma about a fictitious event.";
  const CLAIM_NEG_DE = "Erfundene Behauptung Delta ohne Faktencheck.";
  const CLAIM_NEG_EN = "Invented claim Epsilon without a fact-check.";
  const CLAIM_D = "Erfundene Behauptung Zeta über einen fiktiven Ort.";

  function arrange() {
    initEmbedding(
      fakeProvider(
        new Map([
          [`query: ${CLAIM_A}`, basisVector(0)],
          [`query: ${CLAIM_B}`, basisVector(1)],
          [`query: ${CLAIM_C}`, basisVector(2)],
          // Near record A (cosine 0.9 ≥ threshold) — a false match.
          [`query: ${CLAIM_NEG_DE}`, vectorWithCosine(0, 11, 0.9)],
          // Orthogonal to every record — scores ~0 everywhere.
          [`query: ${CLAIM_NEG_EN}`, basisVector(20)],
          [`query: ${CLAIM_D}`, basisVector(3)],
        ]),
      ),
    );
    return [
      goldenItem({ claim: CLAIM_A, expectedUrl: URL_A, line: 1 }),
      goldenItem({ claim: CLAIM_B, expectedUrl: URL_B, line: 2 }),
      goldenItem({
        claim: CLAIM_C,
        expectedUrl: URL_MISSING,
        lang: "en",
        line: 3,
      }),
      goldenItem({ claim: CLAIM_NEG_DE, line: 4 }),
      goldenItem({ claim: CLAIM_NEG_EN, lang: "en", line: 5 }),
      goldenItem({ claim: CLAIM_D, expectedUrl: URL_D_EXPECTED, line: 6 }),
    ];
  }

  it("computes raw and at-threshold recall plus false-match rate", async () => {
    const run = await runEval(arrange(), snapshot, PARAMS);

    const [a, b, c, negDe, negEn, d] = run.items;
    expect(a?.matched).toBe(true);
    expect(a?.matchedAtThreshold).toBe(true);
    // B is in the raw top-5 at ~0.7 but below the 0.82 threshold.
    expect(b?.matched).toBe(true);
    expect(b?.matchedAtThreshold).toBe(false);
    expect(b?.hits.find((hit) => hit.url === URL_B)?.score).toBeCloseTo(0.7, 2);
    expect(c?.matched).toBe(false);
    expect(c?.expectedInIndex).toBe(false);
    expect(negDe?.falseMatch).toBe(true);
    expect(negDe?.expectedInIndex).toBeNull();
    expect(negEn?.falseMatch).toBe(false);
    // Canonicalization: expected without slash matches the stored slash form.
    expect(d?.matched).toBe(true);
    expect(d?.matchedAtThreshold).toBe(true);

    expect(run.overall).toEqual({
      positives: 4,
      negatives: 2,
      recallAtK: 3 / 4,
      recallAtKAtThreshold: 2 / 4,
      falseMatchRate: 1 / 2,
    });
  });

  it("breaks metrics down by the golden language label", async () => {
    const run = await runEval(arrange(), snapshot, PARAMS);

    expect(Object.keys(run.perLang)).toEqual(["de", "en"]);
    expect(run.perLang["de"]).toEqual({
      positives: 3,
      negatives: 1,
      recallAtK: 1,
      recallAtKAtThreshold: 2 / 3,
      falseMatchRate: 1,
    });
    expect(run.perLang["en"]).toEqual({
      positives: 1,
      negatives: 1,
      recallAtK: 0,
      recallAtKAtThreshold: 0,
      falseMatchRate: 0,
    });
  });

  it("returns hits sorted by score with resolved URLs", async () => {
    const run = await runEval(arrange(), snapshot, PARAMS);
    const hits = run.items[0]?.hits ?? [];
    expect(hits[0]?.url).toBe(URL_A);
    expect(hits[0]?.score).toBeCloseTo(1, 2);
    const scores = hits.map((hit) => hit.score);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
  });

  it("never edits, filters, or reorders the golden items", async () => {
    const items = arrange();
    items.forEach((item) => Object.freeze(item));
    Object.freeze(items);

    const run = await runEval(items, snapshot, PARAMS);
    expect(run.items).toHaveLength(items.length);
    run.items.forEach((result, i) => {
      expect(result.item).toBe(items[i]);
    });
  });
});

describe("runEval pipeline behavior", () => {
  it("searches the cleaned claim, not the raw post text (§8 step 1)", async () => {
    const raw =
      "Schau mal https://irgendwo.example.com was über #ErfundeneSache rauskam!!!";
    const cleaned = cleanPostText(raw);
    expect(cleaned).not.toBe(raw);
    // Provider only knows the cleaned form — passing raw text would throw.
    initEmbedding(
      fakeProvider(new Map([[`query: ${cleaned}`, basisVector(0)]])),
    );

    const run = await runEval(
      [goldenItem({ claim: raw, expectedUrl: URL_A })],
      snapshot,
      PARAMS,
    );
    expect(run.items[0]?.matched).toBe(true);
    expect(run.items[0]?.cleanedClaim).toBe(cleaned);
  });

  it("falls back to the item label when detection finds nothing (§8 step 2)", async () => {
    const numeric = "12345 67890 13579";
    expect(cleanPostText(numeric)).toBe(numeric);
    initEmbedding(
      fakeProvider(new Map([[`query: ${numeric}`, basisVector(20)]])),
    );

    const run = await runEval(
      [goldenItem({ claim: numeric })],
      snapshot,
      PARAMS,
    );
    expect(run.items[0]?.detectedLang).toBe("de");
    expect(run.items[0]?.detectionAgrees).toBe(true);
  });

  it("caps hits at topK", async () => {
    initEmbedding(
      fakeProvider(
        new Map([["query: Erfundene Behauptung Alpha.", basisVector(0)]]),
      ),
    );
    const run = await runEval(
      [
        goldenItem({
          claim: "Erfundene Behauptung Alpha.",
          expectedUrl: URL_A,
        }),
      ],
      snapshot,
      { threshold: 0.82, topK: 2 },
    );
    expect(run.items[0]?.hits).toHaveLength(2);
  });

  it("reports a miss for an in-index record pushed out of top-K", async () => {
    // Query sits closest to A; with topK 1 the expected D never surfaces.
    initEmbedding(
      fakeProvider(
        new Map([
          ["query: Erfundene Behauptung Eta.", vectorWithCosine(0, 3, 0.9)],
        ]),
      ),
    );
    const run = await runEval(
      [
        goldenItem({
          claim: "Erfundene Behauptung Eta.",
          expectedUrl: URL_D_EXPECTED,
        }),
      ],
      snapshot,
      { threshold: 0.82, topK: 1 },
    );
    expect(run.items[0]?.matched).toBe(false);
    expect(run.items[0]?.expectedInIndex).toBe(true);
  });

  it("aborts loudly when a claim cleans to empty text instead of skipping", async () => {
    const urlOnly = "https://nur-ein-link.example.com/beitrag";
    expect(cleanPostText(urlOnly)).toBe("");
    initEmbedding(fakeProvider(new Map()));

    await expect(
      runEval(
        [goldenItem({ claim: urlOnly, file: "golden-de.jsonl", line: 17 })],
        snapshot,
        PARAMS,
      ),
    ).rejects.toThrow(/golden-de\.jsonl:17 .*NOT skipped/);
  });

  it("propagates EvalError type for bad claims", async () => {
    initEmbedding(fakeProvider(new Map()));
    await expect(
      runEval([goldenItem({ claim: "🤡" })], snapshot, PARAMS),
    ).rejects.toBeInstanceOf(EvalError);
  });
});
