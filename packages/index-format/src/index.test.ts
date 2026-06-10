// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { expect, it } from "vitest";

import { PACKAGE_NAME } from "./index.js";

it("exports the package name", () => {
  expect(PACKAGE_NAME).toBe("@gegenrede/index-format");
});
