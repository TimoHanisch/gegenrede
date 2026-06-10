// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Spec §9.2 — the factchecks table, mirrored exactly. Stored fields are
// deliberately limited to claim + verdict + link metadata — no article
// bodies — keeping the dataset redistributable (architecture doc §3.3).
// Post-M1 changes to this schema require human approval (CLAUDE.md).

import {
  char,
  date,
  pgTable,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";

import { EMBEDDING_DIM } from "@gegenrede/shared";

export const factchecks = pgTable("factchecks", {
  /** `sha256(publisher|url)` hex, first 16 chars (§9.2). */
  id: text("id").primaryKey(),
  claimText: text("claim_text").notNull(),
  /** Canonical verdict enum value (§4.1); CHECK lives in app-level zod. */
  verdict: text("verdict").notNull(),
  ratingRaw: text("rating_raw").notNull(),
  publisher: text("publisher").notNull(),
  url: text("url").notNull().unique(),
  publishedAt: date("published_at"),
  lang: char("lang", { length: 2 }).notNull(),
  /** `sha256(lower(claim_text)|publisher)` hex (§9.2). */
  dedupHash: text("dedup_hash").notNull().unique(),
  embedding: vector("embedding", { dimensions: EMBEDDING_DIM }).notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Connector id, e.g. "google-factcheck" (§9.3). */
  source: text("source").notNull(),
});

export type FactcheckRow = typeof factchecks.$inferSelect;
export type FactcheckInsert = typeof factchecks.$inferInsert;
