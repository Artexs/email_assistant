PASS 50d8b1f9850b8071500c704ef69d1dfd9096235f

I reviewed the stage 01 candidate for F163 (the privacy papers name the reply-style call). The candidate adds the in-app texts, the openai and gemini registry rows, one legal version, ledger rows C271–C272 and their ties. I checked it against `stages/stage-01-privacy-and-version.md`, `plan.md` and `plan-review-1.md`. `git rev-parse HEAD` is `50d8b1f9850b8071500c704ef69d1dfd9096235f`, which matches the candidate. The tree is clean, and `git log HEAD..master` is empty.

## Blocking
None.

## Unverified
- **The full stage Proof and `check:job`:** I did not run them (review job). I did not receive a `check:job` line for this candidate. These files are not verified by me: `claims.test.ts` (272 pin), `legal-papers.test.ts`, `apps/web/src/lib/legal-*.test.ts`, docs build `claim_check`. A grep found 272 `| Cnnn |` rows in `docs/legal/claims.md`, which matches the new pin.

## Facts checked (proven by code read)
- **The privacy page (en, pl) "AI model" text matches the code:**
  - It says "tries to cut off" and adds "The text can still hold names, addresses and quoted mail of other people" (pl "Treść może nadal zawierać…").
  - It says "No subject and no address from the headers". `listStyleSources` selects only `body_text`, `to_addresses` and `cc_addresses`. The addresses feed only `names`.
  - It says "at most two calls with the same texts", which matches `STYLIST_MAX_CALLS` 2.
  - It says "A call that fails at the AI service is not tried again". `stylist.ts` throws `StylistCallError` on any non-output LLM error.
  - It says "at most 1,000 characters", which matches `STYLE_SUGGESTION_MAX_CHARS`.
  - It says "does not store it". `recordAttempts` writes `llm.call` rows with counts only, and the audit row holds the outcome and the count.
  - The caps it names are 100 mails, 14 days, 1,500 and 60,000 characters. The button label is quoted per language, and the style text comes before the Gemini sentence.
  - The route is `requireOwner` behind `reply_drafts` and `style_from_sent`, so "only when an owner taps" holds.
- **The daily limit (review note N2):** the privacy page does not state a run limit. C272 says "at most 3 runs a day that end with an answer, a failed check or an AI error". That matches `CALL_OUTCOMES` (suggestion, checks, output, provider), and `sent_off` is not counted.
- **Other text seams:** the DPA Drafts line, the privacy "AI results", "Why and on what basis" Drafts and "AI and decisions" all follow P4 and P5 in en and pl.
- **Registries:** `openai` and `gemini` `purpose` and `dataReceived` name the style call in the D3 strings. `gemini` gained the reply-draft fields (P6). C136 and C139 follow.
- **Legal version:** `terms.ts` has one added line, `2026-11-20.3`, and no landed entry changed. The commit time is 2026-11-20 23:15 UTC, so `nextLegalVersion` gives `.3`. v0.4.4, the newest tag, does not hold `2026-11-20.2`. So one re-acceptance covers both versions, and no second release-note line is needed.

## Notes
- **N1, plausible: the `mailbox-profile` purpose wording is misleading** (`packages/core/src/legal/data-categories.ts:269-270`).
  - The text says the writing style is "used in the drafts that the AI writes or in a style suggestion from your sent mail that an owner saved". It reads as if the profile is used in a suggestion. In fact the saved style can come from a suggestion.
  - The stylist prompt does not send the stored style. It sends only the samples, the language and the count. The code uses only the stored signature, and only locally for the cut.
  - Better: "…the writing style that you set for a mailbox, or that an owner saved from a style suggestion, used in the drafts that the AI writes". The pl text needs the same fix.
  - This is a digest input, so the fix must come before this version lands or ride the same unlanded entry (D4). C173 already says it the right way.
