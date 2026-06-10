// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Storage boundary for the shared normalizer. Unit tests run against the
// in-memory store (hermetic — CLAUDE.md Testing discipline); the Postgres
// implementation lives in db/store.ts behind the same interface.

import type { NormalizedFactCheck } from "./normalize.js";

/** A normalized record plus its `passage:` embedding, ready for §9.2. */
export interface FactcheckRecord extends NormalizedFactCheck {
  embedding: number[];
}

/**
 * Upsert semantics (§9.3 "dedups on dedup_hash, …, upserts"):
 * - same `id` (same publisher|url re-ingested) → update → "updated"
 * - different `id` but existing `dedup_hash` or `url` → skip → "skipped_dedup"
 * - otherwise insert → "inserted"
 */
export type UpsertOutcome = "inserted" | "updated" | "skipped_dedup";

export interface FactcheckStore {
  upsert(record: FactcheckRecord): Promise<UpsertOutcome>;
}

/** Hermetic reference implementation for tests and dry-runs. */
export class InMemoryFactcheckStore implements FactcheckStore {
  readonly rows = new Map<string, FactcheckRecord>();

  upsert(record: FactcheckRecord): Promise<UpsertOutcome> {
    const existing = this.rows.get(record.id);
    if (existing !== undefined) {
      this.rows.set(record.id, record);
      return Promise.resolve("updated");
    }
    for (const row of this.rows.values()) {
      if (row.dedupHash === record.dedupHash || row.url === record.url) {
        return Promise.resolve("skipped_dedup");
      }
    }
    this.rows.set(record.id, record);
    return Promise.resolve("inserted");
  }
}
