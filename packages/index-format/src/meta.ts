// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Meta-block record codec (spec §5): one FactCheckMatch-shaped JSON record
// per JSONL line, without the query-time `score`. The type is imported
// type-only from packages/shared (§3: cross-boundary payloads come from
// shared, never redeclared) so this package keeps zero runtime
// dependencies. Serialization uses an explicit field order so identical
// records produce identical bytes (§14 round-trip byte equality).

import type { FactCheckMatch } from "@gegenrede/shared";

import { GgxError } from "./errors.js";

/** One indexed fact-check record: FactCheckMatch minus `score` (§5). */
export type GgxMetaRecord = Omit<FactCheckMatch, "score">;

const META_STRING_FIELDS = [
  "id",
  "claim",
  "verdict",
  "ratingRaw",
  "publisher",
  "url",
  "publishedAt",
  "lang",
] as const;

export function serializeMetaRecord(record: GgxMetaRecord): string {
  return JSON.stringify({
    id: record.id,
    claim: record.claim,
    verdict: record.verdict,
    ratingRaw: record.ratingRaw,
    publisher: record.publisher,
    url: record.url,
    publishedAt: record.publishedAt,
    lang: record.lang,
  });
}

export function parseMetaRecord(line: string, index: number): GgxMetaRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new GgxError("bad-meta", `meta record ${index} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new GgxError("bad-meta", `meta record ${index} is not an object`);
  }
  const record = parsed as Record<string, unknown>;
  for (const field of META_STRING_FIELDS) {
    const value = record[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new GgxError(
        "bad-meta",
        `meta record ${index} field ${field} is invalid`,
      );
    }
  }
  if ("score" in record) {
    // Scores are query-time results, never index data (§5).
    throw new GgxError("bad-meta", `meta record ${index} carries a score`);
  }
  // Structural validation only: this package cannot run the zod schemas
  // without taking a runtime dependency (§3 "pure TS, no deps"). The
  // verdict value is checked against the Verdict enum where the record
  // crosses back into shared-typed code (snapshot install / search).
  return {
    id: record["id"],
    claim: record["claim"],
    verdict: record["verdict"],
    ratingRaw: record["ratingRaw"],
    publisher: record["publisher"],
    url: record["url"],
    publishedAt: record["publishedAt"],
    lang: record["lang"],
  } as GgxMetaRecord;
}
