// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { z } from "zod";

import { Technique, Verdict } from "./taxonomies.js";

// Spec §4.3 — core types. Cross-boundary payloads import these instead of
// redeclaring them (spec §3).

export const ExtractedPost = z.object({
  text: z.string().min(8).max(8000),
  url: z.string().url(),
  lang: z.string().length(2).optional(), // detected later if absent
  platform: z.enum(["x", "reddit", "generic"]),
  authorHandle: z.string().optional(), // NEVER transmitted; local display only
});
export type ExtractedPost = z.infer<typeof ExtractedPost>;

export const FactCheckMatch = z.object({
  id: z.string(),
  claim: z.string(),
  verdict: Verdict,
  ratingRaw: z.string(),
  publisher: z.string(), // e.g. "Correctiv", "dpa-Faktencheck"
  url: z.string().url(),
  publishedAt: z.string().date(),
  lang: z.string().length(2),
  score: z.number().min(0).max(1), // cosine similarity
});
export type FactCheckMatch = z.infer<typeof FactCheckMatch>;

export const CheckResult = z.object({
  normalizedClaim: z.string(),
  matches: z.array(FactCheckMatch).max(5),
  techniqueHints: z.array(Technique).max(3),
  matcher: z.enum(["local", "server"]),
  snapshotVersion: z.string(),
});
export type CheckResult = z.infer<typeof CheckResult>;
