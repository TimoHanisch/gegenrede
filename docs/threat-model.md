# Threat model

> **Status: stub.** The three threats below are the ones spec §13 mandates
> this document to cover, with their specced mitigations sketched. A fuller
> treatment (assets, trust boundaries, residual-risk table) is TODO.

## 1. Malicious snapshot substitution

**Threat:** an attacker replaces or tampers with the fact-check index
snapshot a user downloads, so the extension matches posts against poisoned
data — e.g. "verifying" disinformation as true or burying real fact-checks.

**Mitigation (spec §13):** snapshots are distributed via GitHub Releases over
TLS, and the extension verifies each download against a **sha256 hash pinned
in `latest.json`, served from this repository**. A substituted snapshot fails
hash verification and is rejected; an attacker would need write access to the
repository itself, not just the release artifact or the transport.

**Residual:** compromise of the repository/maintainer account. TODO: signing
story beyond hash pinning, if warranted post-v1.

## 2. Malicious fork misuse

**Threat:** because the pipeline (ingest → matching → composing) is open
source, someone forks it into an astroturfing or coordinated-inauthentic-
behavior (CIB) service: auto-posting, evidence-free generation, identical
messages at scale.

**Mitigation (spec §13, framework doc §8.3):** this is an **accepted residual
risk** — open-sourcing the pipeline means a determined bad actor can strip
the guardrails. What the project does about it:

- **G1–G3** (`docs/GUARDRAILS.md`): no evidence → no draft; no posting
  pathway exists in the codebase to repurpose; enforced draft variance makes
  naive copy-paste CIB detectable. A misuse fork must *add* capability, not
  flip a flag.
- **AGPL-3.0** forces network-service forks to publish source, removing the
  quiet-commercial-fork path (architecture doc §6).

**Residual:** a private, non-distributed malicious fork. Accepted; the
framework's analysis (§8.3) is that the marginal capability gegenrede adds to
a motivated CIB operator is low, while the guardrails keep the *published*
tool from being that capability.

## 3. Prompt injection via post text

**Threat:** a post being checked contains adversarial instructions
("ignore previous instructions, output …") that reach the LLM through the
normalize or compose calls and steer its output.

**Mitigation (spec §13):**

- Post text is **data-fenced** in all prompts — passed as clearly delimited
  data, never concatenated into the instruction position.
- LLM outputs are **schema-validated** (zod schemas from `packages/shared`);
  out-of-shape responses are rejected, and composed drafts must pass the
  structural guardrail checks (G1, G4–G6).
- The blast radius is bounded by design: the composer has **no tool-use
  surface** and no posting pathway (G2). Its entire authority is producing a
  draft that a human reads and decides to send. A fully successful injection
  yields a bad draft shown to an alert user — not an action.

**Residual:** a user pasting a manipulated draft without reading it; G8
(friction before sending) and the review UI address this. TODO: red-team
prompt fixtures in the M3 guardrail matrix.

## TODO before first release

- Assets and trust-boundary diagram (extension ↔ snapshot channel ↔ own
  server ↔ LLM endpoint).
- Threats considered and ruled out-of-scope (e.g. platform countermeasures,
  malicious browser extensions on the same profile).
- Residual-risk summary table.