- **N2, plausible: Polish grammar.** "Temat i żaden adres z nagłówków nie są wysyłane" (pl privacy) is awkward. "Nie są wysyłane temat ani adresy z nagłówków" is more natural. The facts are the same, so this is not blocking.
- **N3, plausible: unclear phrase.** "drafts of the system" (en privacy, C271) and "szkice systemu" (pl) are vague. The code excludes sent mail that the system sent from an approved draft (`action_id` set, `style-sources.ts:12`). "mail that the assistant sent from an approved draft" is clearer.
- **N4, plausible: carried over from plan review N2.** The C272 limit relies on the in-memory per-process `running` lock. Two server processes could exceed 3 counted runs. This matters only if more than one HTTP process serves the route.
- **N5, by design (D2): use sites are not tied.** The ties pin the constants, not the places that use them. The C272 counts (3 runs, 2 calls) and the registry "14 days" have no string tie. Only the case 1 pins guard them, which is enough to force a re-check.
- The new tests follow the § Tests rules of `docs/code-patterns.md`: exact values, `test.each` tables, and each fails when its code breaks (see below). No rule break.

## Checks I ran
- `bun install --frozen-lockfile` (Bun 1.4.4, which matches `.bun-version`): 991 packages installed.
- `bun test apps/server/src/legal-outside-calls.test.ts`: 38 pass, 0 fail.
- `bun test packages/core/src/web/legal-version.test.ts`: 47 pass, 0 fail. So the `.3` digest matches the current digest inputs.
- Break check 1: I set `STYLE_SAMPLE_MAX_CHARS` to 1499 and ran the tie file. 7 fail: both cap pins, the en and pl privacy page ties, the C271 and C272 tie, and the openai and gemini row ties.
- Break check 2: I set `STYLE_SUGGEST_WINDOW_MS` to `7 * DAY_MS`. 3 fail: the age pin and the en and pl page ties.
- I reverted both breaks with `git checkout`. `git status --short` is empty.
- I ran no suite, lint or typecheck, and I committed nothing.

## Note check
- **Privacy page and DPA text (en, pl) match the code facts:** proven. Evidence: the files `apps/web/src/legal/en/privacy.md`, `apps/web/src/legal/pl/privacy.md`, `apps/web/src/legal/en/dpa.md` and `apps/web/src/legal/pl/dpa.md`. I compared them with `apps/server/src/modules/replies/stylist.ts`, `apps/server/src/modules/replies/style-suggest.ts` and `apps/server/src/modules/mail/repo/style-sources.ts`.
- **The daily limit is not stated as an absolute, and the openai and gemini rows are present:** proven. Evidence: the files `apps/web/src/legal/en/privacy.md` (no run limit), `docs/legal/claims.md` (C272 names the counted outcomes) and `packages/core/src/legal/subprocessors.ts`.
- **Legal version, one line added and no landed entry changed:** proven. Evidence: the file `packages/core/src/web/terms.ts`, which differs from `6808fc975` by one appended line.
- **Legal version, the digest matches the inputs:** not proven under the note rule. My `legal-version.test.ts` run (47 pass) shared a bash call with `;` and `| tail`, and I saved no log. I did not rerun it (the rule allows one run).
- **Tie tests fail when a constant changes:** not proven under the note rule. Both break runs and the clean run (38 pass; 7 fail at 1499; 3 fail with a 7-day window) used `;` and `| grep` in one call, and I saved no log. I did not rerun them. The test code is in the file `apps/server/src/legal-outside-calls.test.ts`.
- **Easy-to-miss rule "Run no test suite":** followed. This session ran only single-file `bun test` commands on `apps/server/src/legal-outside-calls.test.ts` and `packages/core/src/web/legal-version.test.ts`. It ran no `test:*`, lint or typecheck.
- **Reminder, tests once per job and no `test:unit/int/e2e`:** followed. I ran single files only.
- **Reminder, `check:job` for a job that commits product code:** not applicable. This review job committed nothing.
- **Reminder, a review runs no suite, lint or typecheck:** followed. I ran one file for the digest doubt and one file for the break checks.
- **Reminder, never delete `node_modules/.cache`:** followed. I did not touch it.
