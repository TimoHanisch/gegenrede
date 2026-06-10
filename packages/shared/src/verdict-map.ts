// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { Verdict } from "./taxonomies.js";

// Spec §4.1 — maps heterogeneous publisher ratings to the canonical verdict
// set. Keys are `${publisher}:${ratingRaw}`, lowercased.
//
// TODO(verify): real publisher rating strings (Correctiv, dpa-Faktencheck,
// AFP DE, BR24 Faktenfuchs, …) are a known unknown; entries land with the
// ingest fixtures rather than being invented here (CLAUDE.md Hard Rule 3).
export const VERDICT_MAP: Record<string, Verdict> = {
  // EUvsDisinfo (spec §9.3 connector 2): every database entry is a
  // disinformation case, so its ratings map to false/misleading only.
  // TODO(verify): rating strings taken from the euvsdisinfo connector's
  // fixture sample (FIXTURE — UNVERIFIED SHAPE); confirm the real
  // reviewRating values when the export shape is verified.
  "euvsdisinfo:disinfo": "false",
  "euvsdisinfo:misleading": "misleading",
};

export function verdictMapKey(publisher: string, ratingRaw: string): string {
  return `${publisher}:${ratingRaw}`.toLowerCase();
}

/**
 * Resolve a publisher rating to a canonical verdict. Unknown ratings fall back
 * to `unproven` with a warning — never guessing toward `false` (spec §4.1).
 * The warning names only the unmapped key, never post text (Hard Rule 5).
 */
export function mapVerdict(
  publisher: string,
  ratingRaw: string,
  warn: (message: string) => void = console.warn,
): Verdict {
  const key = verdictMapKey(publisher, ratingRaw);
  const verdict = VERDICT_MAP[key];
  if (verdict !== undefined) {
    return verdict;
  }
  warn(
    `[gegenrede] unmapped publisher rating "${key}"; falling back to "unproven"`,
  );
  return Verdict.enum.unproven;
}
