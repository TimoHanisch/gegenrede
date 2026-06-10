// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
  },
  ...tseslint.configs.recommended,
  {
    // Spec §6a: every embed call goes through shared/embedText — direct
    // tokenizer/model use is banned outside the shared embedding providers.
    name: "gegenrede/embedding-import-ban",
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            "@huggingface/transformers",
            "onnxruntime-node",
            "onnxruntime-web",
          ].map((name) => ({
            name,
            message:
              "Direct tokenizer/model use is banned (spec §6a). Go through shared/embedText; runtime providers live in packages/shared/src/embedding-*.ts.",
          })),
        },
      ],
    },
  },
  {
    name: "gegenrede/embedding-import-ban-exemption",
    files: ["packages/shared/src/embedding-*.ts"],
    ignores: ["packages/shared/src/embedding-*.test.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
