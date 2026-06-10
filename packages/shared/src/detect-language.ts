// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Spec §8 step 2 — language detection on the cleaned text via tinyld.
// Confidence below the threshold falls back to the caller-supplied UI
// language. The result feeds the composer's output language and the eval
// breakdown, hence the structured return type.

import { detectAll } from "tinyld";

export const LANGUAGE_CONFIDENCE_THRESHOLD = 0.7;

export interface LanguageDetection {
  /** ISO 639-1 code — detected, or the UI language when usedFallback. */
  lang: string;
  /** tinyld accuracy of the top candidate; 0 when nothing was detected. */
  confidence: number;
  /** True when confidence < threshold and `lang` is the UI language. */
  usedFallback: boolean;
}

/**
 * Detects the language of cleaned post text (§8 step 2). When tinyld's top
 * candidate scores below LANGUAGE_CONFIDENCE_THRESHOLD — or nothing is
 * detected at all — falls back to `uiLang`.
 */
export function detectPostLanguage(
  cleanedText: string,
  uiLang: string,
): LanguageDetection {
  const top = detectAll(cleanedText)[0];
  if (top === undefined || top.accuracy < LANGUAGE_CONFIDENCE_THRESHOLD) {
    return {
      lang: uiLang,
      confidence: top?.accuracy ?? 0,
      usedFallback: true,
    };
  }
  return { lang: top.lang, confidence: top.accuracy, usedFallback: false };
}
