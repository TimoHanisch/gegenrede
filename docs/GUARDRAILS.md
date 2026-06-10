# GUARDRAILS.md — Why gegenrede has hard limits, and what they are

gegenrede helps people write evidence-grounded replies to misinformation. The same pipeline, with a few constraints removed, would be a tool for automated astroturfing: mass-producing coordinated, persuasive-sounding replies with any stance attached. We know this. The project's answer is not "trust us" — it is a set of invariants designed into the architecture, enforced in code and CI, and documented here so that anyone (contributor, journalist, funder, skeptic) can verify what this tool can and cannot do.

These invariants are **non-negotiable**. Pull requests that weaken them will be closed with a reference to this document, per `GOVERNANCE.md`. This applies regardless of how useful the proposed feature would be.

## The invariants

### G1 — No evidence, no draft

The reply composer can only be invoked on a claim that has a matched professional fact-check (or, in later versions, a completed verification dossier with cited evidence). This is enforced at the type and schema level: the compose request *requires* a fact-check match object, and requests without one are rejected before any model is called. The composer cannot be pointed at arbitrary text with an arbitrary stance.

**Why:** this is the line between counter-speech and propaganda tooling. gegenrede argues *from* published, attributable evidence; it does not generate free-standing persuasion. It also keeps the project out of the arbiter-of-truth position — the epistemic claim is always "publisher X rated this claim Y," never "we decided this is false."

### G2 — No auto-posting, ever

The tool never holds posting credentials, never calls a platform write API, and never synthetically submits a form. Its output ends at the user's clipboard or a prefilled compose box. A human reads, edits, and presses send — under their own name, on their own account. This is enforced architecturally (no such API surface exists in the codebase) and by a CI gate that fails any commit introducing platform write endpoints.

**Why:** three independent reasons. *Legal/ethical attribution:* the human is the speaker; the tool is stationery. *Platform terms:* automated posting violates the ToS of every targeted platform and would expose users to bans. *Integrity:* an auto-posting fork of this codebase is a bot network by definition — see G3.

### G3 — Every draft is different

Drafts are generated fresh per user and per request with deliberate stylistic variance (randomized structure, formality, and opener framing). Two users countering the same post will produce structurally different replies.

**Why:** platforms detect coordinated inauthentic behavior (CIB) largely through text similarity and timing among clusters of accounts — the same network-analysis research this project's framework document describes. If hundreds of users pasted near-identical replies, they would correctly be flagged as a coordination network, harming both the users and the legitimacy of civil counter-speech. Variance protects users from CIB enforcement and keeps the project from structurally *being* what it opposes.

### G4 — Tone floor

Generated drafts follow the evidence-based debunking structure (fact first; the false claim named once, flagged as false; technique explained where relevant; source cited) and are checked after generation against a hostility filter: no insults, no slurs, no attacks on the post's author, no diagnosing motives. A draft that fails is regenerated once; if it fails again, that variant is omitted with an explanation — never silently patched.

**Why:** the research on observational correction is consistent — corrections persuade the silent audience, and hostile corrections trigger reactance and lose that audience. A tone floor isn't politeness theater; it's what makes the output effective. It also protects users socially: they sign what the tool drafted.

### G5 — Drafts fit the platform

Length limits per platform are enforced at generation time; over-length drafts are regenerated with a tighter budget, then truncated at a sentence boundary with a visible warning as last resort.

### G6 — The source link stays visible

The fact-check URL is appended to every draft programmatically (the model is never trusted to reproduce URLs). If the user deletes it while editing, the UI warns — once, non-blocking. The human remains in charge of their own words.

**Why:** the link is the substance. A correction without a checkable source is just another assertion in the thread.

### G7 — Rate limits

Client-side limits (default 10 draft-sets per hour, short cooldown between sets; user-adjustable downward, capped at 20/hour) keep individual usage inside the rhythm of a human participating in conversations.

**Why:** the goal is multiplying thoughtful counter-speech, not enabling reply-flooding. High-frequency serial replying gets users flagged for spam, looks like brigading, and — per the burnout findings from organized counter-speech groups — isn't even effective. The ceiling is deliberately generous for any good-faith use.

### G8 — Friction before sending

Drafts open in an editable state, and the copy/insert actions are briefly delayed after drafts render.

**Why:** a 1.5-second pause is not an obstacle; it is a nudge to actually read what you're about to publish under your own name. The accuracy-prompt literature shows that small attention nudges measurably improve sharing behavior. The human-edit step is the product's ethical core, so the UI makes skipping it slightly inconvenient.

## What these guardrails do not solve

We are honest about residual risk. This code is AGPL-3.0 licensed open source; a determined actor can fork it and remove every safeguard above. The license forces network-service forks to publish their source (removing the quiet commercial path), G1's evidence-grounding makes the legitimate pipeline structurally unhelpful for propaganda, and this document removes any ambiguity about intent — but none of that makes misuse impossible. We consider this trade-off acceptable for the same reason the rest of the security world does: transparency and auditability protect the many users of the honest tool better than obscurity would hinder the few abusers, who have ample alternatives anyway.

What we commit to: the official extension, the official builds, and the official index will always implement every invariant on this page. Any release that didn't would be a security incident, handled per `SECURITY.md`.

## For contributors

Each invariant has tests (the guardrail matrix, `pnpm test -- guardrails`) and several have CI gates. If a guardrail test fails, your implementation is wrong — not the test. Proposals to *change* a guardrail are not forbidden, but they follow the ADR process, require maintainer approval, and must engage with the rationale above rather than just the inconvenience at hand. "This would be easier without G1" is true and is not an argument.

## Research grounding

The framework behind these decisions, with sources, lives in `docs/disinformation-counter-framework.md` — in particular §8.1 (observational correction, bystander effects, reactance), §8.3 (misuse analysis and CIB self-protection), and §2.1 (coordinated-behavior detection). Key external anchors: Bode & Vraga on observational correction; Lewandowsky et al., *The Debunking Handbook 2020*; the coordinated-inauthentic-behavior detection literature surveyed in the framework doc; and the #ichbinhier experience with organized civil counter-speech in Germany.
