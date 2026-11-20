# F125 stage 16 log: core look-alike cases become tables

Base: `e2bfbc7c`. Commits: `F125 G04 MERGE-TABLE: core tables that keep a unique kill` (7 files), `F125 G05 MERGE-TABLE: core tables` (6 files). Raw runs: `/tmp/f125-s16/` (JUnit, lcov, `mutation.json`).

## Keys

`cut-keys.ts` at the stage base (fresh scan `/tmp/f125-s16/scan/cases-static.tsv`): G04 37 keys, G05 29 keys, all `ok` (none `rejected`, `missing`, `deferred-none` or `deferred-two`). Each group became one `test.each` table per look-alike group, in the file and `describe` of the old cases, at the place of the first case. Each row label is the old case name, so the JUnit names stay the same. A case with two inputs (G05 `untrusted-text` rows) keeps both pairs in one row. No case is "kept apart": every key case had the shape of its table.

### G04 (33 keys cut into tables)

| file | describe | row (old case name) | status |
| --- | --- | --- | --- |
| `digest/ai-text.test.ts` | aiTextFor | triage_error | ok |
| `digest/ai-text.test.ts` | aiTextFor | llm_blocked | ok |
| `digest/ai-text.test.ts` | aiTextFor | blocklist | ok |
| `digest/local-time.test.ts` | lateMin | 12. minutes outside the quiet hours: 2 before 22:00 and 9 after 07:00 (Warsaw, November) | ok |
| `digest/local-time.test.ts` | lateMin | a range inside the day counts every minute | ok |
| `digest/local-time.test.ts` | lateMin | to before from is 0 | ok |
| `digest/local-time.test.ts` | lateMin | the spring night is 8 h long: 20:00Z to 06:00Z leaves 1 h before 21:00Z and 1 h after 05:00Z | ok |
| `digest/schedule.test.ts` | dueDigestSlot | not yet due | ok |
| `digest/schedule.test.ts` | dueDigestSlot | a slot older than 6 hours is skipped | ok |
| `digest/schedule.test.ts` | dueDigestSlot | slots before the link time never count | ok |
| `ops/alert-step.test.ts` | nextAlertStep | 1. no row and firing opens | ok |
| `ops/alert-step.test.ts` | nextAlertStep | 2. no row and clear does nothing | ok |
| `ops/alert-step.test.ts` | nextAlertStep | 3. no row and between does nothing | ok |
| `ops/alert-step.test.ts` | nextAlertStep | 4. an open notice that was not sent is sent again while firing | ok |
| `ops/alert-step.test.ts` | nextAlertStep | 4b. an open notice that was not sent is sent again while between | ok |
| `ops/alert-step.test.ts` | nextAlertStep | 5. an open notice that was not sent closes silently when clear | ok |
| `ops/alert-step.test.ts` | nextAlertStep | 6. firing less than 6 h after the last notice does nothing | ok |
| `ops/alert-step.test.ts` | nextAlertStep | 7. firing exactly 6 h after the last notice repeats | ok |
| `ops/alert-step.test.ts` | nextAlertStep | 8. between 7 h after the last notice repeats | ok |
| `ops/alert-step.test.ts` | nextAlertStep | 8b. between less than 6 h after the last notice does nothing | ok |
| `ops/alert-step.test.ts` | nextAlertStep | 9. clear after an open notice resolves | ok |
| `outgoing/user-text.test.ts` | cleanUserText | T1 line ends, controls and bidi | ok |
| `outgoing/user-text.test.ts` | cleanUserText | T3 only hidden characters | ok |
| `outgoing/user-text.test.ts` | cleanUserText | T4 Polish letters stay | ok |
| `outgoing/user-text.test.ts` | cleanUserText | the end of every line is trimmed, not only the end of the text | ok |
| `outgoing/user-text.test.ts` | cleanUserText | a lone CR is a line break, C1 and DEL go, tab stays in a body | ok |
| `triage/untrusted-text.test.ts` | markUntrustedText | replaces a leftover @ | ok |
| `triage/untrusted-text.test.ts` | markUntrustedText | replaces a phone number next to a date, and keeps the date | ok |
| `triage/untrusted-text.test.ts` | markUntrustedText | replaces a phone number with dashes | ok |
| `triage/untrusted-text.test.ts` | markUntrustedText | replaces a phone number after letters | ok |
| `trust/history.test.ts` | historyOutcome | 188 acted-on, none moved is inconclusive | ok |
| `trust/history.test.ts` | historyOutcome | a moved share of 0.03 fails | ok |
| `trust/history.test.ts` | historyOutcome | a moved share of 0.02 is not over 0.02: inconclusive | ok |

