# F153 stage 03 — the public claim `ai-provider-receives`

Part of [`../plan.md`](../plan.md).

Needs stage 01: rows C261 and C262 in `docs/legal/claims.md`, `sevenDayLimitProblems` (`@ea/core`) used by `apps/docs/src/security/claims.test.ts`.
May run next to 02 (no shared file).

## Step 1 — the claim states the context and the history check

- Goal: the security page claim holds what the AI provider gets, with proofs; the "does not promise" section no longer carries it.
- Files: `apps/docs/src/security/claims.ts` (claim `ai-provider-receives`), `apps/docs/src/content/docs/security.mdx`, `apps/docs/src/content/docs/pl/security.mdx`.
- Decisions: D5, P4, P5. The claim:
  - `ledger`: `["C030", "C031", "C032", "C261", "C262"]` (the ids stage 01 used).
  - `proofs`: add `apps/server/src/modules/mail/repo/lookup.ts` and `docs/capabilities/trust.md` to the four that stay. Each proof must be named in a cited row's source (`claimProblems`, `proof_not_in_ledger`).
  - `text.en` sense: "This install uses OpenAI as the AI model. For each mail that it classifies, the assistant sends the text, subject, sender, To and Cc addresses and date, the delegates, and up to three earlier mails of the same thread as context. Each context mail carries its sender, subject, date and up to 500 characters of its body, and it can be older than 7 days. The assistant does not classify a mail that is older than 7 days, unless the operator loads old mail once or the optional history check runs. That check, off by default, classifies up to 500 mails of the last 30 days when it is turned on, when a mailbox is connected, on request and after a change of the AI model." The Polish text says the same facts.
  - The sentence that points to "What this product does not promise" goes.
  - `condition`: C262 has a condition, so `claimProblems` needs one. Keep "The install uses the OpenAI provider." and add no flag key (the order test forbids `UPPER_SNAKE` keys; a lowercase flag name is also not reader text). The text above already says "optional, off by default".
- Pages: remove the 7-day bullet from "What this product does not promise" in both languages. Keep the short-list line of each page true for the new claim (it names the classified mail and the context today; add nothing about the history check there).
- Check: `bun test apps/docs/src/security/claims.test.ts apps/docs/src/flagged-text.test.ts`.

## Step 2 — the tests guard the move

- Files: `apps/docs/src/security/claims.test.ts`.
- Test, fixed values:
  1. `ai-provider-receives` cites `C261` and `C262`, and `text.en` matches `/500 characters/` and `/can be older than 7 days/`; `text.pl` matches `/500 znaków/`.
  2. No line of `security.mdx` and no line of `pl/security.mdx` under the heading of "What this product does not promise" (Polish: the matching heading) names the 7-day limit.
  3. `sevenDayLimitProblems` over every line of both pages and every claim text and condition is `[]` (the scan of today plus the Polish page).
  4. The claim passes `claimProblems` against the real ledger (the existing all-claims test covers it; name it in the final message).
- Check: `bun test apps/docs/src/security/claims.test.ts`. Put the old "does not promise" bullet back by hand: case 2 fails. Remove `C261` from `ledger` by hand: case 1 fails and `bun run docs:build` prints `claim_check failed` with `proof_not_in_ledger apps/server/src/modules/mail/repo/lookup.ts` (stage 01 lets only C261 cite `lookup.ts`; if another cited row names it, report that instead of this case). Undo both. Report the outputs.
- Done when: the cases pass and the two hand reverts fail as written.

## Done when

`bun run docs:build` prints `claim_check ok` (in `/tmp/f153/docs.log`), and the Proof of `plan.md` prints `PROOF_OK` after the last commit.

## Out of scope

A deploy of the docs site (held by the public pages work, F121, until its publish gate); the legal papers and the ledger (stages 01 and 02); other claims.
