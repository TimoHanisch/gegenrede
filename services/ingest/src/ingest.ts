// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Spec §9.3 — the I/O half of the shared normalizer: normalize → embed
// (`passage:` prefix via shared/embedText, CLAUDE.md Hard Rule 6) → upsert.
// The caller owns embedding-provider init (initEmbedding) and the store.
// Logging is counters + invalid-record indices only — never claim or post
// text (Hard Rule 5).

import { embedText } from "@gegenrede/shared";

import { normalizeRawFactCheck } from "./normalize.js";
import type { FactcheckStore } from "./store.js";

export interface IngestCounters {
  inserted: number;
  updated: number;
  skippedDedup: number;
  invalid: number;
}

export async function ingestRawFactChecks(
  raws: readonly unknown[],
  source: string,
  store: FactcheckStore,
  warn: (message: string) => void = console.warn,
): Promise<IngestCounters> {
  const counters: IngestCounters = {
    inserted: 0,
    updated: 0,
    skippedDedup: 0,
    invalid: 0,
  };
  for (const [index, raw] of raws.entries()) {
    let normalized;
    try {
      normalized = normalizeRawFactCheck(raw, source, warn);
    } catch {
      counters.invalid += 1;
      warn(
        `[gegenrede] ingest(${source}): record #${index} failed validation; skipped`,
      );
      continue;
    }
    const embedding = await embedText("passage", normalized.claimText);
    const outcome = await store.upsert({
      ...normalized,
      embedding: Array.from(embedding),
    });
    if (outcome === "inserted") counters.inserted += 1;
    else if (outcome === "updated") counters.updated += 1;
    else counters.skippedDedup += 1;
  }
  return counters;
}
