// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 gegenrede contributors

// G2 grep-gate (spec §10.4 G2, §14; GUARDRAILS.md G2; CLAUDE.md Hard Rule 1):
// fails on any tracked file containing platform write-API endpoints or
// synthetic form-submission idioms. The gate is never adjusted to let code
// pass — if it fires, remove the offending code.
//
// Dependency-free so it can run in CI before `pnpm install` and locally via
// `pnpm guardrails:gate`. The default run executes the self-test first (the
// patterns must catch a known-bad corpus and ignore a known-good one), then
// scans every git-tracked file outside the path allowlist.
//
// Legitimate textual mentions (docs, this gate itself) are excused via
// ALLOWLISTED_PATHS. A source line that trips a pattern without violating G2
// can carry a `g2-allow: <reason>` comment; such lines are reported in the
// output but do not fail the gate. An unexplained marker is still visible in
// every CI log, so abuse is auditable.
//
// Usage: node scripts/guardrails-grep-gate.mjs [--self-test]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Paths never scanned. Keep this list minimal: nothing under packages/ or
// services/ may ever be added here.
const ALLOWLISTED_PATHS = [
  "docs/", // spec + guardrail docs legitimately name the blocked endpoints
  ".github/workflows/guardrails.yml",
  "scripts/guardrails-grep-gate.mjs",
];

const ALLOW_MARKER = "g2-allow:";

/** @typedef {{ id: string, description: string, regex: RegExp }} G2Pattern */

