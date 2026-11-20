PASS d056dd988859ee374da730a9ad4e626f72486425

Reviewed commit `d056dd988859ee374da730a9ad4e626f72486425`. `git rev-parse HEAD` returned that sha. The diff base is `8ed22669d`, the master commit in the last merge. The stage 02 diff is commits `3851fac87` (the service) and `a1755e005` (the flag lists). I found no proven break of a stage 02 acceptance bullet. Before the land, the coordinator must resolve one proven merge conflict with master (note 1).

## Blocking

None.

## Unverified

- Tests, lint, typecheck and `check:job`: I did not run them, because the task says "Run no suite". The task gave me no worker `check:job` line to cite. The two new integration files and the guard-removal proofs that the stage asks for are therefore unverified by me.
- **The one check that would prove the candidate wrong:** `bun test apps/server/test/integration/replies-style-suggest.test.ts apps/server/test/integration/mail-style-sources.test.ts` at `d056dd98`. A red case there disproves the service contract. To prove the N1 guard (no sent system drafts in the samples), remove `.where("s.action_id", "is", null)` from `mail/repo/style-sources.ts`: case 1 of `mail-style-sources.test.ts` must then fail.

## Focus items (all by reading the code at HEAD)

- **Flags.** `style_from_sent` is in `packages/core/src/features.ts` with default off, epic `E6b` and remove-by `2027-03-01`, and it is listed in the lab seed and the flag tests. The service reads `sent_sync` before the call and after it. The route of stage 02b checks `style_from_sent` and `reply_drafts`, as D8 says. The service is not reachable yet: `styleSuggestion` is built in `start/triage.ts`, but no router uses it.
- **Org and mailbox scope.** `getMailbox` filters by `org_id`, and a mailbox of another org answers `not_found` (test). `listStyleSources` filters by `org_id` and `mailbox_id` (test 3: another org and a sibling mailbox are absent). The lock key is `orgId:mailboxId`.
- **The "Track my sent mail" switch, before and after the call.** `sentTrackingOn` checks the `sent_sync` flag and `getSentSyncState().enabled` before the lock. It checks them again after `recordAttempts`, so the calls still count in the cap. A switch turned off during the call gives `sent_off`, drops the text and writes audit outcome `sent_off`. A test turns the switch off inside the fake.
- **Only cut body text goes to the model.** The reader selects `body_text`, `to_addresses` and `cc_addresses`. The addresses feed only `names` for the check. `buildUser` gets only `samples`, the language and a random nonce. The retry text names the codes, never the failed text. Test 10 checks that the system and user prompts hold no subject, no To or Cc address and no From address. No date is selected.
- **Per-mailbox lock.** An in-memory `Set` holds the key. Check and add are synchronous, and the key is released in `finally`. The lock comes before the limit read. This deviates from the stage order (limit, then lock), but the docstring says why, and the order is safer. One test runs two requests at once and gets one `busy`.
- **The 3-per-day limit counts only runs with a call.** `countMailboxOutcomesSince` counts rows of `mailbox.style_suggested` with `outcome IN (suggestion, checks, output, provider)`, from `quotaDayStart(now, QUOTA_TIMEZONE)` on. That is the same day as `capVerdict`. Tests: a fourth run gives `limit`, and three `too_few` runs do not count. `limit`, `busy`, `blocked` and `not_found` write no row.
- **The 80 % rule of `LLM_DAILY_CAP`.** `capVerdict` runs with trigger `tap`, so the stylist ignores the 80 % wait of automatic drafts and stops at 100 % (D9). The cap counts every `llm.call` row of the mailbox across all roles, and `maxCalls` limits the retry. Test: classifier rows fill the cap, the answer is `llm_cap` and the fake gets no call.
- **N1, the assistant's own drafts (plan-review-1.md).** `action_id IS NULL` is in the reader, and test 1 has an `origin = user` row with an action id that stays out. Closed for drafts that carry the `X-EA-Action-Id` header (see note 4).
- **Audit rows hold no text.** The data is `{ mailbox_id, count, outcome, via: "web" }` and the actor is the user. Tests assert the exact data with `toEqual`. Log lines hold `count`, `reason` and `errorFields` only, and all of these are in `log-fields.ts`.
- **One test-mail filter for both readers.** The new `mail/repo/sent-test-mail.ts` (`sentTestMailFilter`) now serves `loops/analysis-repo.ts` and `listStyleSources`. It has the same semantics as the old inline `eb.or`: the synthetic Message-ID marker, or the normalized `from_address` in the senders, and an empty sender list adds no `IN ()`. The senders go in as bound parameters. Under the `synthetic` scope the service passes `scope.testMail` (test). With `realMail = false` the service answers `llm_off` and never queries `sent_emails` (a spy plugin proves it).

## Notes

1. **Proven by `git merge-tree` (log `merge-tree-master.log` in the job folder): the candidate conflicts with current master.** The stylist eval of stage 06 landed on master after this branch last merged it (`e8ceb9810`).
   - `apps/server/src/modules/replies/stylist.ts` is an add/add conflict, and `triage/prompts/stylist-v1.ts` is a content conflict.
   - The two branches each wrote their own `suggestStyle` and their own retry text under the same version id `stylist-v1`, and the texts differ. Master has `name: "…name of a person"` and passes `retry` inside `StylistInput`. The candidate has "…of a person or a company" and passes a second argument.
   - Master's `suggestStyle` does not run `checkProfileInput`. The candidate's does, as D7 requires.
   - Resolution must leave one `suggestStyle` and one retry text that both production and the eval use (stage 06: "no copy"). Keep the `checkProfileInput` step. Then run `check:job` again.
   - Also, `stylist-v1` text changed after stage 01 without a new version id. That is harmless while the flag is off and no gate file exists (P3), but the merge decides which text is `stylist-v1`.
