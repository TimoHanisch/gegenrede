// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { describe, expect, it } from "vitest";

import type { ExtractedPost } from "./core-types.js";
import { OUTBOUND_SCHEMAS, OutboundPost, toOutboundPost } from "./outbound.js";

const postWithHandle: ExtractedPost = {
  text: "Example claim text long enough to pass.",
  url: "https://example.com/post/1",
  lang: "de",
  platform: "x",
  authorHandle: "@example_handle",
};

describe("OutboundPost", () => {
  it("strips authorHandle when parsing a full ExtractedPost", () => {
    const outbound = toOutboundPost(postWithHandle);
    expect(outbound).not.toHaveProperty("authorHandle");
    expect(outbound.text).toBe(postWithHandle.text);
  });

  it("has no authorHandle key in its shape (structurally absent)", () => {
    expect(Object.keys(OutboundPost.shape)).not.toContain("authorHandle");
  });
});

describe("outbound privacy invariant (CLAUDE.md Hard Rule 5, spec §4.3)", () => {
  // Every schema in OUTBOUND_SCHEMAS needs a sample input here that carries
  // authorHandle data; the test fails on registry entries without one.
  const samples: Record<keyof typeof OUTBOUND_SCHEMAS, unknown> = {
    OutboundPost: postWithHandle,
  };

  it("authorHandle never appears in any outbound serialization", () => {
    expect(Object.keys(OUTBOUND_SCHEMAS).length).toBeGreaterThan(0);
    for (const [name, schema] of Object.entries(OUTBOUND_SCHEMAS)) {
      expect(Object.keys(schema.shape), `${name} shape`).not.toContain(
        "authorHandle",
      );
      const sample = samples[name as keyof typeof OUTBOUND_SCHEMAS];
      expect(sample, `missing privacy-test sample for ${name}`).toBeDefined();
      const serialized = JSON.stringify(schema.parse(sample));
      expect(serialized, `${name} serialization`).not.toContain("authorHandle");
      expect(serialized, `${name} serialization`).not.toContain(
        "@example_handle",
      );
    }
  });
});
