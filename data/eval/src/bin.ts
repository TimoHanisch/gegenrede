// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// `pnpm eval` entry point — all logic lives in cli.ts so importing it in
// tests has no side effects.

import { main } from "./cli.js";

process.exitCode = await main(process.argv.slice(2));
