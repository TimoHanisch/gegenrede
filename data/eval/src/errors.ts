// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// Typed failures for the eval runner (spec §14, issue #14). Callers branch
// on `code`, never on message text. Messages are developer-facing CLI
// output, not UI copy — the eval runner is maintainer tooling and has no
// i18n surface.

export type EvalErrorCode =
  | "usage" // bad CLI arguments
  | "no-golden" // no golden set found or zero items (curation lands with #15)
  | "bad-golden" // a golden JSONL line fails parsing or the schema
  | "bad-claim" // a golden claim cleans to empty text (curation bug)
  | "harvest"; // candidate-harvester operational failure (#15 staging tool)

export class EvalError extends Error {
  readonly code: EvalErrorCode;

  constructor(code: EvalErrorCode, message: string) {
    super(`[gegenrede] ${message}`);
    this.name = "EvalError";
    this.code = code;
  }
}