Tables: `aiTextFor` 3 rows; `nextAlertStep` 11 rows (cases 1 to 9 with 4b and 8b; case 10 has three checks and stays); `cleanUserText` 5 rows (the one-line case stays); `historyOutcome` 3 rows; `dueDigestSlot` 3 `null` rows; `lateMin` 4 rows; `markUntrustedText` 4 rows.

### G05 (29 keys cut into tables)

| file | describe | row (old case name) | status |
| --- | --- | --- | --- |
| `digest/llm-pause.test.ts` | llmPauseLine | a spent quota says so in words | ok |
| `digest/llm-pause.test.ts` | llmPauseLine | another code gets the generic line with the code | ok |
| `digest/llm-pause.test.ts` | llmPauseLine | a start on another day shows the day | ok |
| `digest/local-time.test.ts` | formatClock and formatDay | same local date: HH:MM | ok |
| `digest/local-time.test.ts` | formatClock and formatDay | same year: D Mon HH:MM | ok |
| `digest/local-time.test.ts` | formatClock and formatDay | other year: D Mon YYYY HH:MM | ok |
| `digest/local-time.test.ts` | quietEnd | before midnight: 07:00 on the next local date | ok |
| `digest/local-time.test.ts` | quietEnd | after midnight: 07:00 on the same local date | ok |
| `digest/local-time.test.ts` | quietEnd | the spring night | ok |
| `digest/text.test.ts` | cutText | removes the Arabic letter mark | ok |
| `digest/text.test.ts` | cutText | removes bidi override characters | ok |
| `digest/text.test.ts` | cutText | replaces a lone surrogate | ok |
| `metrics/week.test.ts` | addWorkingDays | Friday + 1 is Monday at the same clock time | ok |
| `metrics/week.test.ts` | addWorkingDays | Saturday + 1 is Monday | ok |
| `metrics/week.test.ts` | addWorkingDays | Sunday + 1 is Monday | ok |
| `metrics/week.test.ts` | addWorkingDays | Wednesday + 3 skips the weekend | ok |
| `metrics/week.test.ts` | addWorkingDays | keeps the local clock time across the autumn change | ok |
| `metrics/week.test.ts` | weekStartOf | gives the local Monday | ok |
| `metrics/week.test.ts` | weekStartOf | Sunday 23:30 local is still the old week | ok |
| `metrics/week.test.ts` | weekStartOf | Monday 00:30 local starts the new week | ok |
| `site.test.ts` | docsUrl | T1 English home | ok |
| `site.test.ts` | docsUrl | T2 Polish home | ok |
| `site.test.ts` | docsUrl | T3 English page | ok |
| `site.test.ts` | docsUrl | Polish page | ok |
| `site.test.ts` | docsUrl | a segment that only holds dots inside a name is not a .. segment | ok |
| `triage/untrusted-text.test.ts` | markUntrustedText | replaces email addresses | ok |
| `triage/untrusted-text.test.ts` | markUntrustedText | replaces phone numbers | ok |
| `triage/untrusted-text.test.ts` | markUntrustedText | keeps dates and short numbers | ok |
| `triage/untrusted-text.test.ts` | markUntrustedText | replaces a link glued to a word | ok |

Tables: `llmPauseLine` 3 rows; `formatClock` 3; `quietEnd` 3 (the "outside the quiet hours" case stays); `cutText` 3; `weekStartOf` 3; `addWorkingDays` 5 (the `+ 0` case stays); `docsUrl` 5; `markUntrustedText` 4 rows with 2 pairs each, and the 4 single-pair G04 rows stay in their own table (the two groups never share a table).

## Deferred

