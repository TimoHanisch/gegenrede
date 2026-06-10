// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Spec §9.3 connector 1 — Google Fact Check Tools API (`claims:search`),
// the backbone source aggregating global ClaimReview markup. Pulls are
// paged per language (de, en) × known publisher domain: the API accepts a
// request only with `query` or `reviewPublisherSiteFilter`, so the
// per-domain pull is also what makes the call valid. Publisher domains are
// configuration (sources.json), never hardcoded.
//
// The endpoint and response shape follow the official API docs but are a
// known unknown (CLAUDE.md registry): the committed fixture is labeled
// `FIXTURE — UNVERIFIED SHAPE`, and the live integration test is skipped
// while GOOGLE_FC_API_KEY is unset.
//
// Hard Rule 4: the API key comes from the GOOGLE_FC_API_KEY env var only.
// The request URL carries the key, so neither the URL nor the key may ever
// appear in errors or logs. Hard Rule 5: claim text is never logged —
// warnings carry counts and pull coordinates (language, site, page) only.

import { z } from "zod";

import { RawFactCheck, type Connector } from "../connector.js";

export const CLAIMS_SEARCH_ENDPOINT =
  "https://factchecktools.googleapis.com/v1alpha1/claims:search";

export const GOOGLE_FC_API_KEY_ENV = "GOOGLE_FC_API_KEY";

// TODO(verify): response shape hand-written from the official docs
// (developers.google.com/fact-check/tools/api/reference/rest/v1alpha1/claims/search),
// not yet verified against a live response. Deliberately tolerant — every
// field is optional and unusable claim reviews are skipped one by one
// (counted, never logged) instead of failing the page.
const ClaimReviewShape = z.object({
  publisher: z
    .object({ name: z.string().optional(), site: z.string().optional() })
    .optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  reviewDate: z.string().optional(),
  textualRating: z.string().optional(),
  languageCode: z.string().optional(),
});

const ClaimShape = z.object({
  text: z.string().optional(),
  claimant: z.string().optional(),
  claimDate: z.string().optional(),
  claimReview: z.array(ClaimReviewShape).optional(),
});
export type GoogleClaim = z.infer<typeof ClaimShape>;

const ClaimsSearchPage = z.object({
  claims: z.array(z.unknown()).optional(),
  nextPageToken: z.string().optional(),
});

/** One `claims:search` response page (fixture + stub typing). */
export interface GoogleClaimsSearchPage {
  claims?: GoogleClaim[];
  nextPageToken?: string;
}

export interface GoogleFactcheckConnectorOptions {
  /** Publisher domains for `reviewPublisherSiteFilter` pulls (sources.json). */
  publisherSites: readonly string[];
  /** Defaults to `GOOGLE_FC_API_KEY` from the environment (Hard Rule 4). */
  apiKey?: string;
  languages?: readonly string[];
  pageSize?: number;
  /** Safety cap per language × site pull. */
  maxPagesPerPull?: number;
  fetchImpl?: typeof fetch;
  warn?: (message: string) => void;
}

/** §9.3 — the API's `maxAgeDays` window covering `since`, minimum 1. */
export function maxAgeDaysSince(since: Date, now = Date.now()): number {
  return Math.max(1, Math.ceil((now - since.getTime()) / 86_400_000));
}

/** "de-DE" → "de"; anything that isn't a two-letter primary subtag → undefined. */
function primaryLanguageSubtag(code: string | undefined): string | undefined {
  const subtag = code?.split("-")[0]?.toLowerCase();
  return subtag !== undefined && /^[a-z]{2}$/.test(subtag) ? subtag : undefined;
}

/** RFC3339 `reviewDate` → `YYYY-MM-DD`, or undefined when not date-shaped. */
function isoDateOf(reviewDate: string | undefined): string | undefined {
  return reviewDate !== undefined && /^\d{4}-\d{2}-\d{2}/.test(reviewDate)
    ? reviewDate.slice(0, 10)
    : undefined;
}

export class GoogleFactcheckConnector implements Connector {
  readonly id = "google-factcheck";

  private readonly publisherSites: readonly string[];
  private readonly apiKey: string | undefined;
  private readonly languages: readonly string[];
  private readonly pageSize: number;
  private readonly maxPagesPerPull: number;
  private readonly fetchImpl: typeof fetch;
  private readonly warn: (message: string) => void;

