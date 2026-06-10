// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Hermetic connector tests: stubbed fetch serving the hand-assembled
// Hydra fixture (FIXTURE — UNVERIFIED SHAPE), no network (CLAUDE.md
// Testing discipline).

import { describe, expect, it } from "vitest";

import {
  EMBEDDING_DIM,
  initEmbedding,
  resetEmbedding,
} from "@gegenrede/shared";

import { ingestRawFactChecks } from "../ingest.js";
import { InMemoryFactcheckStore } from "../store.js";
import {
  ELECTIONS_URL,
  euvsdisinfoClaimsPages,
  euvsdisinfoReviewPages,
  FIXTURE_API_BASE,
  LABORATORIES_URL,
  UMBRELLAS_URL,
} from "../fixtures/euvsdisinfo-export.js";
import {
  EUVSDISINFO_DEFAULT_RATING,
  EUVSDISINFO_PUBLISHER,
  EuvsdisinfoConnector,
  type EuvsdisinfoConnectorOptions,
  type EuvsdisinfoHydraPage,
} from "./euvsdisinfo.js";

const SINCE = new Date("2026-05-01T00:00:00Z");

/** Serves fixture pages by collection pathname; the `page` query param
 * (carried by `hydra:next`) selects the page. Records every request URL
 * and its Accept header for assertions. */
function stubFetch(
  claimsPages: readonly EuvsdisinfoHydraPage[],
  reviewPages: readonly EuvsdisinfoHydraPage[],
): {
  requests: { url: URL; accept: string | null }[];
  fetchImpl: typeof fetch;
} {
  const requests: { url: URL; accept: string | null }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    const headers = new Headers(
      input instanceof Request ? input.headers : init?.headers,
    );
    requests.push({ url, accept: headers.get("accept") });
    const pages =
      url.pathname === "/claim_reviews" ? reviewPages : claimsPages;
    const pageParam = url.searchParams.get("page");
    const index = pageParam === null ? 0 : Number(pageParam) - 1;
    return Promise.resolve(
      new Response(JSON.stringify(pages[index] ?? {}), {
        status: 200,
        headers: { "content-type": "application/ld+json" },
      }),
    );
  };
  return { requests, fetchImpl };
}

function connector(
  overrides: Partial<EuvsdisinfoConnectorOptions> = {},
): EuvsdisinfoConnector {
  return new EuvsdisinfoConnector({
    apiBaseUrl: FIXTURE_API_BASE,
    ...overrides,
  });
}

