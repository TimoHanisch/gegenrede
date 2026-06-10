// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Postgres implementation of FactcheckStore over the §9.2 schema. Single
// nightly ingest process (§9.3) — the read-then-write upsert needs no
// concurrency guard; the UNIQUE constraints remain the backstop.

import { eq, or } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type {
  FactcheckRecord,
  FactcheckStore,
  UpsertOutcome,
} from "../store.js";
import { factchecks } from "./schema.js";

export type IngestDatabase = PostgresJsDatabase<{
  factchecks: typeof factchecks;
}>;

export function connectIngestDatabase(databaseUrl: string): {
  db: IngestDatabase;
  close: () => Promise<void>;
} {
  const client = postgres(databaseUrl);
  const db = drizzle(client, { schema: { factchecks } });
  return { db, close: () => client.end() };
}

export class DrizzleFactcheckStore implements FactcheckStore {
  constructor(private readonly db: IngestDatabase) {}

  async upsert(record: FactcheckRecord): Promise<UpsertOutcome> {
    const { id, ...columns } = record;
    const byId = await this.db
      .select({ id: factchecks.id })
      .from(factchecks)
      .where(eq(factchecks.id, id))
      .limit(1);
    if (byId.length > 0) {
      await this.db
        .update(factchecks)
        .set(columns)
        .where(eq(factchecks.id, id));
      return "updated";
    }
    const byDedup = await this.db
      .select({ id: factchecks.id })
      .from(factchecks)
      .where(
        or(
          eq(factchecks.dedupHash, record.dedupHash),
          eq(factchecks.url, record.url),
        ),
      )
      .limit(1);
    if (byDedup.length > 0) {
      return "skipped_dedup";
    }
    await this.db.insert(factchecks).values({ id, ...columns });
    return "inserted";
  }
}
