// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// `pnpm eval` (spec §14, issue #14) — thin shell around the pure core:
// parse args, load golden sets, read the snapshot, wire the embedding
// provider, write the report pair. Exit code 0 means "the run completed",
// regardless of whether the §14 targets were met — judging the numbers is
// the human gate (#17), not this tool. Exit code 1 is reserved for usage
// and operational errors.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { readSnapshot, type GgxSnapshot } from "@gegenrede/index-format";
import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_REVISION,
  initEmbedding,
  resetEmbedding,
  type EmbeddingProvider,
} from "@gegenrede/shared";

import { EvalError } from "./errors.js";
import { loadGoldenFile, type LoadedGoldenItem } from "./golden.js";
import {
  buildReport,
  renderMarkdown,
  reportBaseName,
  type GoldenSetInfo,
  type SnapshotInfo,
} from "./report.js";
import {
  DEFAULT_THRESHOLD,
  DEFAULT_TOP_K,
  runEval,
  type EvalRun,
} from "./run-eval.js";

// data/eval — golden sets and the default report directory live here.
const PACKAGE_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");

const USAGE = `Usage: pnpm eval --snapshot <path.ggx> [options]

Options:
  --snapshot <path>   .ggx snapshot to evaluate against (required)
  --golden <path>     golden JSONL file; repeatable
                      (default: every data/eval/golden-*.jsonl)
  --sha256 <hex>      published snapshot sha256 to verify against
                      (default: self-computed from the file — quality is
                      measured, manifest integrity is NOT verified)
  --threshold <n>     match threshold in [0, 1] (default: ${DEFAULT_THRESHOLD}, spec §8)
  --top-k <n>         hits per query, the K in recall@K (default: ${DEFAULT_TOP_K}, spec §14)
  --out <dir>         report directory (default: data/eval/reports)`;

export interface CliConfig {
  snapshotPath: string;
  sha256?: string;
  /** Empty = discover golden-*.jsonl in the package root. */
  goldenPaths: string[];
  threshold: number;
  topK: number;
  outDir: string;
}

