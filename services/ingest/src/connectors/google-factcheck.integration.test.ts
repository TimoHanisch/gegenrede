// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Integration-only — skipped unless GOOGLE_FC_API_KEY is set (CLAUDE.md
// known-unknowns registry): hermetic CI never touches the network, and the
// committed response fixture is `FIXTURE — UNVERIFIED SHAPE` until this
// suite has run against the live API. Needs a free Fact Check Tools API
// key in the env; hermetic coverage lives in ./google-factcheck.test.ts.

import { describe, expect, it } from "vitest";

import { RawFactCheck } from "../connector.js";
import { loadSources } from "../sources.js";
import {
  GOOGLE_FC_API_KEY_ENV,
  GoogleFactcheckConnector,
} from "./google-factcheck.js";

const GOOGLE_FC_API_KEY = process.env[GOOGLE_FC_API_KEY_ENV];

describe.skipIf(GOOGLE_FC_API_KEY === undefined)(
  "GoogleFactcheckConnector (integration, live claims:search — skipped: GOOGLE_FC_API_KEY unset)",
  () => {
    it("pulls a recent window and every record satisfies RawFactCheck", async () => {
      const connector = new GoogleFactcheckConnector({
        publisherSites: loadSources().googleFactcheck.publisherSites,
        languages: ["de"],
        maxPagesPerPull: 2,
      });
      const since = new Date(Date.now() - 30 * 86_400_000);

      // TODO(verify): this is the check that retires the UNVERIFIED SHAPE
      // label on the fixture — run it once a key is available and compare.
      const records = await connector.fetchSince(since);
      expect(Array.isArray(records)).toBe(true);
      for (const record of records) {
        expect(() => RawFactCheck.parse(record)).not.toThrow();
      }
    }, 60_000);
  },
);
