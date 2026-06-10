// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// FIXTURE — UNVERIFIED SHAPE
// TODO(verify): #70 — hand-assembled from the JSON-LD/Hydra shape
// documented by the euvsdisinfoR API wrapper
// (github.com/corriebar/euvsdisinfoR), not recorded from a live response
// (CLAUDE.md Hard Rule 3); the documented host is likely retired (see
// #70 for the research and route options). Once #70 is resolved, verify
// via the live integration test and confirm the real `reviewRating`
// strings against the VERDICT_MAP entries in packages/shared.
//
// All content is synthetic: invented claims about "Exampleland",
// example.org URLs, no real user handles (CLAUDE.md Testing discipline).

import type {
  EuvsdisinfoClaim,
  EuvsdisinfoHydraPage,
  EuvsdisinfoReview,
} from "../connectors/euvsdisinfo.js";

export const FIXTURE_API_BASE = "https://euvsdisinfo-api.example.org";

export const LABORATORIES_URL =
  "https://euvsdisinfo.example.org/cases/exampleland-laboratories";
export const ELECTIONS_URL =
  "https://euvsdisinfo.example.org/cases/exampleland-elections";
export const UMBRELLAS_URL =
  "https://euvsdisinfo.example.org/cases/exampleland-umbrella-ban";

/**
 * Two `claims` pages chained via `hydra:next`, then one `claim_reviews`
 * page. Relative to a `since` of 2026-05-01:
 *
 * - claim 1001 → review 2001 (linked claims→reviews, object rating)
 * - claim 1002 → review 2002 (linked reviews→claims, string rating)
 * - claim 1005 → review 2005 (no `reviewRating` → default rating)
 * - claim 1004 has no review anywhere → unusable, skipped + counted
 * - claim 1003 → review 2003 dated 2026-03-02 → older than `since`,
 *   filtered silently
 * - the `claim_reviews` page carries one non-object member → counted
 */
export const euvsdisinfoClaimsPages: EuvsdisinfoHydraPage<EuvsdisinfoClaim>[] =
  [
    {
      "hydra:member": [
        {
          "@id": "/claims/1001",
          text: "Exampleland is allegedly running secret laboratories abroad.",
          datePublished: "2026-05-12T00:00:00+00:00",
          claimReview: "/claim_reviews/2001",
        },
        {
          // Unusable: no review references this claim → no case URL.
          "@id": "/claims/1004",
          text: "Exampleland allegedly dissolved its own parliament in secret.",
          datePublished: "2026-05-18T00:00:00+00:00",
        },
      ],
      "hydra:view": { "hydra:next": "/claims?page=2" },
    },
    {
      "hydra:member": [
        {
          // No `claimReview` field — joined via review 2002's itemReviewed.
          "@id": "/claims/1002",
          text: "Elections in Exampleland were allegedly staged by foreign actors.",
          datePublished: "2026-05-20T00:00:00+00:00",
        },
        {
          // Review 2003 is dated before `since` → filtered, not "skipped".
          "@id": "/claims/1003",
          text: "Exampleland allegedly banned its own national currency.",
          datePublished: "2026-02-27T00:00:00+00:00",
          claimReview: "/claim_reviews/2003",
        },
        {
          "@id": "/claims/1005",
          text: "Exampleland allegedly outlawed umbrellas to control the weather narrative.",
          datePublished: "2026-05-22T00:00:00+00:00",
          claimReview: "/claim_reviews/2005",
        },
      ],
    },
  ];

export const euvsdisinfoReviewPages: EuvsdisinfoHydraPage<
  EuvsdisinfoReview | string
>[] = [
  {
    "hydra:member": [
      {
        "@id": "/claim_reviews/2001",
        itemReviewed: "/claims/1001",
        url: LABORATORIES_URL,
        datePublished: "2026-05-14T00:00:00+00:00",
        reviewRating: { alternateName: "disinfo" },
      },
      {
        "@id": "/claim_reviews/2002",
        itemReviewed: "/claims/1002",
        url: ELECTIONS_URL,
        datePublished: "2026-05-21T00:00:00+00:00",
        reviewRating: "misleading",
      },
      {
        "@id": "/claim_reviews/2003",
        itemReviewed: "/claims/1003",
        url: "https://euvsdisinfo.example.org/cases/exampleland-currency",
        datePublished: "2026-03-02T00:00:00+00:00",
        reviewRating: { alternateName: "disinfo" },
      },
      {
        "@id": "/claim_reviews/2005",
        itemReviewed: "/claims/1005",
        url: UMBRELLAS_URL,
        datePublished: "2026-05-23T00:00:00+00:00",
      },
      // Unusable member: not an object → parse-skipped + counted.
      "not-a-claim-review",
    ],
  },
];
