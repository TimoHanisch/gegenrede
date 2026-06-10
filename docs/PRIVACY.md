# PRIVACY.md — Data flows and privacy properties

> **Status: stub.** The data-flow list and the no-telemetry property below are
> normative and complete per spec §13/§12. Sections marked TODO will be
> completed before the first public release; the completion milestone is not
> yet pinned in the spec (tracked as a known gap).

## Data flows (exhaustive)

The only user content gegenrede ever processes is the text of the post you
explicitly check, and it flows to exactly one of the following, depending on
how *you* configured the extension:

1. **Local Mode (default):** post text never leaves your device. Embedding and
   matching run locally against a downloaded index snapshot.
2. **Server Mode:** post text is sent to **your own server** — the URL you
   entered in settings. There is no vendor-operated backend.
3. **LLM configured:** when you configure an LLM provider for normalization or
   draft composition, post text is sent to **the LLM endpoint you chose**
   (e.g. a local Ollama instance or an API provider with your own key).

Each of these flows is disclosed in the settings UI at the point where you
configure it. There are no other outbound flows of post content. In
particular:

- **No accounts.** Nothing to sign up for, no user identifier exists.
- **No analytics, no crash reporting** in v1 (see below).
- **Author handles are never sent anywhere.** The `authorHandle` field is
  excluded from every outbound serialization (spec §4.3); a test enforces
  this.
- **Post text is never logged by default**, neither in the extension nor in
  the self-hosted services (`LOG_BODIES` gate, off by default).

Non-content network traffic:

- **Extension updates:** delivered through the browser store's default update
  channel.
- **Index snapshot updates:** downloaded from GitHub Releases over TLS and
  verified against a sha256 hash pinned in `latest.json` served from this
  repository (see `docs/threat-model.md`).

## No telemetry — a property, not a toggle

There is no telemetry setting in gegenrede because there is no telemetry
(spec §12). This is a property of the codebase, not a preference: no
analytics, crash-reporting, or phone-home code exists to be switched off, and
adding any is rejected by project policy (`docs/GOVERNANCE.md`). You can
verify the property in the source — that is the point of it being open
source.

## TODO before first release

- GDPR posture in detail for self-hosters (roles, lawful basis, retention) —
  building on architecture doc §5.
- Browser-store privacy declarations (Chrome Web Store / AMO data-use forms)
  and how they map to the flows above.
- Plain-language summary of what the user-chosen LLM provider may retain,
  shown at configuration time.