2. **Plausible: a call that ends in `sent_off` does not count in the day limit.** A run whose switch goes off during the call made a model call, but `sent_off` is not in the list of outcomes that count. This matches `interfaces.md`, which lists `sent_off` among the outcomes without a call. Abuse is bounded: turning the switch off deletes the sent rows, and `LLM_DAILY_CAP` still counts the call. A cheap fix is to count `sent_off` rows with `count > 0`, or to give the outcome a distinct name.
3. **Plausible: the lock works only inside one process.** `main.ts` starts one process today. If two containers overlap during a deploy swap, two runs can pass the lock and the limit read together.
4. **Plausible: some sent drafts may still count as the user's own mail.** If the user's mail client drops `X-EA-Action-Id` when it sends a system draft, sync stores an `origin = user` row with a null action id, and the skeleton draft enters the samples. The plan has no other signal for this, so no action is needed now.
5. **Proven by reading: one wrong path in the docs.** The entry table of `docs/capabilities/reply-drafts.md` lists `listStyleSources` at `replies/style-suggest.ts`. It lives in `mail/repo/style-sources.ts`. The `sent-mail.md` rule 13 line "goes to no LLM" is still stale, but rewriting it is the task of stage 02b.
6. **Test rules.** No new test breaks a rule of `docs/code-patterns.md` § Tests. Each has an exact expected value, and the repeated shapes use `test.each` (by reading).

## Checks run

- `git rev-parse HEAD` (alone) → `d056dd988859ee374da730a9ad4e626f72486425`.
- `git diff 8ed22669d HEAD --stat` (saved to `diff-stat.log` in the job folder; 25 files), plus reads of the service, the reader, the filter, `spend.ts`, `sent-sync.ts`, `actions/repo/planned.ts` and both integration tests.
- `git merge-tree --write-tree --name-only HEAD master` → CONFLICT in `replies/stylist.ts` (add/add) and in `triage/prompts/stylist-v1.ts`; saved to `merge-tree-master.log`.
- No `bun` command ran: no test, lint or typecheck.

## Note check

- HEAD is the candidate: proven. `git rev-parse HEAD` printed `d056dd988859ee374da730a9ad4e626f72486425`.
- Focus items hold in the diff: proven by reading. Evidence: `apps/server/src/modules/replies/style-suggest.ts`, `apps/server/src/modules/mail/repo/style-sources.ts`, `apps/server/src/modules/mail/repo/sent-test-mail.ts`, `apps/server/src/modules/replies/spend.ts`, and the file list in `diff-stat.log` (job folder). The tests were not executed.
- Stage 02 Step 1 test 1 (excluded rows → 1 source): proven by reading. `apps/server/test/integration/mail-style-sources.test.ts` case 1. Not executed.
- Step 1 test 2 (120 rows → 100, newest first): proven by reading. `apps/server/test/integration/mail-style-sources.test.ts` case 2. Not executed.
- Step 1 test 3 (other org and other mailbox absent): proven by reading. `apps/server/test/integration/mail-style-sources.test.ts` case 3. Not executed.
- Step 1 test 4 (`testOnly`): proven by reading. `apps/server/test/integration/mail-style-sources.test.ts` case 4. Not executed.
- Step 2 test 1 (suggestion, count 6, 1 call row, 1 audit row): proven by reading. `apps/server/test/integration/replies-style-suggest.test.ts`. Not executed.
- Step 2 test 2 (`too_few` 4, no call): proven by reading. Same file. Not executed.
- Step 2 test 3 (name, then clean → 2 rows): proven by reading. Same file. Not executed.
- Step 2 test 4 (phone twice → `checks`): proven by reading. Same file. Not executed.
- Step 2 test 5 (`{}` → `output`): proven by reading. Same file. Not executed.
- Step 2 test 6 (switch off during the call → `sent_off`): proven by reading. Same file. Not executed.
- Step 2 test 7 (limit, busy, `too_few` does not count): proven by reading. Same file, three cases. Not executed.
- Step 2 test 8 (cap used up → `llm_cap`): proven by reading. Same file. Not executed.
- Step 2 test 9 (`realMail` false → `llm_off`, no read): proven by reading. Same file, spy plugin. Not executed.
- Step 2 test 10 (no subject or address in the prompt): proven by reading. Same file. Not executed.
- Stage Done "touched tests pass; guards fail their test when removed; Proof line PASS": not proven. I have no worker `check:job` line, and review jobs run no suite.
- Final message names the commit and the disproving check: proven. See this message, § Unverified.
- Easy-to-miss rule "Run no suite": followed. Only git, grep, sed and cat ran, and no `bun` command ran.
- Reminder "tests once per job, no test:* runs": followed. No test command ran.
- Reminder "a product-code job ends with `check:job`": not applicable, because this is a review with no commit.
- Reminder "a review runs no suite, lint or typecheck": followed. None ran.
- Reminder "never delete `node_modules/.cache/`": followed. Nothing was deleted.

Decisions for the owner: none