export function parseCliArgs(argv: string[]): CliConfig {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        snapshot: { type: "string" },
        golden: { type: "string", multiple: true },
        sha256: { type: "string" },
        threshold: { type: "string" },
        "top-k": { type: "string" },
        out: { type: "string" },
      },
      strict: true,
    }));
  } catch (error) {
    throw new EvalError(
      "usage",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (values.snapshot === undefined) {
    throw new EvalError("usage", "--snapshot <path.ggx> is required");
  }

  const threshold =
    values.threshold === undefined
      ? DEFAULT_THRESHOLD
      : Number(values.threshold);
  if (!(threshold >= 0 && threshold <= 1)) {
    throw new EvalError(
      "usage",
      `--threshold ${values.threshold ?? ""} is not a number in [0, 1]`,
    );
  }

  const topK =
    values["top-k"] === undefined ? DEFAULT_TOP_K : Number(values["top-k"]);
  if (!(Number.isInteger(topK) && topK >= 1)) {
    throw new EvalError(
      "usage",
      `--top-k ${values["top-k"] ?? ""} is not an integer ≥ 1`,
    );
  }

  return {
    snapshotPath: values.snapshot,
    ...(values.sha256 === undefined ? {} : { sha256: values.sha256 }),
    goldenPaths: values.golden ?? [],
    threshold,
    topK,
    outDir: values.out ?? path.join(PACKAGE_ROOT, "reports"),
  };
}

async function discoverGoldenFiles(): Promise<string[]> {
  const entries = await readdir(PACKAGE_ROOT);
  return entries
    .filter((name) => /^golden-.*\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(PACKAGE_ROOT, name));
}

function goldenInfoOf(
  files: string[],
  items: readonly LoadedGoldenItem[],
): GoldenSetInfo {
  const perLang: Record<string, { positives: number; negatives: number }> = {};
  let positives = 0;
  let negatives = 0;
  for (const item of items) {
    const bucket = (perLang[item.lang] ??= { positives: 0, negatives: 0 });
    if (item.expectedUrl === null) {
      negatives += 1;
      bucket.negatives += 1;
    } else {
      positives += 1;
      bucket.positives += 1;
    }
  }
  return {
    files: files.map((file) => path.relative(process.cwd(), file)),
    positives,
    negatives,
    perLang,
  };
}

export interface MainOptions {
  /** Test seam: injected instead of the real Node provider. */
  provider?: EmbeddingProvider;
  /** Test seam: report timestamp source. */
  now?: () => Date;
  /** Test seam: CLI output sink. */
  log?: (line: string) => void;
}

export async function main(
  argv: string[],
  options: MainOptions = {},
): Promise<number> {
  const log = options.log ?? console.log;
  try {
    const config = parseCliArgs(argv);

    const goldenFiles =
      config.goldenPaths.length > 0
        ? config.goldenPaths
        : await discoverGoldenFiles();
    if (goldenFiles.length === 0) {
      throw new EvalError(
        "no-golden",
        "no golden sets found — expected data/eval/golden-*.jsonl or --golden <path>. " +
          "The golden sets are human-curated and land with issue #15.",
      );
    }
    const items = (
      await Promise.all(goldenFiles.map((file) => loadGoldenFile(file)))
    ).flat();
    if (items.length === 0) {
      throw new EvalError(
        "no-golden",
        `the golden set is empty (${goldenFiles.join(", ")}) — curation lands with issue #15`,
      );
    }

    const bytes = new Uint8Array(await readFile(config.snapshotPath));
    const sha256Source: SnapshotInfo["sha256Source"] =
      config.sha256 === undefined ? "self-computed" : "cli-flag";
    const sha256 =
      config.sha256 ?? createHash("sha256").update(bytes).digest("hex");
    const snapshot: GgxSnapshot = await readSnapshot(bytes, {
      expectedSha256: sha256,
      pinned: {
        model: EMBEDDING_MODEL_ID,
        modelRevision: EMBEDDING_MODEL_REVISION,
      },
    });

    // Dynamic import keeps onnxruntime/transformers out of the module graph
    // unless the real provider is actually needed (hermetic tests inject).
    initEmbedding(
      options.provider ??
        (await (
          await import("@gegenrede/shared/embedding-node")
        ).createNodeEmbeddingProvider()),
    );
    let run: EvalRun;
    try {
      run = await runEval(items, snapshot, {
        threshold: config.threshold,
        topK: config.topK,
      });
    } finally {
      resetEmbedding();
    }

    const generatedAt = (options.now?.() ?? new Date()).toISOString();
    const report = buildReport(
      run,
      {
        version: snapshot.header.version,
        model: snapshot.header.model,
        modelRevision: snapshot.header.modelRevision,
        count: snapshot.header.count,
        langs: snapshot.header.langs,
        sha256,
        sha256Source,
      },
      goldenInfoOf(goldenFiles, items),
      generatedAt,
    );

    await mkdir(config.outDir, { recursive: true });
    const base = path.join(config.outDir, reportBaseName(report));
    await writeFile(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(`${base}.md`, renderMarkdown(report));

    const { overall } = report.metrics;
    log(
      `recall@${config.topK}: ${fmt(overall.recallAtK)} raw, ` +
        `${fmt(overall.recallAtKAtThreshold)} at threshold ${config.threshold} ` +
        `(target ≥ 0.80) — ${overall.positives} positives`,
    );
    log(
      `false-match rate: ${fmt(overall.falseMatchRate)} at threshold ${config.threshold} ` +
        `(target ≤ 0.05) — ${overall.negatives} negatives`,
    );
    for (const [lang, bucket] of Object.entries(report.metrics.perLang)) {
      log(
        `  ${lang}: recall@${config.topK} ${fmt(bucket.recallAtK)} | ` +
          `at-threshold ${fmt(bucket.recallAtKAtThreshold)} | ` +
          `false-match ${fmt(bucket.falseMatchRate)}`,
      );
    }
    log(`report: ${base}.md / ${base}.json`);
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

function fmt(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}
