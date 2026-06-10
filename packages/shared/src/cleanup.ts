// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Spec §8 step 1 — deterministic cleanup, no LLM. Pure function shared by
// extension, API, and eval runner; behavior is frozen by the golden tests
// in cleanup.test.ts.

// §8 step 1 says "truncate to 512 tokens" without naming a tokenizer. The
// real E5 tokenizer is off-limits here (direct tokenizer use is lint-banned,
// spec §6a) and would make this function impure, so we truncate to 512
// whitespace-separated words as the deterministic approximation. The model's
// own 512-token limit is enforced downstream by the embedding provider.
export const CLEANUP_MAX_TOKENS = 512;

// http(s) URLs and bare www. links, up to the next whitespace.
const URL_PATTERN = /\bhttps?:\/\/\S+|\bwww\.\S+/giu;

// @-handles: platform mentions (@user) including Mastodon's @user@instance
// form. Letters/digits/underscore covers X, Reddit, and Mastodon local parts.
const HANDLE_PATTERN = /@[\p{L}\p{N}_]+(?:@[\p{L}\p{N}][\p{L}\p{N}.-]*)?/gu;

// Hashtag body: letters/digits/underscore after the leading #.
const HASHTAG_PATTERN = /#([\p{L}\p{N}_]+)/gu;

// Emoji and their composition machinery: pictographs, skin-tone modifiers,
// regional-indicator flag pairs, keycap combiner, variation selector, ZWJ.
const EMOJI_PATTERN =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{1F1E6}-\u{1F1FF}\u{20E3}\u{FE0F}\u{200D}]/gu;

// Runs of the same punctuation mark ("!!!", "???", "....", "…………").
const REPEATED_PUNCTUATION_PATTERN = /([\p{P}\p{S}])\1+/gu;

/**
 * Splits a hashtag body into words on camel-case boundaries:
 * `KlimaLüge` → `Klima Lüge`, `COVIDIstEineLüge` → `COVID Ist Eine Lüge`.
 * Underscores become spaces; all-caps runs (`NATO`) stay intact.
 */
function hashtagToWords(body: string): string {
  return body
    .replace(/_+/gu, " ")
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2");
}

/**
 * Spec §8 step 1: strips URLs, @-handles, and emoji; expands hashtags to
 * words; collapses repeated punctuation and whitespace; truncates to
 * CLEANUP_MAX_TOKENS whitespace tokens. Deterministic and idempotent.
 */
export function cleanPostText(raw: string): string {
  const stripped = raw
    .replace(URL_PATTERN, " ")
    .replace(HANDLE_PATTERN, " ")
    .replace(HASHTAG_PATTERN, (_, body: string) => hashtagToWords(body))
    .replace(EMOJI_PATTERN, " ")
    .replace(REPEATED_PUNCTUATION_PATTERN, "$1")
    .replace(/\s+/gu, " ")
    .trim();
  const tokens = stripped.split(" ");
  if (tokens.length <= CLEANUP_MAX_TOKENS) {
    return stripped;
  }
  return tokens.slice(0, CLEANUP_MAX_TOKENS).join(" ");
}
