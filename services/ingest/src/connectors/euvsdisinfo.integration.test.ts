// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Integration-only — skipped unless EUVSDISINFO_LIVE_TEST is set
// (CLAUDE.md known-unknowns registry): the export shape is unverified and
// the documented host (api.veedoo.io) is likely retired — research and
// route decision tracked in #70 — and hermetic CI never touches the
// network. Hermetic coverage lives in ./euvsdisinfo.test.ts.

import { describe, expect, it } from "vitest";

import { RawFactCheck } from "../connector.js";
import { loadSources } from "../sources.js";
import { EuvsdisinfoConnector } from "./euvsdisinfo.js";

const EUVSDISINFO_LIVE_TEST = process.env["EUVSDISINFO_LIVE_TEST"];

describe.skipIf(EUVSDISINFO_LIVE_TEST === undefined)(
  "EuvsdisinfoConnector (integration, live export — skipped: EUvsDisinfo export shape unverified, set EUVSDISINFO_LIVE_TEST=1 once the endpoint is confirmed)",
  () => {
    it("pulls a recent window and every record satisfies RawFactCheck", async () => {
      const connector = new EuvsdisinfoConnector({
        apiBaseUrl: loadSources().euvsdisinfo.apiBaseUrl,
        maxPagesPerPull: 2,
      });
      const since = new Date(Date.now() - 30 * 86_400_000);

      // TODO(verify): #70 — this is the check that retires the UNVERIFIED
      // SHAPE label on the fixture — run it once the export endpoint is
      // confirmed reachable (#70), and compare the real member fields and
      // reviewRating strings against fixture + VERDICT_MAP.
      const records = await connector.fetchSince(since);
      expect(Array.isArray(records)).toBe(true);
      for (const record of records) {
        expect(() => RawFactCheck.parse(record)).not.toThrow();
      }
    }, 60_000);
  },
);
