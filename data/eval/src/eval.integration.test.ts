// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Integration-only — skipped unless EMBEDDING_INTEGRATION=1: loads the real
// pinned model (~120 MB download on first use). Asserts ranking only, never
// threshold outcomes: e5 cosine scores are compressed and a 3-record set
// asserting against 0.82 would be flaky. The real gate run on the curated
// golden sets is issue #17. All claims are invented; example.org URLs only.

import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_REVISION,
  embedText,
  initEmbedding,
  resetEmbedding,
} from "@gegenrede/shared";
import {
  readSnapshot,
  writeSnapshot,
  type SnapshotRecord,
} from "@gegenrede/index-format";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runEval } from "./run-eval.js";
import { goldenItem } from "./test-fixtures.js";

const INTEGRATION = process.env["EMBEDDING_INTEGRATION"] === "1";

const PASSAGES = [
  {
    url: "https://factcheck.example.org/artikel/beispielhausen-autos",
    claim:
      "Die fiktive Stadt Beispielhausen hat im Jahr 2025 alle Autos aus der Innenstadt verbannt.",
  },
  {
    url: "https://factcheck.example.org/artikel/beispiel-verein-logo",
    claim:
      "Der erfundene Verein Beispiel e.V. hat ein neues Vereinslogo vorgestellt.",
  },
  {
    url: "https://factcheck.example.org/artikel/erfundener-see",
    claim:
      "Ein erfundener See im Beispielwald ist angeblich über Nacht verschwunden.",
  },
];

describe.skipIf(!INTEGRATION)(
  "eval runner against the real pinned model (integration)",
  () => {
    beforeAll(async () => {
      const { createNodeEmbeddingProvider } =
        await import("@gegenrede/shared/embedding-node");
      initEmbedding(await createNodeEmbeddingProvider());
    }, 300_000);

    afterAll(() => {
      resetEmbedding();
    });

    it(
      "ranks the paraphrased claim's fact-check first",
      { timeout: 300_000 },
      async () => {
        const records: SnapshotRecord[] = [];
        for (const [i, passage] of PASSAGES.entries()) {
          records.push({
            vector: await embedText("passage", passage.claim),
            meta: {
              id: `fc-${String(i).padStart(4, "0")}`,
              claim: passage.claim,
              verdict: "false",
              ratingRaw: "Falsch",
              publisher: "Beispiel-Faktencheck",
              url: passage.url,
              publishedAt: "2026-05-31",
              lang: "de",
            },
          });
        }
        const { bytes, sha256 } = await writeSnapshot(records, {
          version: "integration-test",
          model: EMBEDDING_MODEL_ID,
          modelRevision: EMBEDDING_MODEL_REVISION,
          dim: EMBEDDING_DIM,
        });
        const snapshot = await readSnapshot(bytes, {
          expectedSha256: sha256,
          pinned: {
            model: EMBEDDING_MODEL_ID,
            modelRevision: EMBEDDING_MODEL_REVISION,
          },
        });

        const run = await runEval(
          [
            goldenItem({
              // Paraphrase of the first passage, not a verbatim copy.
              claim:
                "In der Innenstadt von Beispielhausen sind seit 2025 angeblich sämtliche Autos verboten.",
              expectedUrl: PASSAGES[0]?.url ?? "",
              line: 1,
            }),
            goldenItem({
              claim:
                "Eine erfundene Brücke über den Beispielfluss soll aus Schokolade gebaut worden sein.",
              line: 2,
            }),
          ],
          snapshot,
          { threshold: 0.82, topK: 5 },
        );

        const positive = run.items[0];
        expect(positive?.hits[0]?.url).toBe(PASSAGES[0]?.url);
        expect(positive?.matched).toBe(true);
        // Negative: assert structure, not threshold outcomes (flaky).
        expect(run.items[1]?.expectedInIndex).toBeNull();
        expect(run.overall.positives).toBe(1);
        expect(run.overall.negatives).toBe(1);
      },
    );
  },
);
