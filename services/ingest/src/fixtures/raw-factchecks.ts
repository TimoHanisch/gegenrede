// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Hand-written RawFactCheck fixture for normalizer tests. All data is
// synthetic: invented publishers, example.org URLs, no real user handles
// (CLAUDE.md Testing discipline). This exercises our own connector
// contract, not any external API shape.

import type { RawFactCheck } from "../connector.js";

export const FIXTURE_SOURCE = "fixture-connector";

export const rawFactcheckFixture: RawFactCheck[] = [
  {
    claimText: "Beispielstadt hat im Winter alle Laternen abgeschaltet.",
    ratingRaw: "Frei erfunden",
    publisher: "Beispiel-Faktencheck",
    url: "https://factcheck.example.org/laternen-abgeschaltet",
    publishedAt: "2026-01-12",
    lang: "de",
  },
  {
    // Same claim text (different casing) and publisher as the record above,
    // but a different URL → same dedup_hash, different id → must be skipped.
    claimText: "BEISPIELSTADT hat im Winter alle Laternen abgeschaltet.",
    ratingRaw: "Frei erfunden",
    publisher: "Beispiel-Faktencheck",
    url: "https://factcheck.example.org/laternen-abgeschaltet-archiv",
    publishedAt: "2026-01-13",
    lang: "de",
  },
  {
    // Rating with no VERDICT_MAP entry → `unproven` fallback + warning.
    claimText: "Example town banned bicycles on all streets.",
    ratingRaw: "Completely Unheard Of Rating",
    publisher: "Example Fact Check",
    url: "https://factcheck.example.org/bicycle-ban",
    lang: "en",
  },
];
