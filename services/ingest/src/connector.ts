// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Spec §9.3 — every source connector implements `fetchSince` and returns raw
// records; the shared normalizer (normalize.ts + ingest.ts) does everything
// else. RawFactCheck is intra-service (connector → normalizer), so it lives
// here rather than in packages/shared (spec §3 covers cross-boundary
// payloads only).
//
// There is deliberately no field for article bodies: connectors can only
// hand over claim + verdict + link metadata (§9.2 rationale, architecture
// doc §3.3).

import { z } from "zod";

export const RawFactCheck = z.object({
  claimText: z.string().min(1),
  ratingRaw: z.string().min(1),
  publisher: z.string().min(1), // e.g. "Correctiv", "dpa-Faktencheck"
  url: z.string().url(),
  publishedAt: z.string().date().optional(),
  lang: z.string().length(2),
});
export type RawFactCheck = z.infer<typeof RawFactCheck>;

/** Spec §9.3 — `fetchSince(date): RawFactCheck[]`, async for I/O. */
export interface Connector {
  /** Connector id, recorded in the `source` column (e.g. "google-factcheck"). */
  readonly id: string;
  fetchSince(since: Date): Promise<RawFactCheck[]>;
}
