// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Dev database is a plain local Postgres 17 + pgvector container — see
    // README.md. The production compose stack is a separate task (#52).
    url:
      process.env["DATABASE_URL"] ??
      "postgres://gegenrede:gegenrede@localhost:5432/gegenrede",
  },
});
