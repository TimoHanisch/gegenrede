// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Spec §9.3 — the pure half of the shared normalizer: canonical-schema
// mapping, derived ids, and verdict mapping. Embedding and upserting are
// I/O and live in ingest.ts so this stays hermetically testable.

import { createHash } from "node:crypto";

import { mapVerdict, type Verdict } from "@gegenrede/shared";

import { RawFactCheck } from "./connector.js";

/** Canonical record, pre-embedding. Column mapping mirrors schema §9.2. */
export interface NormalizedFactCheck {
  id: string;
  claimText: string;
  verdict: Verdict;
  ratingRaw: string;
  publisher: string;
  url: string;
  publishedAt: string | null;
  lang: string;
  dedupHash: string;
  source: string;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** §9.2 — `sha256(publisher|url)` hex, first 16 chars. */
export function factcheckId(publisher: string, url: string): string {
  return sha256Hex(`${publisher}|${url}`).slice(0, 16);
}

/** §9.2 — `sha256(lower(claim_text)|publisher)` hex. */
export function dedupHash(claimText: string, publisher: string): string {
  return sha256Hex(`${claimText.toLowerCase()}|${publisher}`);
}

/**
 * Validates a raw connector record and maps it onto the canonical schema.
 * Unknown publisher ratings fall back to `unproven` with a warning via
 * shared mapVerdict (§4.1) — the record is still ingested.
 */
export function normalizeRawFactCheck(
  raw: unknown,
  source: string,
  warn: (message: string) => void = console.warn,
): NormalizedFactCheck {
  const record = RawFactCheck.parse(raw);
  return {
    id: factcheckId(record.publisher, record.url),
    claimText: record.claimText,
    verdict: mapVerdict(record.publisher, record.ratingRaw, warn),
    ratingRaw: record.ratingRaw,
    publisher: record.publisher,
    url: record.url,
    publishedAt: record.publishedAt ?? null,
    lang: record.lang,
    dedupHash: dedupHash(record.claimText, record.publisher),
    source,
  };
}
