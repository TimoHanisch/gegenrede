// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { describe, expect, it } from "vitest";

import { loadSources, SourcesConfig } from "./sources.js";

describe("loadSources", () => {
  it("parses the committed sources.json with at least one publisher site", () => {
    const sources = loadSources();
    expect(sources.googleFactcheck.publisherSites.length).toBeGreaterThan(0);
    for (const site of sources.googleFactcheck.publisherSites) {
      // Domains only — the connector builds the request URL itself.
      expect(site).not.toMatch(/^https?:\/\//);
    }
  });

  it("rejects a config without publisher sites", () => {
    expect(() => SourcesConfig.parse({})).toThrow();
    expect(() =>
      SourcesConfig.parse({ googleFactcheck: { publisherSites: [] } }),
    ).toThrow();
  });
});
