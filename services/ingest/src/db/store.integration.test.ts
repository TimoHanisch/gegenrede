// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Integration-only — skipped unless DATABASE_URL is set: needs the local
// Postgres 17 + pgvector dev container (README.md) with migrations applied
// (`pnpm db:migrate`). Hermetic CI has no database (CLAUDE.md Testing
// discipline); hermetic upsert coverage lives in ../ingest.test.ts against
// the in-memory store.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { EMBEDDING_DIM } from "@gegenrede/shared";

import type { FactcheckRecord } from "../store.js";
import { factchecks } from "./schema.js";
import {
  connectIngestDatabase,
  DrizzleFactcheckStore,
  type IngestDatabase,
} from "./store.js";

const DATABASE_URL = process.env["DATABASE_URL"];

function record(overrides: Partial<FactcheckRecord>): FactcheckRecord {
  return {
    id: "itest000000000a1",
    claimText: "Integrationstest-Behauptung A",
    verdict: "unproven",
    ratingRaw: "Frei erfunden",
    publisher: "Beispiel-Faktencheck",
    url: "https://factcheck.example.org/integration-a",
    publishedAt: "2026-01-12",
    lang: "de",
    dedupHash: "itest-dedup-a".padEnd(64, "0"),
    source: "fixture-connector",
    embedding: Array.from({ length: EMBEDDING_DIM }, () => 0.05),
    ...overrides,
  };
}

const TEST_IDS = ["itest000000000a1", "itest000000000b2"];

describe.skipIf(DATABASE_URL === undefined)(
  "DrizzleFactcheckStore (integration, Postgres + pgvector)",
  () => {
    // Connected in beforeAll: the describe body also runs when the suite is
    // skipped, and a connection must not be opened in hermetic runs.
    let db: IngestDatabase;
    let close: () => Promise<void>;
    let store: DrizzleFactcheckStore;

    beforeAll(() => {
      ({ db, close } = connectIngestDatabase(DATABASE_URL as string));
      store = new DrizzleFactcheckStore(db);
    });

    afterAll(async () => {
      await db.delete(factchecks).where(inArray(factchecks.id, TEST_IDS));
      await close();
    });

    it("inserts, updates on same id, and skips dedup collisions", async () => {
      await db.delete(factchecks).where(inArray(factchecks.id, TEST_IDS));

      expect(await store.upsert(record({}))).toBe("inserted");
      expect(
        await store.upsert(record({ ratingRaw: "Frei erfunden (neu)" })),
      ).toBe("updated");

      // Different id + url, same dedup_hash → skipped, not stored.
      expect(
        await store.upsert(
          record({
            id: "itest000000000b2",
            url: "https://factcheck.example.org/integration-a-archiv",
          }),
        ),
      ).toBe("skipped_dedup");

      const rows = await db
        .select()
        .from(factchecks)
        .where(inArray(factchecks.id, TEST_IDS));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.ratingRaw).toBe("Frei erfunden (neu)");
      expect(rows[0]?.embedding).toHaveLength(EMBEDDING_DIM);
    });
  },
);
