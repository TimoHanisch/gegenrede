// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// CLAUDE.md known-unknowns registry — connector source lists are
// configuration in `services/ingest/sources.json`, never hardcoded in
// connector code. Validated at load time so a typo fails loudly instead of
// silently pulling nothing.

import { readFileSync } from "node:fs";

import { z } from "zod";

export const SourcesConfig = z.object({
  $comment: z.string().optional(),
  googleFactcheck: z.object({
    publisherSites: z.array(z.string().min(1)).min(1),
  }),
  euvsdisinfo: z.object({
    apiBaseUrl: z.string().url(),
  }),
});
export type SourcesConfig = z.infer<typeof SourcesConfig>;

/** Committed config file, resolved relative to this module. */
export const SOURCES_PATH = new URL("../sources.json", import.meta.url);

export function loadSources(path: URL | string = SOURCES_PATH): SourcesConfig {
  return SourcesConfig.parse(JSON.parse(readFileSync(path, "utf8")));
}