4 G04 keys: `triage/cost.test.ts` (`costPerMail`, 4 cases). An unmerged branch (`limen/2026-11-19-f138-stage-02-remove-gemini-prov-e2edaabc`, the commit that removes the Gemini provider) changes this file (`git diff --name-only master...<branch>`; `git cherry master <branch>` shows its commit as not on master). Cut stage rule: the file is not changed; a later run takes the rows after that branch lands. No other open `limen/*` branch changes a file of this stage (checked on all of them; `packages/core` files changed by open branches: `legal/subprocessors.ts`, `metrics/m7.test.ts`, `triage/cost.test.ts`, `triage/cost.ts`, `web/terms.ts`, all from that one branch).

Rows of cost.test.ts:

| `triage/cost.test.ts` | costPerMail | uses the price of the day | ok |
| `triage/cost.test.ts` | costPerMail | switches the 3.8 Flash price on 2027-01-01 | ok |
| `triage/cost.test.ts` | costPerMail | prices a Flash-Lite mail | ok |
| `triage/cost.test.ts` | costPerMail | prices a gpt-6-luna mail | ok |

## Mutation scope

Mutate globs: the non-test files in the import closure of the 11 changed test files (relative imports and `@ea/core` subpaths into `packages/core/src`; stops at `node_modules`), 80 files, each as `--mutate src/<file>`:

`contacts/address.ts`, `digest/ai-text.ts`, `digest/answers.ts`, `digest/llm-pause.ts`, `digest/local-time.ts`, `digest/schedule.ts`, `digest/text.ts`, `llm-providers.ts`, `llm-roles.ts`, `metrics/m3.ts`, `metrics/week.ts`, `notices/kinds.ts`, `notices/push.ts`, `ops/alert-step.ts`, `ops/alert-text.ts`, `ops/events.ts`, `ops/kinds.ts`, `outgoing/user-text.ts`, `replies/eligibility.ts`, `send-limits.ts`, `site.ts`, `tenancy.ts`, `texts/ai-text.ts`, `texts/answers.ts`, `texts/approvals-en.ts`, `texts/approvals-pl.ts`, `texts/approvals.ts`, `texts/attachments.ts`, `texts/bot-common.ts`, `texts/bot-en.ts`, `texts/bot-pl.ts`, `texts/bot.ts`, `texts/brief.ts`, `texts/categories.ts`, `texts/clock.ts`, `texts/common.ts`, `texts/digest.ts`, `texts/follow-up.ts`, `texts/index.ts`, `texts/locale.ts`, `texts/loop-taps.ts`, `texts/minimal.ts`, `texts/notices-en.ts`, `texts/notices-pl.ts`, `texts/notices.ts`, `texts/operator.ts`, `texts/push.ts`, `texts/reply-mail.ts`, `texts/report-mail.ts`, `texts/review.ts`, `texts/suspicious.ts`, `texts/why.ts`, `texts/would-do.ts`, `time.ts`, `triage/address.ts`, `triage/analysis.ts`, `triage/categories.ts`, `triage/cost.ts`, `triage/dkim-pass.ts`, `triage/dkim-signature.ts`, `triage/eval-case.ts`, `triage/expire-filter.ts`, `triage/index.ts`, `triage/metrics.ts`, `triage/payloads.ts`, `triage/planners.ts`, `triage/policy.ts`, `triage/quota-day.ts`, `triage/rules.ts`, `triage/sender-history.ts`, `triage/settings.ts`, `triage/suspicious.ts`, `triage/threshold.ts`, `triage/untrusted-text.ts`, `triage/urgency-profile.ts`, `trust/history.ts`, `trust/key.ts`, `trust/tripwire.ts`, `web/mail-oauth.ts`, `web/zod.ts`

Runs: `bash scripts/test-audit/mutation.sh /tmp/f125-s16/before …` at the base before the first edit, `…/after` at the second commit. Mutants compared: 6631 in each run (before: 3813 Killed, 31 Timeout, 229 Survived, 47 NoCoverage, 2511 Ignored; after: 3811 Killed, 31 Timeout, 231 Survived, 47 NoCoverage, 2511 Ignored).

## Unstable mutants found