describe("EuvsdisinfoConnector", () => {
  it("pulls claims then claim_reviews with date filters, following hydra:next", async () => {
    const { requests, fetchImpl } = stubFetch(
      euvsdisinfoClaimsPages,
      euvsdisinfoReviewPages,
    );
    await connector({ fetchImpl, warn: () => {} }).fetchSince(SINCE);

    // claims has two fixture pages, claim_reviews one → three requests.
    expect(requests.map((r) => r.url.pathname)).toEqual([
      "/claims",
      "/claims",
      "/claim_reviews",
    ]);
    const [claimsFirst, claimsSecond, reviews] = requests;
    expect(claimsFirst?.url.searchParams.get("datePublished[after]")).toBe(
      "2026-05-01",
    );
    expect(claimsSecond?.url.searchParams.get("page")).toBe("2");
    expect(
      reviews?.url.searchParams.get("itemReviewed.datePublished[after]"),
    ).toBe("2026-05-01");
    for (const request of requests) {
      expect(request.url.origin).toBe(FIXTURE_API_BASE);
      expect(request.accept).toBe("application/ld+json");
    }
  });

  it("joins claims with reviews in both link directions and maps onto RawFactCheck", async () => {
    const { fetchImpl } = stubFetch(
      euvsdisinfoClaimsPages,
      euvsdisinfoReviewPages,
    );
    const records = await connector({ fetchImpl, warn: () => {} }).fetchSince(
      SINCE,
    );

    // claims → reviews direction, object-shaped reviewRating.
    const laboratories = records.find((r) => r.url === LABORATORIES_URL);
    expect(laboratories).toEqual({
      claimText:
        "Exampleland is allegedly running secret laboratories abroad.",
      ratingRaw: "disinfo",
      publisher: EUVSDISINFO_PUBLISHER,
      url: LABORATORIES_URL,
      publishedAt: "2026-05-14",
      lang: "en",
    });
    // reviews → claims direction, string-shaped reviewRating.
    const elections = records.find((r) => r.url === ELECTIONS_URL);
    expect(elections?.ratingRaw).toBe("misleading");
    // No reviewRating → database-wide default rating.
    const umbrellas = records.find((r) => r.url === UMBRELLAS_URL);
    expect(umbrellas?.ratingRaw).toBe(EUVSDISINFO_DEFAULT_RATING);
  });

  it("honors the lang override for emitted records", async () => {
    const { fetchImpl } = stubFetch(
      euvsdisinfoClaimsPages,
      euvsdisinfoReviewPages,
    );
    const records = await connector({
      fetchImpl,
      warn: () => {},
      lang: "de",
    }).fetchSince(SINCE);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.lang).toBe("de");
    }
  });

  it("filters records older than `since` and counts unusable members without logging text", async () => {
    const warnings: string[] = [];
    const { fetchImpl } = stubFetch(
      euvsdisinfoClaimsPages,
      euvsdisinfoReviewPages,
    );
    const records = await connector({
      fetchImpl,
      warn: (m) => warnings.push(m),
    }).fetchSince(SINCE);

    // Fixture: 5 claims → 1 older than since, 1 without any review → 3.
    expect(records).toHaveLength(3);
    expect(records.some((r) => r.url.endsWith("/exampleland-currency"))).toBe(
      false,
    );

    // Claim without a review + the non-object review member, counts only.
    expect(warnings).toEqual([
      "[gegenrede] euvsdisinfo: skipped 2 unusable record(s)",
    ]);
    expect(warnings.join("\n")).not.toContain("Exampleland");
  });

  it("stops at the page cap with a warning instead of pulling forever", async () => {
    const warnings: string[] = [];
    const { requests, fetchImpl } = stubFetch(
      euvsdisinfoClaimsPages,
      euvsdisinfoReviewPages,
    );
    await connector({
      fetchImpl,
      warn: (m) => warnings.push(m),
      maxPagesPerPull: 1,
    }).fetchSince(SINCE);

    expect(
      requests.filter((r) => r.url.pathname === "/claims"),
    ).toHaveLength(1);
    expect(
      warnings.filter((m) => m.includes("page cap (1) reached")),
    ).toHaveLength(1);
  });

  it("throws on HTTP errors with the pull coordinates", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response("nope", { status: 502 }));
    await expect(connector({ fetchImpl }).fetchSince(SINCE)).rejects.toThrow(
      /HTTP 502 \(page=0\)/,
    );
  });

  it("feeds the shared normalizer: ratings map to false/misleading (§9.3)", async () => {
    const provider = {
      embed: (text: string) => {
        const vector = new Float32Array(EMBEDDING_DIM);
        vector.fill((text.length % 13) / 13 + 0.01);
        return Promise.resolve(vector);
      },
    };
    initEmbedding(provider);
    try {
      const { fetchImpl } = stubFetch(
        euvsdisinfoClaimsPages,
        euvsdisinfoReviewPages,
      );
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
      const verdictsByUrl = new Map(
        [...store.rows.values()].map((row) => [row.url, row.verdict]),
      );
      expect(verdictsByUrl.get(LABORATORIES_URL)).toBe("false");
      expect(verdictsByUrl.get(ELECTIONS_URL)).toBe("misleading");
      expect(verdictsByUrl.get(UMBRELLAS_URL)).toBe("false");
      // Every fixture rating is mapped — no §4.1 fallback warnings.
      expect(
        warnings.filter((m) => m.includes("unmapped publisher rating")),
      ).toHaveLength(0);
      for (const row of store.rows.values()) {
        expect(row.source).toBe("euvsdisinfo");
      }
    } finally {
      resetEmbedding();
    }
  });
});
