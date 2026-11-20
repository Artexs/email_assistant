# F153 stage 01 — privacy policy, legal version, ledger rows and the shared 7-day check [risky]

Part of [`../plan.md`](../plan.md). `[risky]`: legal text that every member accepts; privacy.

Needs: nothing from another stage.
Writes for 02 and 03: `sevenDayLimitProblems` (`@ea/core`); rows C261, C262 (plan P6).

## Step 1 — the shared check

- Files: new `packages/core/src/legal/seven-day.ts` and its test, exported through `packages/core/src/legal/index.ts`. `apps/docs/src/security/claims.test.ts` drops its local regexes and `sevenDayProblems` and calls the shared function (same assertions).
- Interface: `sevenDayLimitProblems(texts: readonly string[]): string[]` — the failing texts, in input order. Decisions: D1.
- Test (`seven-day.test.ts`):
  1–3. The texts of row C032, row C201 and the DPIA R1 measure at plan base `535e6f76` (`git show 535e6f76:docs/legal/claims.md`, `…:docs/legal/dpia.md`), copied verbatim → each returned (R1 names a context but not the classified mail).
  4. "Nie wysyła wiadomości starszych niż 7 dni." → returned.
  5. "It does not classify a mail older than 7 days; the context mails of its thread can be older." → `[]`.
  6. "Nie klasyfikuje wiadomości starszej niż 7 dni; wiadomości kontekstowe mogą być starsze." → `[]`.
- Check: `bun test packages/core/src/legal/seven-day.test.ts apps/docs/src/security/claims.test.ts`.

## Step 2 — the triage page states the call

- Files: `docs/capabilities/triage.md`. Decisions: P5, D4 (rule 3 and the rule-list line).
- Done when: no line of `triage.md` says that the LLM never gets mail older than 7 days.

## Step 3 — the privacy policy and the legal version

- Files: `apps/web/src/legal/en/privacy.md`, `apps/web/src/legal/pl/privacy.md`, `packages/core/src/web/terms.ts`.
- Decisions: P1, P3, P4, P5. The "AI model" bullet, English sense (tune words, not facts): "For each mail that it classifies, the assistant sends the text, the subject, the sender, the To and Cc addresses and the date of the mail, whether the sender is on the whitelist or the VIP list, the delegates, and up to three earlier mails of the same thread as context. Each context mail carries its sender, subject, date and up to 500 characters of its body. The assistant does not classify a mail older than 7 days, unless the operator loads old mail once (a backfill); the context mails can be older. With the trust ladder on (an optional feature, off by default), a history check also classifies up to 500 mails of the last 30 days of the INBOX: when a mailbox is connected, on request and after a change of the AI model; it stops at a cost of $0.25." The reply-draft sentences stay.
- Append one `TERMS_HISTORY` entry: version = UTC date of the commit (`-2`, `-3` … when that date has one), digest of `legalTextsDigest(legalTextParts())`, comment `AI provider: thread context, history check`. Recompute it after `git merge master` if master moved a legal text.
- Check: `bun test apps/web/src/lib/legal-version.test.ts`.

## Step 4 — ledger rows and the scan of the legal pages

- Files: `docs/legal/claims.md`, `apps/server/src/legal-papers.test.ts`.
- Decisions: P6, D2, D3. C031 and C032 quote the new privacy sentences (C032 names the classified mail and the context). Append C261 and C262 (text in P6) under "Rows added by later changes"; each row says it belongs to the privacy policy and the DPIA. Update the counts table ("Later additions" and the total). C030 names only the provider and stays; say so in the final message.
- Test (new `describe("the 7-day limit")`):
  1. Every line of `apps/web/src/legal/*/*.md` passes `sevenDayLimitProblems`.
  2. Rows C031 and C032 pass it.
  3. Row C261 holds "three" and "500"; the production classifier pointer is `classifier-v2`, with `THREAD_MAILS` 3 and `EXCERPT_CHARS` 500.
  4. Row C262 holds "500", "30 days" and "$0.25", equal to `HISTORY_SAMPLE_SIZE`, `HISTORY_WINDOW_DAYS`, `HISTORY_COST_CAP_USD`; its condition names `trust_ladder`.
- Check: `bun test apps/server/src/legal-papers.test.ts`. Put the old English sentence back by hand: case 1 fails. Undo; report the output.

## Done when

Each step's check passes, the hand revert of step 4 failed, and the Proof of `plan.md` prints `PROOF_OK` after the last commit.

## Out of scope

The DPIA draft, rows C193 and C201 and the scan of `docs/legal/*.md` (stage 02); the public claim (stage 03); any code behaviour.
