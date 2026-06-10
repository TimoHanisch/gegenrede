// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Spec §9.3 connector 2 — EUvsDisinfo public database export, pulled
// weekly. The cadence is expressed entirely through `fetchSince` (the
// caller passes the last pull date); scheduling itself lands with the
// cron sidecar (#52).
//
// The export shape is a known unknown (CLAUDE.md registry). Everything
// here is assembled from the shape documented by the euvsdisinfoR API
// wrapper (github.com/corriebar/euvsdisinfoR): a JSON-LD/Hydra API with
// `claims` and `claim_reviews` collections, `datePublished[after]`
// filters, and `hydra:view` → `hydra:next` paging.
// TODO(verify): the documented base (api.veedoo.io, sources.json) did not
// resolve from the dev environment on 2026-06-10 — confirm the current
// public export (endpoint, member fields, reviewRating strings), then
// retire the UNVERIFIED SHAPE label on the fixture and the skip on the
// live integration test.
//
// Hard Rule 5: claim text is never logged — warnings carry counts and
// pull coordinates (collection path, page) only.

import { z } from "zod";

import { RawFactCheck, type Connector } from "../connector.js";

/** `RawFactCheck.publisher` for every record — per-record attribution
 * routes to EUvsDisinfo as the reviewing organization (licensing.md). */
export const EUVSDISINFO_PUBLISHER = "EUvsDisinfo";

/**
 * Every entry in the EUvsDisinfo database is by definition a
 * disinformation case, so a review without an explicit `reviewRating`
 * falls back to this string; the verdict mapping (§9.3: `false` /
 * `misleading`) lives in shared VERDICT_MAP. TODO(verify): real rating
 * strings are part of the unverified export shape.
 */
export const EUVSDISINFO_DEFAULT_RATING = "disinfo";

// TODO(verify): member shapes hand-assembled from the euvsdisinfoR
// wrapper's column names, not from a live response (CLAUDE.md Hard
// Rule 3). Deliberately tolerant — every field is optional and unusable
// members are skipped one by one (counted, never logged) instead of
// failing the page.
const ClaimMember = z.object({
  "@id": z.string().optional(),
  text: z.string().optional(),
  datePublished: z.string().optional(),
  /** IRI of the claim's review (claims → claim_reviews direction). */
  claimReview: z.string().optional(),
});
export type EuvsdisinfoClaim = z.infer<typeof ClaimMember>;

// schema.org Rating is an object; tolerate a bare string too.
const ReviewRating = z.union([
  z.string(),
  z.object({
    alternateName: z.string().optional(),
    name: z.string().optional(),
  }),
]);

const ReviewMember = z.object({
  "@id": z.string().optional(),
  /** IRI of the reviewed claim (claim_reviews → claims direction). */
  itemReviewed: z.string().optional(),
  /** The EUvsDisinfo case page — becomes `RawFactCheck.url`. */
  url: z.string().optional(),
  datePublished: z.string().optional(),
  reviewRating: ReviewRating.optional(),
});
export type EuvsdisinfoReview = z.infer<typeof ReviewMember>;

const HydraPage = z.object({
  "hydra:member": z.array(z.unknown()).optional(),
  "hydra:view": z
    .object({ "hydra:next": z.string().optional() })
    .optional(),
});

/** One Hydra collection page (fixture + stub typing). */
export interface EuvsdisinfoHydraPage<Member = unknown> {
  "hydra:member"?: Member[];
  "hydra:view"?: { "hydra:next"?: string };
}

export interface EuvsdisinfoConnectorOptions {
  /** JSON-LD API base URL (sources.json `euvsdisinfo.apiBaseUrl`). */
  apiBaseUrl: string;
  /**
   * Language of the emitted records. EUvsDisinfo writes its claim
   * summaries and disproofs in English, so `en` is the default.
   * TODO(verify): the export references per-case `/languages` IRIs; once
   * the shape is verified those describe the *appearance* language —
   * decide then whether to resolve them instead.
   */
  lang?: string;
  /** Safety cap per collection pull. */
  maxPagesPerPull?: number;
  fetchImpl?: typeof fetch;
  warn?: (message: string) => void;
}

/** RFC3339 timestamp → `YYYY-MM-DD`, or undefined when not date-shaped. */
function isoDateOf(timestamp: string | undefined): string | undefined {
  return timestamp !== undefined && /^\d{4}-\d{2}-\d{2}/.test(timestamp)
    ? timestamp.slice(0, 10)
    : undefined;
}

function ratingOf(
  rating: z.infer<typeof ReviewRating> | undefined,
): string | undefined {
  if (rating === undefined) return undefined;
  if (typeof rating === "string") return rating;
  return rating.alternateName ?? rating.name;
}

export class EuvsdisinfoConnector implements Connector {
  readonly id = "euvsdisinfo";

  private readonly apiBaseUrl: string;
  private readonly lang: string;
  private readonly maxPagesPerPull: number;
  private readonly fetchImpl: typeof fetch;
  private readonly warn: (message: string) => void;