/** @type {G2Pattern[]} */
const G2_PATTERNS = [
  {
    id: "x-create-tweet-v2",
    description: "X API v2 tweet endpoint (POST /2/tweets creates a post)",
    regex: /api\.(?:twitter|x)\.com\/2\/tweets/i,
  },
  {
    id: "x-statuses-write-v1",
    description: "X API v1.1 status write endpoints (update/retweet/destroy)",
    regex: /statuses\/(?:update|retweet|destroy)/i,
  },
  {
    id: "x-retweets-v2",
    description: "X API v2 retweet endpoint",
    regex: /api\.(?:twitter|x)\.com\/2\/users\/\S+\/retweets/i,
  },
  {
    id: "reddit-write-api",
    description: "Reddit write endpoints (/api/submit, /api/comment)",
    regex: /\/api\/(?:submit|comment)\b/i,
  },
  {
    id: "form-request-submit",
    description: "programmatic form submission via requestSubmit()",
    regex: /\.requestSubmit\s*\(/,
  },
  {
    id: "form-submit-call",
    description: "programmatic form submission via submit()",
    regex: /\.submit\s*\(\s*\)/,
  },
  {
    id: "form-submit-prototype",
    description: "form submission via HTMLFormElement.prototype.submit",
    regex: /HTMLFormElement\.prototype\.submit/,
  },
  {
    id: "synthetic-submit-event",
    description: "synthetic submit event construction or dispatch",
    regex: /new\s+SubmitEvent\s*\(|dispatchEvent\s*\([^)]*["'`]submit["'`]/,
  },
  {
    id: "synthetic-submit-click",
    description: "synthetic click on a compose/submit control",
    regex:
      /(?=.*\.click\s*\()(?=.*(?:tweet|reply|submit|comment|post)[-_]?button)/i,
  },
];

// Self-test corpus. Every line here must trip at least one pattern, and every
// pattern must catch at least one line, so a pattern edit that silently
// narrows coverage fails CI.
const KNOWN_BAD = [
  'await fetch("https://api.twitter.com/2/tweets", { method: "POST", body });',
  'await fetch("https://api.x.com/2/tweets", { method: "POST" });',
  'client.post("https://api.twitter.com/1.1/statuses/update.json", form);',
  "await fetch(`https://api.x.com/2/users/${userId}/retweets`, opts);",
  'await fetch("https://oauth.reddit.com/api/submit", { method: "POST" });',
  'await redditClient.post("/api/comment", { thing_id: id, text });',
  "composeForm.requestSubmit();",
  "composeForm.submit();",
  'form.dispatchEvent(new SubmitEvent("submit", { cancelable: true }));',
  "HTMLFormElement.prototype.submit.call(composeForm);",
  "document.querySelector('[data-testid=\"tweetButton\"]').click();",
];

// Lines a compliant implementation will legitimately contain (prefilling a
// compose box, clipboard hand-off, reading public data). None may match.
const KNOWN_GOOD = [
  "composeBox.value = draft.text;",
  "await navigator.clipboard.writeText(draft.text);",
  'const info = await fetch("https://oauth.reddit.com/api/info?id=t3_x");',
  'button.addEventListener("click", openOverlay);',
  'el.dispatchEvent(new Event("input", { bubbles: true }));',
  'form.addEventListener("submit", (e) => e.preventDefault());',
];

/** @param {string} line @returns {G2Pattern[]} */
function matchingPatterns(line) {
  return G2_PATTERNS.filter((pattern) => pattern.regex.test(line));
}

/** @returns {boolean} */
function selfTest() {
  /** @type {string[]} */
  const failures = [];

  for (const line of KNOWN_BAD) {
    if (matchingPatterns(line).length === 0) {
      failures.push(`known-bad line not caught by any pattern: ${line}`);
    }
  }
  for (const pattern of G2_PATTERNS) {
    if (!KNOWN_BAD.some((line) => pattern.regex.test(line))) {
      failures.push(`pattern "${pattern.id}" catches no known-bad line`);
    }
  }
  for (const line of KNOWN_GOOD) {
    const hits = matchingPatterns(line);
    if (hits.length > 0) {
      const ids = hits.map((pattern) => pattern.id).join(", ");
      failures.push(`known-good line falsely caught by ${ids}: ${line}`);
    }
  }

  if (failures.length > 0) {
    console.error(`guardrails-grep-gate self-test FAILED:`);
    for (const failure of failures) {
      console.error(`  ${failure}`);
    }
    return false;
  }
  console.log(
    `guardrails-grep-gate self-test passed — ${G2_PATTERNS.length} patterns, ` +
      `${KNOWN_BAD.length} bad / ${KNOWN_GOOD.length} good corpus lines`,
  );
  return true;
}

/** @typedef {{ file: string, line: number, ids: string, text: string }} Hit */

/** @returns {boolean} */
function scan() {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter(
      (file) =>
        !ALLOWLISTED_PATHS.some(
          (path) => file === path || file.startsWith(path),
        ),
    );

  /** @type {Hit[]} */
  const violations = [];
  /** @type {Hit[]} */
  const allowed = [];

  for (const file of files) {
    /** @type {string} */
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // tracked but absent (e.g. deleted in working tree)
    }
    if (text.includes("\0")) {
      continue; // binary
    }
    text.split("\n").forEach((line, index) => {
      const hits = matchingPatterns(line);
      if (hits.length === 0) {
        return;
      }
      const hit = {
        file,
        line: index + 1,
        ids: hits.map((pattern) => pattern.id).join(", "),
        text: line.trim(),
      };
      if (line.includes(ALLOW_MARKER)) {
        allowed.push(hit);
      } else {
        violations.push(hit);
      }
    });
  }

  for (const hit of allowed) {
    console.log(
      `g2-allow used at ${hit.file}:${hit.line} [${hit.ids}]: ${hit.text}`,
    );
  }

  if (violations.length > 0) {
    console.error(
      `guardrails-grep-gate FAILED — ${violations.length} G2 violation(s).`,
    );
    console.error(
      "gegenrede never posts on the user's behalf (GUARDRAILS.md G2). " +
        "Remove the code below; do not adjust this gate.",
    );
    for (const hit of violations) {
      console.error(`  ${hit.file}:${hit.line} [${hit.ids}]: ${hit.text}`);
    }
    return false;
  }

  console.log(
    `guardrails-grep-gate — no G2 violations in ${files.length} tracked files`,
  );
  return true;
}

const selfTestOnly = process.argv.includes("--self-test");
const ok = selfTestOnly ? selfTest() : selfTest() && scan();
process.exit(ok ? 0 : 1);
