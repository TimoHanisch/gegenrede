// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// FIXTURE — UNVERIFIED SHAPE
// TODO(verify): hand-written from the official `claims:search` reference
// (developers.google.com/fact-check/tools/api/reference/rest/v1alpha1/claims/search),
// not recorded from a live response (CLAUDE.md Hard Rule 3). Verify against
// the live integration test once GOOGLE_FC_API_KEY is available.
//
// All content is synthetic: invented publishers, example.org URLs, no real
// user handles, no API keys (CLAUDE.md Testing discipline / Hard Rule 4).

import type { GoogleClaimsSearchPage } from "../connectors/google-factcheck.js";

export const FIXTURE_PUBLISHER_SITE = "factcheck.example.org";

export const SCHULEN_URL = "https://factcheck.example.org/schulen-geschlossen";

/**
 * Pages keyed by `languageCode`, in `nextPageToken` order. The de pull has
 * two pages; the en pull has one. The en page repeats the publisher|url of
 * the first de record (same review surfacing in both language pulls).
 */
export const googleFactcheckPagesByLang: Record<
  string,
  GoogleClaimsSearchPage[]
> = {
  de: [
    {
      claims: [
        {
          text: "Beispielstadt hat angeblich alle Schulen dauerhaft geschlossen.",
          claimant: "Soziale Medien",
          claimDate: "2026-05-18T00:00:00Z",
          claimReview: [
            {
              publisher: {
                name: "Beispiel-Faktencheck",
                site: FIXTURE_PUBLISHER_SITE,
              },
              url: SCHULEN_URL,
              title: "Nein, Beispielstadt hat nicht alle Schulen geschlossen",
              reviewDate: "2026-05-20T00:00:00Z",
              textualRating: "Frei erfunden",
              languageCode: "de",
            },
          ],
        },
        {
          // Unusable: claimReview without a textualRating → skipped + warning.
          text: "Beispielstadt verbietet angeblich Regenschirme.",
          claimReview: [
            {
              publisher: {
                name: "Beispiel-Faktencheck",
                site: FIXTURE_PUBLISHER_SITE,
              },
              url: "https://factcheck.example.org/regenschirme",
              reviewDate: "2026-05-21T00:00:00Z",
              languageCode: "de",
            },
          ],
        },
        {
          // Older than any plausible `since` in the tests → filtered out.
          text: "Beispielstadt hat angeblich 2024 alle Brunnen zugeschüttet.",
          claimReview: [
            {
              publisher: {
                name: "Beispiel-Faktencheck",
                site: FIXTURE_PUBLISHER_SITE,
              },
              url: "https://factcheck.example.org/brunnen",
              reviewDate: "2024-01-05T00:00:00Z",
              textualRating: "Falsch",
              languageCode: "de",
            },
          ],
        },
      ],
      nextPageToken: "fixture-de-page-2",
    },
    {
      claims: [
        {
          text: "In Beispielstadt sollen angeblich alle Parks privatisiert werden.",
          claimReview: [
            {
              publisher: {
                name: "Beispiel-Faktencheck",
                site: FIXTURE_PUBLISHER_SITE,
              },
              url: "https://factcheck.example.org/parks-privatisiert",
              reviewDate: "2026-05-25T00:00:00Z",
              // No VERDICT_MAP entry → must land on `unproven` + warning
              // downstream (§4.1).
              textualRating: "Völlig unbekannte Bewertung",
              // Regional subtag → must normalize to "de".
              languageCode: "de-DE",
            },
          ],
        },
        {
          // Unusable: invalid review URL → fails RawFactCheck → skipped.
          text: "Beispielstadt führt angeblich eine Fahrradsteuer ein.",
          claimReview: [
            {
              publisher: {
                name: "Beispiel-Faktencheck",
                site: FIXTURE_PUBLISHER_SITE,
              },
              url: "not-a-url",
              reviewDate: "2026-05-26T00:00:00Z",
              textualRating: "Falsch",
              languageCode: "de",
            },
          ],
        },
      ],
    },
  ],
  en: [
    {
      claims: [
        {
          text: "Example town supposedly banned all bicycles overnight.",
          claimReview: [
            {
              publisher: {
                name: "Example Fact Check",
                site: "factcheck-en.example.org",
              },
              url: "https://factcheck-en.example.org/bicycle-ban",
              reviewDate: "2026-05-22T00:00:00Z",
              textualRating: "Completely Made Up Rating",
              // Regional subtag → must normalize to "en".
              languageCode: "en-US",
            },
          ],
        },
        {
          // Same publisher|url as the first de record → deduped within a run.
          text: "Beispielstadt hat angeblich alle Schulen dauerhaft geschlossen.",
          claimReview: [
            {
              publisher: {
                name: "Beispiel-Faktencheck",
                site: FIXTURE_PUBLISHER_SITE,
              },
              url: SCHULEN_URL,
              reviewDate: "2026-05-20T00:00:00Z",
              textualRating: "Frei erfunden",
              languageCode: "de",
            },
          ],
        },
      ],
    },
  ],
};
