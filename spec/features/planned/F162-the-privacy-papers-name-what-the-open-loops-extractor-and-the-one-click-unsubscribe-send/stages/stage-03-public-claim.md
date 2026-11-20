# F162 stage 03 — public claim `ai-provider-receives` names the extractor

Needs stage 01: ledger rows C263 and C264 (their sources are the proofs of the claim). May run next to 02.
Part of [`../plan.md`](../plan.md). Lands on the proof (no review job).

## Step 1 — the claim text, ledger and proofs

- **Goal:** the public security page states the extractor call next to the triage call, so the claim of what the AI provider receives is complete.
- **Seam:** `apps/docs/src/security/claims.ts`, claim `ai-provider-receives` (en and pl).
- **Decisions:** P8, D3, D5. Add after the history-check sentences, in the words of P3 and without "open loops" as a panel string: "An optional feature, off by default, that tracks answers to the user's own sent mail also sends, for each such mail of the last 14 days, its subject, the local time of the send, the number of recipients and up to 8,000 characters of its text, but no address from the headers; the text can hold quoted mail of other people." Polish: the same facts, D3 forms. `ledger` adds `C263`, `C264`; `proofs` adds `packages/core/src/loops/extractor.ts` and `apps/server/src/modules/triage/prompts/extractor-v1.ts` (each named in a cited row's source; `claimProblems` checks it). The condition stays "The install uses the OpenAI provider."; the cited rows name the flag, and `condition_missing` fires only for a row condition with no claim condition (the claim has one).
- **Interfaces:** none new.
- **Test:**
  1. `apps/docs/src/security/claims.test.ts`: the claim `ai-provider-receives` text holds `8,000 characters` (en) and `8000 znaków` (pl), and its `ledger` holds `C263`. Use the existing table form of that file if it has one.
  2. `apps/docs/src/flagged-text.test.ts` passes with the new text (no flagged string; no new case).
  3. `bun run docs:build` prints `claim_check ok`.
- **Break check:** remove `C263` from `ledger` locally: case 1 fails, and `claim_check` reports `proof_not_in_ledger` for `extractor.ts`; revert.
- **Check:** `bun test apps/docs/src/security/claims.test.ts apps/docs/src/flagged-text.test.ts`, then the plan's Proof.
- **Out of scope:** a claim for the one-click request (P8), a deploy of the docs site, the security pages under `apps/docs/src/content/docs` other than what the claim renders.

## Done when

- The public claim names the extractor fields and cites C263, C264; `docs:build` prints `claim_check ok`.
- The plan's Proof exits 0; the final message copies the `check:job` line.
