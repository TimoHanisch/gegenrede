// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// URL canonicalization for matching a golden item's expectedUrl against
// snapshot meta URLs. Deliberately minimal — only differences that cannot
// distinguish two fact-check articles are erased. The exact rules are
// documented in data/eval/README.md; changing them changes the metrics, so
// treat them like a threshold (human approval + committed eval report).

/**
 * Canonical form: lowercased scheme + host (the URL parser does that),
 * fragment dropped, query kept, exactly one trailing slash stripped from
 * the path (root "/" becomes empty, so `https://x.org` ≡ `https://x.org/`).
 * Throws a TypeError on unparseable input — a malformed URL in a snapshot
 * or golden set must surface, not silently never match.
 */
export function canonicalUrl(raw: string): string {
  const url = new URL(raw.trim());
  const pathname = url.pathname.endsWith("/")
    ? url.pathname.slice(0, -1)
    : url.pathname;
  return url.origin + pathname + url.search;
}
