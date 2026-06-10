// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Demonstrates that the §6a lint ban actually fires: importing the
// tokenizer/model libraries anywhere outside the shared embedding providers
// must be an eslint error (eslint.config.js, "gegenrede/embedding-import-ban").

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const BANNED_MODULES = [
  "@huggingface/transformers",
  "onnxruntime-node",
  "onnxruntime-web",
];

async function lintSnippet(code: string, filePath: string) {
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, {
    filePath: join(repoRoot, filePath),
  });
  return (result?.messages ?? []).filter(
    (message) => message.ruleId === "no-restricted-imports",
  );
}

describe("tokenizer/model import ban (spec §6a)", () => {
  it.each(BANNED_MODULES)(
    "flags importing %s outside shared embedding providers",
    async (module) => {
      for (const filePath of [
        "services/ingest/src/probe.ts",
        "packages/extension/src/probe.ts",
        "packages/shared/src/some-other-module.ts",
      ]) {
        const violations = await lintSnippet(`import "${module}";\n`, filePath);
        expect(violations.length, `${module} in ${filePath}`).toBeGreaterThan(
          0,
        );
        expect(violations[0]?.message).toContain("shared/embedText");
      }
    },
  );

  it("allows the shared embedding providers themselves", async () => {
    const violations = await lintSnippet(
      'import "@huggingface/transformers";\n',
      "packages/shared/src/embedding-node.ts",
    );
    expect(violations).toEqual([]);
  });

  it("still bans direct model imports in embedding tests (mock-only)", async () => {
    const violations = await lintSnippet(
      'import "onnxruntime-node";\n',
      "packages/shared/src/embedding-node.test.ts",
    );
    expect(violations.length).toBeGreaterThan(0);
  });
});
