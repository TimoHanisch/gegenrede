// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Verifies that every source file carries the AGPL-3.0 SPDX header
// (CLAUDE.md Hard Rule 7, spec §13). Dependency-free so it can run in CI
// before `pnpm install` and locally via `pnpm headers:check`.
//
// Usage: node scripts/license-header-check.mjs [rootDir]

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SPDX_LINE = "SPDX-License-Identifier: AGPL-3.0-only";
// The header must appear within the first lines of the file; a shebang or
// similar prelude line may precede it.
const HEADER_SEARCH_LINES = 3;
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORED_DIRECTORIES = new Set([".git", ".turbo", "dist", "node_modules"]);

/** @param {string} dir @returns {string[]} */
function collectSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...collectSourceFiles(path));
      }
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(path);
    }
  }
  return files;
}

/** @param {string} path @returns {boolean} */
function hasHeader(path) {
  const head = readFileSync(path, "utf8")
    .split("\n", HEADER_SEARCH_LINES)
    .join("\n");
  return head.includes(SPDX_LINE);
}

const root = process.argv[2] ?? process.cwd();
const missing = collectSourceFiles(root).filter((path) => !hasHeader(path));

if (missing.length > 0) {
  console.error(`Missing "${SPDX_LINE}" header in ${missing.length} file(s):`);
  for (const path of missing) {
    console.error(`  ${relative(root, path)}`);
  }
  process.exit(1);
}

console.log("license-header-check — all source files carry the AGPL header");
