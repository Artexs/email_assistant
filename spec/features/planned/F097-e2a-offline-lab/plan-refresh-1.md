# F097 plan refresh 1

- Old base: `9d9bfb8` (2026-11-13 23:23; the `Refresh:` line of `ticket.md`).
- New base: `54b715b` (`HEAD`, 2026-11-14 11:00).
- Job: `2026-11-14-f097-plan-refresh-bebd5c40` (planner, Opus 5.5).

## Drift output (`scripts/plan-drift.sh spec/features/planned/F097-e2a-offline-lab 9d9bfb8`)

```
plan base: 9d9bfb8 2026-11-13 23:23
HEAD:      54b715b 2026-11-14 11:00
named paths: 116; changed since base: 7; gone: 1
gone: apps/server/src/modules/mail/repo.ts
changed: apps/server/src/modules/channels/callbacks.ts
changed: apps/server/src/platform/config.test.ts
changed: apps/server/src/platform/config.ts
changed: apps/server/src/platform/db/schema.ts
changed: apps/server/test/integration/channels-callbacks.test.ts
changed: packages/core/src/index.ts
changed: packages/core/src/triage/payloads.ts
commits after the base that touch the named paths:
  83a070f 11-14 10:19 F099 s02.1: actions.send_started_at column, backfill and partial index
  91b5cf8 11-14 10:13 feat(server): send limit env keys and sendLimits(config) (F099 s01.2)
  931a573 11-14 10:12 feat(core): pure send-limit rule checkSendLimits (F099 s01.1)
  e7b7a7d 11-14 10:11 F098 s01 step 1: language rule in core
  62e084b 11-14 02:32 F091 s04: draftKinds is the one list of draft kinds
  0bd8220 11-14 02:21 History copy: apps/server/src/modules/mail/repo.ts as apps/server/src/modules/mail/repo/shared.ts (split, trimmed in the next commit)
  f6f92e4 11-13 23:23 Telegram picker: edit the message to 'Already saved' when a pick saves nothing
```

The script does not see paths that start with a dot or with `docs/`. A manual diff found three more files that the plan uses: `.env.example` (F099 send-limit keys), `.agents/limen/styleguide.md` (PD-009 capability-page rule, notices rule, draft-kind rule) and `docs/code-patterns.md` (F091 § Add an action type or a draft kind, § Notices are facts, § Capability map, the `repo/` folder rule). F095 stages 04–08 created `docs/capabilities/` (11 pages) and `apps/server/src/capability-map.test.ts`. After the refresh, `scripts/plan-drift.sh … 54b715b` prints `no drift`.

## Changes

| Where | What | Why |
| --- | --- | --- |
| plan.md status | `Plan base: 54b715b, refreshed 2026-11-14`. | Refresh rule 6. |
| plan.md F2 | `mailKindFilter` at `mail/repo/emails.ts:11`; callers by file and function in `mail/repo/claims.ts`, `mail/repo/lookup.ts`, `actions/repo/claims.ts`, `actions/repo/filters.ts`, `triage/repo.ts`; `scopeAdmits` caller `actions/undo.ts:43`; `triage/service.ts:472`. | F091 split `mail/repo.ts` and `actions/repo.ts`. |
| plan.md F13 | F091, F088, F030 done. The active tickets that share files now: F098 stages 06–12 (Telegram texts registry), F099 stage 12 (a flag). F100 depends on stages 01, 03, 04, 14. | Lanes moved. |
| plan.md F19–F22 (new) | Capability pages and their test; file sizes against the 400-line rule; tests that list every feature key; three places of the old eval rule in `code-patterns.md`. | New at `HEAD` or not noted before. Each fact is read at `54b715b`. |
| plan.md D38 (new; Q9) | `listReviewSample` in a new `triage/review-repo.ts`, the review picker in a new `channels/review-taps.ts`, the stage 13 pool in a new `triage/eval-pool.ts`. Interfaces do not change. | `triage/repo.ts` 629, `callbacks.ts` 393, `eval.ts` 557 lines; § Size and shape. F100 does the same (`triage/metrics-repo.ts`). |
| plan.md D39 (new; Q10) | If F098 stage 06+ landed first, the `/review` texts go into `packages/core/src/texts/` with en and pl, and `texts.bot.commands` gains `review`. | F098 D9 and D18 move every Telegram text into the registry. |
| plan.md Rules for every stage | A stage that lands behaviour updates its capability page; names only paths and scripts that exist; keeps the "Checked against" line. | Styleguide § Prefer and `code-patterns.md` § Capability map (PD-009), new since the base. |
| plan.md How to run 3 | Shared files: F098 06–12, F099 12, F092 01 (migration), F100 04/10/13–15. The F091 and F088 lines are removed. | Lanes moved. |
| plan.md Log | Refresh line. | — |
| stage 01 steps 1–3 | Config precedent `sendTestAddresses` (`config.ts:406`); address check at `config.ts:261-268`; `.env.example` line goes before the new `SEND_LIMIT_*` keys; every file path after the F091 split; `listThreadContext` caller `triage/service.ts:472`; Undo caller `actions/undo.ts:43`. | F091 split; F099 config keys. |
| stage 01 step 4 (new) | Capability pages `triage.md` (rules 6, 13, 15), `actions-and-undo.md` (the `ACTIONS_SCOPE` lines). | PD-009. |
| stage 03 step 2 | `listReviewSample` in `triage/review-repo.ts` (D38). | Size rule. |
| stage 03 step 3 | Picker helpers in `channels/review-taps.ts`; `pickedText(…, saved)` of F030 stays; F098 replaces F088 as the co-editor of `callbacks.ts`; D39. | F030 landed; F088 done; size rule. |
| stage 03 step 4 (new) | Capability pages: `triage.md` (source list, callbacks row, test) and `digest-and-notices.md` (rule 10, callbacks row). | PD-009. |
| stage 04 header | Shared files: F098 06–12 and F099 12, with the D39 rule. | Lanes moved. |
| stage 04 step 1 | `review_command` as the last registry entry; update `tenancy-features.test.ts`, `web-operator.test.ts` case 4, `org-flag-cli.test.ts` case 1; their check. | These tests list every flag (F21); without the edit `test:int:ci` fails. |
| stage 04 step 3 (new) | Capability pages `digest-and-notices.md` (rule 9, entry points), `tenancy-and-plans.md` (the "three flags" limit line), `triage.md` (rule 12). | PD-009. |
| stage 11 step 3 | `triage.md` gets the `bun run sim` row and a rule sentence; check runs `capability-map.test.ts`. | PD-009; the test checks the script name. |
| stage 13 step 1 | The pool goes into `triage/eval-pool.ts`; tests stay in `eval.test.ts` through `runEval`. | `eval.ts` is 557 lines (D38). |
| stage 13 step 3 | `triage.md` rule 13 gains `eval --sim` and the caps. | PD-009. |
| stage 14 step 1 | Grep for `wilsonInterval` first; import it if F100 stage 08 added it. | F100 plan § Cold review N21 asked this outside edit of the F097 plan; the edit was not applied before. |
| stage 15 | `triage.md` gains `--real --json` and `--gap`; check runs the capability-map test. | PD-009. |
| stage 16 step 3 | `triage.md` gains `--judge` and the `judgeDraft` row. | PD-009. |
| stage 21 step 3 | Three places in `code-patterns.md` (lines ~75, ~149, ~223, was ~95 and ~160); `triage.md` gate line; check greps that no "go/no-go" is left. | F091 stage 04 added the draft-kind table row; F095 moved lines. |
| stage 22 step 2 | `triage.md` exists; stage 22 adds only the report pointers (earlier stages added the rest); prettier and capability-map test. | F095 created the page. |
| questions.md | Q9 (D38) and Q10 (D39), both small defaults. | Refresh rule 4. |

