// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// `pnpm harvest` (issue #15) — pulls golden-set CANDIDATES from the Google
// Fact Check Tools API (via the ingest connector) into a gitignored staging
// file for human review. It never writes golden-*.jsonl: promotion is a
// manual edit per item, because the harvested claim text is the
// fact-checker's ClaimReview phrasing — the very text the index embeds — and
// promoting it verbatim would turn recall@5 into a self-match test. The
// candidate shape is deliberately NOT golden-valid (extra helper keys), so
// an unedited line pasted into a golden file fails `pnpm eval --validate`.
//
// Hard Rule 4/5 discipline matches the connector: the API key stays in the
// env, and logs carry counts only — never claim text or URLs.

import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  GoogleFactcheckConnector,
  loadSources,
  type Connector,
  type RawFactCheck,
} from "@gegenrede/ingest";
import { z } from "zod";

import { EvalError } from "./errors.js";
import { PACKAGE_ROOT, discoverGoldenFiles, loadGoldenFile } from "./golden.js";
import { canonicalUrl } from "./url.js";

const USAGE = `Usage: pnpm harvest --lang <de|en> --since <YYYY-MM-DD> [options]

Harvests golden-set CANDIDATES (#15) from the Google Fact Check Tools API
into a staging file for human review. Never writes golden-*.jsonl.

Options:
  --lang <de|en>      candidate language (required)
  --since <date>      review-date window start, YYYY-MM-DD (required)
  --site <domain>     publisher domain for the pull; repeatable
                      (default: sources.json googleFactcheck.publisherSites —
                      pass non-ingested publishers to find NEGATIVE candidates)
  --out <path>        staging file (default: data/eval/candidates-<lang>.jsonl)
  --force             overwrite an existing staging file

Requires GOOGLE_FC_API_KEY in the environment (Hard Rule 4).`;

/**
 * One staging line. `claim` is the fact-checker's phrasing — REPHRASE it to
 * the circulating wording during review. `rating`/`publishedAt` are review
 * helpers; the golden schema is strict, so promotion forces their removal.
 */
export const CandidateItem = z
  .object({
    claim: z.string().min(1),
    expectedUrl: z.string().url(),
    lang: z.enum(["de", "en"]),
    source: z.string().min(1),
    rating: z.string().optional(),
    publishedAt: z.string().optional(),
  })
  .strict();

export type CandidateItem = z.infer<typeof CandidateItem>;

export interface HarvestConfig {
  lang: "de" | "en";
  since: Date;
  /** Empty = sources.json googleFactcheck.publisherSites. */
  sites: string[];
  out: string;
  force: boolean;
}

export function parseHarvestArgs(argv: string[]): HarvestConfig {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        lang: { type: "string" },
        since: { type: "string" },
        site: { type: "string", multiple: true },
        out: { type: "string" },
        force: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (error) {
    throw new EvalError(
      "usage",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (values.lang !== "de" && values.lang !== "en") {
    throw new EvalError("usage", "--lang must be de or en");
  }
  if (values.since === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(values.since)) {
    throw new EvalError("usage", "--since <YYYY-MM-DD> is required");
  }
  const since = new Date(`${values.since}T00:00:00.000Z`);
  if (Number.isNaN(since.getTime())) {
    throw new EvalError("usage", `--since ${values.since} is not a real date`);
  }

  return {
    lang: values.lang,
    since,
    sites: values.site ?? [],
    out:
      values.out ?? path.join(PACKAGE_ROOT, `candidates-${values.lang}.jsonl`),
    force: values.force ?? false,
  };
}

export interface HarvestOutcome {
  written: number;
  skippedCurated: number;
  skippedOtherLang: number;
}

export interface HarvestOptions {
  /** Test seam: injected instead of the real Google connector. */
  connector?: Connector;
  /** Test seam: golden files to dedupe against (default: discovered). */
  goldenFiles?: string[];
  /** Test seam: CLI output sink. */
  log?: (line: string) => void;
}

/**
 * URLs already curated: every non-null expectedUrl across the golden sets,
 * canonicalized with the same rules the eval uses. A broken golden file
 * aborts the harvest — fix it with `pnpm eval --validate` first.
 */
async function curatedUrls(files: string[]): Promise<Set<string>> {
  const urls = new Set<string>();
  for (const file of files) {
    for (const item of await loadGoldenFile(file)) {
      if (item.expectedUrl !== null) {
        urls.add(canonicalUrl(item.expectedUrl));
      }
    }
  }
  return urls;
}

function toCandidate(
  record: RawFactCheck,
  lang: "de" | "en",
): CandidateItem | null {
  if (record.lang !== lang) {
    return null;
  }
  return {
    claim: record.claimText,
    expectedUrl: record.url,
    lang,
    source: record.publisher,
    rating: record.ratingRaw,
    ...(record.publishedAt === undefined
      ? {}
      : { publishedAt: record.publishedAt }),
  };
}

export async function runHarvest(
  config: HarvestConfig,
  options: HarvestOptions = {},
): Promise<HarvestOutcome> {
  if (existsSync(config.out) && !config.force) {
    throw new EvalError(
      "harvest",
      `${config.out} already exists — overwriting would lose review work. ` +
        "Pass --force, or --out <path> for a fresh batch.",
    );
  }

  const connector =
    options.connector ??
    new GoogleFactcheckConnector({
      publisherSites:
        config.sites.length > 0
          ? config.sites
          : loadSources().googleFactcheck.publisherSites,
      languages: [config.lang],
    });

  const curated = await curatedUrls(
    options.goldenFiles ?? (await discoverGoldenFiles()),
  );
  const records = await connector.fetchSince(config.since);

  const candidates: CandidateItem[] = [];
  let skippedCurated = 0;
  let skippedOtherLang = 0;
  for (const record of records) {
    const candidate = toCandidate(record, config.lang);
    if (candidate === null) {
      skippedOtherLang += 1;
      continue;
    }
    if (curated.has(canonicalUrl(candidate.expectedUrl))) {
      skippedCurated += 1;
      continue;
    }
    candidates.push(candidate);
  }
  // Newest first — reviews usually start from the current news cycle.
  candidates.sort((a, b) =>
    (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
  );

  if (candidates.length > 0) {
    await writeFile(
      config.out,
      candidates.map((c) => JSON.stringify(c)).join("\n") + "\n",
    );
  }
  return { written: candidates.length, skippedCurated, skippedOtherLang };
}

export async function harvestMain(
  argv: string[],
  options: HarvestOptions = {},
): Promise<number> {
  const log = options.log ?? console.log;
  try {
    const config = parseHarvestArgs(argv);
    const outcome = await runHarvest(config, options);

    // Counts only — claim text and URLs never reach the log (Hard Rule 5).
    log(
      `harvested ${outcome.written} ${config.lang} candidate(s) ` +
        `(skipped: ${outcome.skippedCurated} already curated, ` +
        `${outcome.skippedOtherLang} other-language)`,
    );
    if (outcome.written === 0) {
      log("nothing to review — no staging file written");
      return 0;
    }
    log(`staging file: ${config.out} (gitignored — never commit candidates)`);
    log(
      "review by hand: rephrase each claim to its circulating wording, " +
        "drop the helper fields, move the line into the golden set, " +
        "then run `pnpm eval --validate` (data/eval/README.md)",
    );
    return 0;
  } catch (error) {
    if (error instanceof EvalError && error.code === "usage") {
      log(error.message);
      log("");
      log(USAGE);
      return 1;
    }
    if (error instanceof Error) {
      log(error.message);
      return 1;
    }
    log(String(error));
    return 1;
  }
}
