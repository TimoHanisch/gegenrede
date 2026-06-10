// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

import { z } from "zod";

// Spec §4.1 — canonical verdict taxonomy. The UI always shows both this
// canonical verdict and the publisher's original rating verbatim.
export const Verdict = z.enum([
  "false",
  "mostly_false",
  "misleading", // includes missing-context
  "unproven", // unverifiable / disputed
  "mostly_true",
  "true",
  "satire",
]);
export type Verdict = z.infer<typeof Verdict>;

// Spec §4.2 — technique taxonomy from the EU prebunking deployments plus the
// Bad News technique set. Technique hints are always displayed hedged and must
// not appear without a fact-check match in v1.
export const Technique = z.enum([
  "scapegoating",
  "decontextualization",
  "discrediting",
  "fake_experts",
  "emotional_manipulation",
  "polarization",
  "conspiracy_framing",
  "impersonation",
]);
export type Technique = z.infer<typeof Technique>;
