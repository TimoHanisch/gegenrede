// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// `pnpm harvest` entry point — all logic lives in harvest.ts so importing
// it in tests has no side effects.

import { harvestMain } from "./harvest.js";

process.exitCode = await harvestMain(process.argv.slice(2));