  constructor(options: EuvsdisinfoConnectorOptions) {
    this.apiBaseUrl = options.apiBaseUrl;
    this.lang = options.lang ?? "en";
    this.maxPagesPerPull = options.maxPagesPerPull ?? 50;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.warn = options.warn ?? console.warn;
  }

  async fetchSince(since: Date): Promise<RawFactCheck[]> {
    const sinceDate = since.toISOString().slice(0, 10);
    // Server-side window per the documented filters; the client-side check
    // in collect() keeps the day-granular window honest around `since`.
    const claimMembers = await this.pullPaged("claims", {
      "datePublished[after]": sinceDate,
    });
    const reviewMembers = await this.pullPaged("claim_reviews", {
      "itemReviewed.datePublished[after]": sinceDate,
    });
    return this.collect(claimMembers, reviewMembers, since);
  }

  private async pullPaged(
    path: string,
    params: Record<string, string>,
  ): Promise<unknown[]> {
    const members: unknown[] = [];
    const first = new URL(path, this.apiBaseUrl);
    for (const [key, value] of Object.entries(params)) {
      first.searchParams.set(key, value);
    }
    let next: URL | undefined = first;
    for (let page = 0; page < this.maxPagesPerPull; page += 1) {
      const response = await this.fetchImpl(next, {
        headers: { accept: "application/ld+json" },
      });
      if (!response.ok) {
        throw new Error(
          `[gegenrede] euvsdisinfo: ${path} pull failed with HTTP ${response.status} (page=${page})`,
        );
      }
      const body = HydraPage.parse(await response.json());
      members.push(...(body["hydra:member"] ?? []));
      const nextPath = body["hydra:view"]?.["hydra:next"];
      if (nextPath === undefined) {
        return members;
      }
      next = new URL(nextPath, this.apiBaseUrl);
    }
    this.warn(
      `[gegenrede] euvsdisinfo: page cap (${this.maxPagesPerPull}) reached before hydra:next ran out (path=${path}) — older records left for the next pull`,
    );
    return members;
  }

  private collect(
    claimMembers: readonly unknown[],
    reviewMembers: readonly unknown[],
    since: Date,
  ): RawFactCheck[] {
    let skipped = 0;
    // Reviews indexed both by their own IRI (claim.claimReview → review)
    // and by the claim IRI they point at (review.itemReviewed → claim).
    const reviewsById = new Map<string, EuvsdisinfoReview>();
    const reviewsByClaim = new Map<string, EuvsdisinfoReview>();
    for (const rawReview of reviewMembers) {
      const parsed = ReviewMember.safeParse(rawReview);
      if (!parsed.success) {
        skipped += 1;
        continue;
      }
      const review = parsed.data;
      if (review["@id"] !== undefined) reviewsById.set(review["@id"], review);
      if (review.itemReviewed !== undefined) {
        reviewsByClaim.set(review.itemReviewed, review);
      }
    }

    const byPublisherUrl = new Map<string, RawFactCheck>();
    for (const rawClaim of claimMembers) {
      const parsed = ClaimMember.safeParse(rawClaim);
      if (!parsed.success) {
        skipped += 1;
        continue;
      }
      const claim = parsed.data;
      const review = this.reviewFor(claim, reviewsById, reviewsByClaim);
      const publishedRaw = review?.datePublished ?? claim.datePublished;
      const publishedTime =
        publishedRaw === undefined ? Number.NaN : Date.parse(publishedRaw);
      if (!Number.isNaN(publishedTime) && publishedTime < since.getTime()) {
        continue;
      }
      const record = RawFactCheck.safeParse({
        claimText: claim.text,
        ratingRaw: ratingOf(review?.reviewRating) ?? EUVSDISINFO_DEFAULT_RATING,
        publisher: EUVSDISINFO_PUBLISHER,
        url: review?.url,
        publishedAt: isoDateOf(publishedRaw),
        lang: this.lang,
      });
      if (!record.success) {
        skipped += 1;
        continue;
      }
      byPublisherUrl.set(
        `${record.data.publisher}|${record.data.url}`,
        record.data,
      );
    }
    if (skipped > 0) {
      // Hard Rule 5: count only — never claim text or URLs.
      this.warn(
        `[gegenrede] euvsdisinfo: skipped ${skipped} unusable record(s)`,
      );
    }
    return [...byPublisherUrl.values()];
  }

  private reviewFor(
    claim: EuvsdisinfoClaim,
    reviewsById: ReadonlyMap<string, EuvsdisinfoReview>,
    reviewsByClaim: ReadonlyMap<string, EuvsdisinfoReview>,
  ): EuvsdisinfoReview | undefined {
    const byReference =
      claim.claimReview === undefined
        ? undefined
        : reviewsById.get(claim.claimReview);
    if (byReference !== undefined) return byReference;
    return claim["@id"] === undefined
      ? undefined
      : reviewsByClaim.get(claim["@id"]);
  }
}