  constructor(options: GoogleFactcheckConnectorOptions) {
    this.publisherSites = options.publisherSites;
    this.apiKey = options.apiKey ?? process.env[GOOGLE_FC_API_KEY_ENV];
    this.languages = options.languages ?? ["de", "en"];
    this.pageSize = options.pageSize ?? 100;
    this.maxPagesPerPull = options.maxPagesPerPull ?? 50;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.warn = options.warn ?? console.warn;
  }

  async fetchSince(since: Date): Promise<RawFactCheck[]> {
    const apiKey = this.apiKey;
    if (apiKey === undefined || apiKey === "") {
      throw new Error(
        `[gegenrede] google-factcheck: missing API key — set ${GOOGLE_FC_API_KEY_ENV} (Hard Rule 4: env only, never code or fixtures)`,
      );
    }
    const maxAgeDays = maxAgeDaysSince(since);
    // The same review can surface in several pulls (e.g. a publisher rating
    // claims in both languages); dedup on publisher|url — the same key the
    // normalizer derives `id` from — so it is embedded only once per run.
    const byPublisherUrl = new Map<string, RawFactCheck>();
    for (const lang of this.languages) {
      for (const site of this.publisherSites) {
        await this.pullPaged(
          apiKey,
          lang,
          site,
          since,
          maxAgeDays,
          byPublisherUrl,
        );
      }
    }
    return [...byPublisherUrl.values()];
  }

  private async pullPaged(
    apiKey: string,
    lang: string,
    site: string,
    since: Date,
    maxAgeDays: number,
    out: Map<string, RawFactCheck>,
  ): Promise<void> {
    let pageToken: string | undefined;
    for (let page = 0; page < this.maxPagesPerPull; page += 1) {
      const url = new URL(CLAIMS_SEARCH_ENDPOINT);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("languageCode", lang);
      url.searchParams.set("reviewPublisherSiteFilter", site);
      url.searchParams.set("pageSize", String(this.pageSize));
      url.searchParams.set("maxAgeDays", String(maxAgeDays));
      if (pageToken !== undefined) {
        url.searchParams.set("pageToken", pageToken);
      }
      const response = await this.fetchImpl(url);
      if (!response.ok) {
        // The request URL carries the API key — report the status and pull
        // coordinates only, never the URL (Hard Rule 4).
        throw new Error(
          `[gegenrede] google-factcheck: claims:search failed with HTTP ${response.status} (lang=${lang}, site=${site}, page=${page})`,
        );
      }
      const body = ClaimsSearchPage.parse(await response.json());
      this.collectPage(body.claims ?? [], lang, site, page, since, out);
      pageToken = body.nextPageToken;
      if (pageToken === undefined) {
        return;
      }
    }
    this.warn(
      `[gegenrede] google-factcheck: page cap (${this.maxPagesPerPull}) reached before nextPageToken ran out (lang=${lang}, site=${site}) — older records left for the next pull`,
    );
  }

  private collectPage(
    claims: readonly unknown[],
    lang: string,
    site: string,
    page: number,
    since: Date,
    out: Map<string, RawFactCheck>,
  ): void {
    let skipped = 0;
    for (const rawClaim of claims) {
      const parsed = ClaimShape.safeParse(rawClaim);
      if (!parsed.success) {
        skipped += 1;
        continue;
      }
      const claim = parsed.data;
      for (const review of claim.claimReview ?? []) {
        const reviewTime =
          review.reviewDate === undefined
            ? Number.NaN
            : Date.parse(review.reviewDate);
        // `maxAgeDays` already bounds the pull server-side; this client-side
        // check keeps the day-granular window honest around `since`.
        if (!Number.isNaN(reviewTime) && reviewTime < since.getTime()) {
          continue;
        }
        const record = toRawFactCheck(claim, review, lang);
        if (record === null) {
          skipped += 1;
          continue;
        }
        out.set(`${record.publisher}|${record.url}`, record);
      }
    }
    if (skipped > 0) {
      // Hard Rule 5: count only — never claim text or URLs.
      this.warn(
        `[gegenrede] google-factcheck: skipped ${skipped} unusable claim review(s) (lang=${lang}, site=${site}, page=${page})`,
      );
    }
  }
}

function toRawFactCheck(
  claim: GoogleClaim,
  review: z.infer<typeof ClaimReviewShape>,
  requestLang: string,
): RawFactCheck | null {
  const candidate = {
    claimText: claim.text,
    ratingRaw: review.textualRating,
    publisher: review.publisher?.name ?? review.publisher?.site,
    url: review.url,
    publishedAt: isoDateOf(review.reviewDate),
    lang: primaryLanguageSubtag(review.languageCode) ?? requestLang,
  };
  const parsed = RawFactCheck.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
