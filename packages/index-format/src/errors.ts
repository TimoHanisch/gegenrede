// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Typed failures for the .ggx container (spec §5). The reader rejects a
// snapshot by throwing one of these; callers branch on `code`, never on
// message text (messages are developer-facing, not UI copy — UI strings go
// through the i18n catalogs).

export type GgxErrorCode =
  | "bad-input" // writer given malformed vectors/records
  | "bad-magic" // file does not start with "GGX1"
  | "sha256-mismatch" // container hash differs from the published hash
  | "bad-header" // header JSON missing/invalid per §5
  | "model-mismatch" // model+modelRevision differ from the local pin (§6c)
  | "truncated" // container shorter than the header-declared layout
  | "bad-body" // vectors/scales section is internally inconsistent
  | "bad-meta"; // meta block fails gunzip, JSONL, shape, or offset checks

export class GgxError extends Error {
  readonly code: GgxErrorCode;

  constructor(code: GgxErrorCode, message: string) {
    super(`[gegenrede] ${message}`);
    this.name = "GgxError";
    this.code = code;
  }
}
