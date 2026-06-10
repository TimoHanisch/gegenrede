// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import type { z } from "zod";

import { ExtractedPost } from "./core-types.js";

// Spec §4.3 / CLAUDE.md Hard Rule 5 — `authorHandle` exists for the overlay
// header only; every serializer that leaves the extension goes through a
// schema here, from which the field is structurally absent. Zod object schemas
// strip unknown keys on parse, so passing a full ExtractedPost through
// OutboundPost drops the handle.

export const OutboundPost = ExtractedPost.omit({ authorHandle: true });
export type OutboundPost = z.infer<typeof OutboundPost>;

/**
 * Every schema whose output may leave the extension. The privacy unit test
 * iterates this registry; add new outbound schemas here so they are covered
 * automatically.
 */
export const OUTBOUND_SCHEMAS = {
  OutboundPost,
} as const;

/** Produce the wire-safe shape of a post, with `authorHandle` stripped. */
export function toOutboundPost(post: ExtractedPost): OutboundPost {
  return OutboundPost.parse(post);
}