First `cut-proof` run: FAIL on 2 mutants of `packages/core/src/contacts/address.ts` (24:7 `ConditionalExpression` and 25:10 `MethodExpression`, both Killed before, Survived after). Cause, checked in `mutation.json`: each was killed by exactly one test, `contacts/address.test.ts` > `addressCaseForms` > `no character that folds to a letter is missing, over every code point`, with the status reason `this test timed out after 5000ms` (a load timeout counts as a kill). That test and `address.ts` are untouched by this stage. Checks: a second run at the stage tip (`/tmp/f125-s16/after-2`) and a run at the base commit in a scratch worktree (`/tmp/f125-s16/before-b`, no change of mine) both show the same two mutants `Survived` with no killer. So the kill came from a timeout on a loaded machine, not from a case this stage changed. The final `cut-proof` below runs with `--data /tmp/f125-s16/data`: the audit `mutation-unstable.tsv` plus these two rows (`file`, `line`, `column`):

```
packages/core/src/contacts/address.ts	24	7
packages/core/src/contacts/address.ts	25	10
```

The shared `audit/data/mutation-unstable.tsv` is not edited here (stage 20 mutates the same closure and appends to it too, which would conflict); the coordinator adds these two rows when it lands the stages.

## cut-proof

Command: `bun scripts/test-audit/cut-proof.ts --before /tmp/f125-s16/before-1 --before /tmp/f125-s16/before-2 --after /tmp/f125-s16/after --expect unit=+0 --log … --data /tmp/f125-s16/data` (`mutation.json` of the one before run copied into both before dirs; the tool needs it in each).

Before: `/tmp/f125-s16/before-1`, `/tmp/f125-s16/before-2`. After: `/tmp/f125-s16/after`. Expected: unit=+0, int=+0.

| lane | cases before | cases after | serial time before | serial time after |
| --- | --- | --- | --- | --- |
| unit | 208 | 208 | 8.06 s | 2.82 s |
| int | 0 | 0 | 0.00 s | 0.00 s |

- Case counts: pass.
- Covered lines: pass; 1 noise files skipped.
- Mutants: pass; 0 on one side only.

Result: PASS

## Name diff

`diff` of the sorted `classname :: name` lists of `unit.xml` (before-1 against after): empty (208 names each; before-2 also 208).

## Break once

One row of each table got a wrong expected value, only that row failed, then the file was restored (`/tmp/f125-s16/breaks.py`, output `/tmp/f125-s16/breaks.log`):

- `digest/ai-text.test.ts`: only `aiTextFor > llm_blocked` fails (1 fail)
- `ops/alert-step.test.ts`: only `nextAlertStep > 7. firing exactly 6 h after the last notice repeats` fails (1 fail)
- `outgoing/user-text.test.ts`: only `cleanUserText > a lone CR is a line break, C1 and DEL go, tab stays in a body` fails (1 fail)
- `trust/history.test.ts`: only `historyOutcome > a moved share of 0.03 fails` fails (1 fail)
- `digest/schedule.test.ts`: only `dueDigestSlot > a slot older than 6 hours is skipped` fails (1 fail)
- `digest/local-time.test.ts`: only `lateMin > to before from is 0` fails (1 fail)
- `digest/local-time.test.ts`: only `formatClock and formatDay > same year: D Mon HH:MM` fails (1 fail)
- `digest/local-time.test.ts`: only `quietEnd > the spring night` fails (1 fail)
- `digest/llm-pause.test.ts`: only `llmPauseLine > another code gets the generic line with the code` fails (1 fail)
- `digest/text.test.ts`: only `cutText > replaces a lone surrogate` fails (1 fail)
- `metrics/week.test.ts`: only `weekStartOf > Sunday 23:30 local is still the old week` fails (1 fail)
- `metrics/week.test.ts`: only `addWorkingDays > Sunday + 1 is Monday` fails (1 fail)
- `site.test.ts`: only `docsUrl > Polish page` fails (1 fail)
- `triage/untrusted-text.test.ts`: only `markUntrustedText > replaces a phone number after letters` fails (1 fail)
- `triage/untrusted-text.test.ts`: only `markUntrustedText > replaces a link glued to a word` fails (1 fail)