No change to the outcome, the scope, the stage count, the stage order, the migration or any interface that F100 uses (`TestMailRule`, `mailKindFilter(kind, rule)`, `testMailRule(config)`, the `review` source and CHECK name, `reviewMessage(deps, link)` in `channels/commands.ts`, `wilsonInterval`).

## Facts checked that needed no change

- `triage_feedback.source` CHECK in `db/migrations/20261104000001_triage.sql:49`, no later migration changes it; `feedbackSources` at `packages/core/src/triage/categories.ts:31` (F3). The newest migration is `20261114100001_send_started_at.sql`; stage 03 asks for a later timestamp.
- `schema.ts` changed only by `actions.send_started_at`; `triage_feedback.source` is still `text`.
- `runEval` loop `for (const c of input.cases)` at `triage/eval.ts:468`; `toClassifierInput` at `:156`; `EVAL_RECEIVED_AT`; private `textIsClean` at `:196` (F1, stages 10, 16).
- Judge row `LLM_JUDGE_*` at `.env.example:25-29`; `OPENAI_RPM=60` at `:18`; `rolesWithoutPrompt.judge = "E2a"` (F6, F7).
- `llmPrices` has `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gpt-6-luna`; `costPerMail(model, tokensIn, tokensOut, at)` (F8, D26).
- `bodyTextFromSource` at `mail/imap/mapper.ts:81`, not exported from `mail/index.ts`; `renderSeedMessage` exported (F9, stage 10).
- `testmailCategories` at `packages/core/src/testmail/batch.ts:3`; `isReservedHost`, `hasUnreservedAddress`, `hasUnreservedUrl`, `hasPhoneNumber` private (F10, stage 05).
- `commandNames` (`channels/port.ts:32`), `BOT_COMMANDS` (`telegram/polling.ts:10`), `helpText` (`channels/texts.ts:1`), `runCommand` and `createUpdateHandlers` (`channels/commands.ts`), `CALLBACK_MAX_BYTES = 64` (`digest/message.ts:15`), prefixes `fr fc fe fx fu ap ar as rs ag gw dd` (F11).
- `listUnlabeled` at `triage/repo.ts:245`; `listForLabeling` in `triage/feedback.ts`; `skipIfSame` at `feedback.ts:75-79` (F12, edge cases).
- `createOrgWithMailbox` at `apps/server/test/integration/fixtures.ts:53`; `createFixedLlmClient` in `platform/llm/testing.ts` (F18).
- `DigestItem`, `renderDigest`, `categoryTag`, `senderLabel`, `cleanSubject`, `cutText`, `formatClock`, `MESSAGE_MAX_CHARS`, `buildDigestMessage`, `listMailboxes`, `isFeatureOn`, `setOrgFeature`, `localToInstant`, `THRESHOLDS`, `computeMetrics` exist with the names the stages use.
- `LinkedChat.locale` existed at the old base (F088 stage 04).
- `evals/cases` holds 108 cases; `evals/testmail/README.md:88` still says the checker has no file tools (D33).
- `.agents/limen/styleguide.md:30` still holds the sentence stage 21 replaces.
- No landed ticket did a step of this plan: no `TEST_SENDER_ADDRESSES`, `review_command`, `'review'` source, `wilsonInterval`, `listReviewSample` or `packages/core/src/sim/` at `HEAD`.
- F092 (RLS, active) sets the tenant scope only in web requests; Telegram commands and CLIs run unset, so stages 03 and 04 need no change. F092 adds no rule for repository signatures.

## Review

The refresh added steps (stage 01 step 4, stage 03 step 4, stage 04 step 3) and decisions D38 and D39, so a cold review runs (`plan-review-2.md`).
