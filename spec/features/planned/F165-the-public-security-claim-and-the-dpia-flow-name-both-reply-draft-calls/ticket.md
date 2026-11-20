---
touches:
  - apps/docs/src/security
  - docs/legal
opened: 2026-11-21
---

# F165 · The public security claim and the DPIA flow name both reply-draft calls

## Outcome
The public security page and the DPIA data-flow list what the reply-draft feature sends to the AI provider: the draft call and the reply-style call. Today the public claim names no reply-draft call, and the style call needs reply drafts. This must be true before `style_from_sent` goes on for anyone outside the owner.

## Scope
- Start at the claim in `apps/docs/src/security/claims.ts` (the list of what the AI provider gets) and the DPIA flow in `docs/legal/`.
- Name the draft call (thread text, instruction line, writing style) and the style call (cut own Sent mail, on an owner's tap), with the same limits as the privacy page.
- Add ledger rows and tie tests in the style of `apps/server/src/legal-outside-calls.test.ts`.

## Out of scope
- Turning on any flag or changing code behaviour.
- A new legal version unless a digest input changes.

## Acceptance
- The public security claim names both reply-draft calls and what each sends.
- The DPIA flow names both calls and their data.
- A tie test fails when a limit of the style call changes.
- `bun run check:job` passes.
