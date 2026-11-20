# F153 stage 01 — privacy policy, AI registry rows, legal version, ledger rows and the shared 7-day check [risky]

Part of [`../plan.md`](../plan.md). `[risky]`: legal text that members accept; privacy.

Needs: nothing from another stage.
Writes for 02 and 03: `sevenDayLimitProblems` (`@ea/core`); rows C261, C262 (plan P6).

## Step 1 — the shared check

- Files: new `packages/core/src/legal/seven-day.ts` and its test (export through the legal index). `apps/docs/src/security/claims.test.ts` replaces its local `sevenDayProblems` with it (same assertions).
- Interface: `sevenDayLimitProblems(texts: readonly string[]): string[]` — failing texts, input order. Decisions: D1.
- Test (`seven-day.test.ts`):
  1. Rows C032 and C201 and the DPIA R1 measure, verbatim at plan base `535e6f76` (`git show`) → each returned.
  2. "Nie wysyła wiadomości starszych niż 7 dni." → returned.
  3. "The 7-day limit covers all mail that the AI gets." → returned.
  4. "It does not classify a mail older than 7 days; the context mails of its thread can be older." → `[]`.
  5. "Nie klasyfikuje wiadomości starszej niż 7 dni; wiadomości kontekstowe mogą być starsze." → `[]`.
- Check: `bun test packages/core/src/legal/seven-day.test.ts`.

## Step 2 — the privacy policy and the AI registry rows

- Files: `apps/web/src/legal/{en,pl}/privacy.md`, `packages/core/src/legal/subprocessors.ts` (rows `openai` and `gemini`, field `dataReceived`, en and pl).
- Decisions: P1, P4, P5, P7. The "AI model" bullet, English sense (words may change, facts not): "For each mail that it classifies, the assistant sends the text, the subject, the sender, the To and Cc addresses and the date of the mail, whether the sender is on the whitelist or the VIP list, the delegates, and up to three earlier mails of the same thread as context. Each context mail carries its sender, subject, date and up to 500 characters of its body. The assistant does not classify a mail older than 7 days, unless the operator loads old mail once (a backfill) or the history check below runs; the context mails can be older. With the trust ladder on (an optional feature, off by default), a history check also classifies up to 500 mails of the last 30 days of the INBOX: when the feature is turned on, when a mailbox is connected, on request and after a change of the AI model; it stops at a cost of $0.25." Reply-draft sentences stay.
- `dataReceived` of `openai` and `gemini`: the triage list in short form (text, subject, sender, To and Cc, date, sender marks, delegates, up to three earlier thread mails), then the draft part unchanged.

## Step 3 — the legal version

- File: `packages/core/src/web/terms.ts`. Decision: P3.
- Append one `TERMS_HISTORY` entry: version = UTC date of the commit (`.2`, `.3` … (`nextLegalVersion`, F148) when that date has one), digest of `legalTextsDigest(legalTextParts())`, comment `AI provider: thread context, history check`. Recompute after `git merge master` if master moved a legal text.
- Check: `bun test apps/web/src/lib/legal-version.test.ts`.

## Step 4 — ledger rows and the tests of the papers

- Files: `docs/legal/claims.md`, `apps/server/src/legal-papers.test.ts`, the row count of `claims.test.ts`.
- Decisions: P6, D2, D3. C031 and C032 quote the new privacy sentences (C032 names the classified mail, the context and both exceptions). C136 and C139 quote the new `dataReceived`. Append C261 and C262 (P6) under "Rows added by later changes". Only C261 cites `lookup.ts` (stage 03 needs it). Update the counts table and the row count of `claims.test.ts`. C030 stays (provider only).
- Test (new `describe("the 7-day limit")`):
  1. Every line of `apps/web/src/legal/*/*.md` passes `sevenDayLimitProblems`.
  2. Rows C031, C032 pass it.
  3. Row C261 and the English privacy page hold "three" and "500 characters"; the production classifier pointer is `classifier-v2`, with `THREAD_MAILS` 3 and `EXCERPT_CHARS` 500.
  4. Row C262 holds "500", "30 days" and "$0.25", equal to `HISTORY_SAMPLE_SIZE`, `HISTORY_WINDOW_DAYS`, `HISTORY_COST_CAP_USD`; its condition names `trust_ladder`.
  5. The English privacy page holds "history check" and "30 days"; the Polish page holds "30 dni" and "500".
- Check: `bun test apps/server/src/legal-papers.test.ts apps/docs/src/security/claims.test.ts`. Hand revert of the old English sentence: case 1 fails. Undo; report it.

## Done when

Each check passes, the hand revert failed, and the Proof of `plan.md` prints `PROOF_OK` after the last commit.

## Out of scope

DPIA, rows C193, C201, capability pages, scan of `docs/legal` (stage 02); public claim (stage 03); P8 texts; code behaviour.
