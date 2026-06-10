// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Hermetic connector tests: stubbed fetch serving the hand-written
// `claims:search` fixture (FIXTURE — UNVERIFIED SHAPE), no network
// (CLAUDE.md Testing discipline). The key used here is a synthetic test
// string, not a credential (Hard Rule 4).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMBEDDING_DIM,
  initEmbedding,
  resetEmbedding,
} from "@gegenrede/shared";

import { ingestRawFactChecks } from "../ingest.js";
import { InMemoryFactcheckStore } from "../store.js";
import {
  FIXTURE_PUBLISHER_SITE,
  googleFactcheckPagesByLang,
  SCHULEN_URL,
} from "../fixtures/google-factcheck-response.js";
import {
  GOOGLE_FC_API_KEY_ENV,
  GoogleFactcheckConnector,
  maxAgeDaysSince,
  type GoogleClaimsSearchPage,
  type GoogleFactcheckConnectorOptions,
} from "./google-factcheck.js";

const TEST_KEY = "test-key-not-a-credential";
const NOW = new Date("2026-06-01T12:00:00Z");
const SINCE = new Date("2026-05-01T00:00:00Z");

/** Serves fixture pages; `pageToken` is resolved to "the page after the one
 * that announced this token". Records every request URL for assertions. */
function stubFetch(pagesByLang: Record<string, GoogleClaimsSearchPage[]>): {
  requests: URL[];
  fetchImpl: typeof fetch;
} {
  const requests: URL[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    requests.push(url);
    const pages = pagesByLang[url.searchParams.get("languageCode") ?? ""] ?? [
      {},
    ];
    const token = url.searchParams.get("pageToken");
    const index =
      token === null
        ? 0
        : pages.findIndex((page) => page.nextPageToken === token) + 1;
    return Promise.resolve(
      new Response(JSON.stringify(pages[index] ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { requests, fetchImpl };
}

function connector(
  overrides: Partial<GoogleFactcheckConnectorOptions> = {},
): GoogleFactcheckConnector {
  return new GoogleFactcheckConnector({
    publisherSites: [FIXTURE_PUBLISHER_SITE],
    apiKey: TEST_KEY,
    ...overrides,
  });
}

describe("GoogleFactcheckConnector", () => {
  let envKey: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    envKey = process.env[GOOGLE_FC_API_KEY_ENV];
    delete process.env[GOOGLE_FC_API_KEY_ENV];
  });

  afterEach(() => {
    vi.useRealTimers();
    if (envKey === undefined) delete process.env[GOOGLE_FC_API_KEY_ENV];
    else process.env[GOOGLE_FC_API_KEY_ENV] = envKey;
  });

  it("pulls per language × publisher site and follows nextPageToken", async () => {
    const { requests, fetchImpl } = stubFetch(googleFactcheckPagesByLang);
    await connector({ fetchImpl }).fetchSince(SINCE);

    // de has two fixture pages, en one → three requests for one site.
    expect(requests).toHaveLength(3);
    expect(requests.map((u) => u.searchParams.get("languageCode"))).toEqual([
      "de",
      "de",
      "en",
    ]);
    expect(requests.map((u) => u.searchParams.get("pageToken"))).toEqual([
      null,
      "fixture-de-page-2",
      null,
    ]);
    for (const url of requests) {
      expect(url.origin + url.pathname).toBe(
        "https://factchecktools.googleapis.com/v1alpha1/claims:search",
      );
      expect(url.searchParams.get("key")).toBe(TEST_KEY);
      expect(url.searchParams.get("reviewPublisherSiteFilter")).toBe(
        FIXTURE_PUBLISHER_SITE,
      );
      expect(url.searchParams.get("pageSize")).toBe("100");
      // 2026-05-01 → 2026-06-01T12:00Z is 31.5 days → ceil → 32.
      expect(url.searchParams.get("maxAgeDays")).toBe("32");
    }
  });

  it("maps claim reviews onto RawFactCheck, normalizing language subtags", async () => {
    const { fetchImpl } = stubFetch(googleFactcheckPagesByLang);
    const records = await connector({ fetchImpl, warn: () => {} }).fetchSince(
      SINCE,
    );

    const schulen = records.find((r) => r.url === SCHULEN_URL);
    expect(schulen).toEqual({
      claimText:
        "Beispielstadt hat angeblich alle Schulen dauerhaft geschlossen.",
      ratingRaw: "Frei erfunden",
      publisher: "Beispiel-Faktencheck",
      url: SCHULEN_URL,
      publishedAt: "2026-05-20",
      lang: "de",
    });
    // "de-DE" / "en-US" → primary subtag.
    const parks = records.find((r) => r.url.endsWith("/parks-privatisiert"));
    expect(parks?.lang).toBe("de");
    const bicycles = records.find((r) => r.url.endsWith("/bicycle-ban"));
    expect(bicycles?.lang).toBe("en");
  });

  it("filters reviews older than `since`, skips unusable ones, dedups publisher|url across pulls", async () => {
    const warnings: string[] = [];
    const { fetchImpl } = stubFetch(googleFactcheckPagesByLang);
    const records = await connector({
      fetchImpl,
      warn: (m) => warnings.push(m),
    }).fetchSince(SINCE);

    // Fixture: 7 claim reviews → 1 too old, 1 without rating, 1 invalid URL,
    // 1 duplicate publisher|url → 3 records.
    expect(records).toHaveLength(3);
    expect(records.filter((r) => r.url === SCHULEN_URL)).toHaveLength(1);
    expect(records.some((r) => r.url.endsWith("/brunnen"))).toBe(false);

    // One unusable review on each de page, counted in warnings.
    expect(
      warnings.filter((m) => m.includes("skipped 1 unusable claim review")),
    ).toHaveLength(2);
  });

  it("never logs claim text or the API key (Hard Rules 4+5)", async () => {
    const warnings: string[] = [];
    const { fetchImpl } = stubFetch(googleFactcheckPagesByLang);
    await connector({
      fetchImpl,
      warn: (m) => warnings.push(m),
      maxPagesPerPull: 1, // also trip the page-cap warning path
    }).fetchSince(SINCE);

    const logged = warnings.join("\n");
    expect(logged).not.toContain("Beispielstadt");
    expect(logged).not.toContain("Example town");
    expect(logged).not.toContain(TEST_KEY);
    expect(logged).toContain("page cap (1) reached");
  });

  it("throws on HTTP errors with status + pull coordinates, never the request URL", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response("denied", { status: 403 }));
    const promise = connector({ fetchImpl }).fetchSince(SINCE);

    await expect(promise).rejects.toThrowError(/HTTP 403/);
    await expect(promise).rejects.not.toThrowError(new RegExp(TEST_KEY));
  });

  it("requires GOOGLE_FC_API_KEY and reads it from the environment by default", async () => {
    const { requests, fetchImpl } = stubFetch(googleFactcheckPagesByLang);

    await expect(
      connector({ apiKey: undefined, fetchImpl }).fetchSince(SINCE),
    ).rejects.toThrowError(new RegExp(GOOGLE_FC_API_KEY_ENV));

    process.env[GOOGLE_FC_API_KEY_ENV] = "env-test-key";
    await connector({ apiKey: undefined, fetchImpl }).fetchSince(SINCE);
    expect(requests.at(-1)?.searchParams.get("key")).toBe("env-test-key");
  });

  it("feeds the shared normalizer: unmapped ratings land on `unproven` with a warning (§4.1)", async () => {
    const provider = {
      embed: (text: string) => {
        const vector = new Float32Array(EMBEDDING_DIM);
        vector.fill((text.length % 13) / 13 + 0.01);
        return Promise.resolve(vector);
      },
    };
    initEmbedding(provider);
    try {
      const { fetchImpl } = stubFetch(googleFactcheckPagesByLang);
      const fc = connector({ fetchImpl, warn: () => {} });
      const records = await fc.fetchSince(SINCE);

      const store = new InMemoryFactcheckStore();
      const warnings: string[] = [];
      const counters = await ingestRawFactChecks(records, fc.id, store, (m) =>
        warnings.push(m),
      );

      expect(counters).toEqual({
        inserted: 3,
        updated: 0,
        skippedDedup: 0,
        invalid: 0,
      });
      // VERDICT_MAP has no verified publisher entries yet (known unknown) —
      // every fixture rating must take the `unproven` fallback, warned.
      for (const row of store.rows.values()) {
        expect(row.verdict).toBe("unproven");
        expect(row.source).toBe("google-factcheck");
      }
      expect(
        warnings.filter((m) => m.includes("unmapped publisher rating")),
      ).toHaveLength(3);
    } finally {
      resetEmbedding();
    }
  });
});

describe("maxAgeDaysSince", () => {
  it("covers the window with a ceiling and a floor of one day", () => {
    const now = Date.parse("2026-06-01T12:00:00Z");
    expect(maxAgeDaysSince(new Date("2026-05-01T00:00:00Z"), now)).toBe(32);
    expect(maxAgeDaysSince(new Date("2026-06-01T11:00:00Z"), now)).toBe(1);
    expect(maxAgeDaysSince(new Date("2026-06-02T00:00:00Z"), now)).toBe(1);
  });
});
