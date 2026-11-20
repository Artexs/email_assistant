# F154 final table

Core mutation score: **94.25 %** (full default run of `packages/core`, static mutants ignored, at the stage start commit `949ef0b4`). The audit line: `audit 86.45 %`. Score holds.

Run: `bash scripts/test-audit/mutation.sh /tmp/f154-s18/full`, 18 min 50 s. 21,730 mutants: 12,736 killed, 90 timeout, 653 survived, 130 no coverage, 8,121 ignored. The audit formula (killed plus timeout over killed, timeout, survived and no coverage) gives 94.25 % here; at the audit it gave 86.45 % (11,535 killed, 76 timeout, 1,483 survived, 337 no coverage).

Final counts come from `bun scripts/test-audit/mutation-gaps.ts --in /tmp/f154-s18/full/mutation.json --min 1 --by fn`. An audit row that moved or split across files (the text tables of approvals, notices and bot) gets the sum over its new files. A function with no row in the tool output has 0 counted mutants.

## Table cases

1. 122 rows, one per GAP item (below).
2. The 10 functions of the ticket scope (top 10 of the audit report § 4), audit then final: `replies/schema.ts` module level 42 → 0, `checkSpread` 38 → 1, `sim/sent-slot.ts` module level 33 → 0, `renderApprovalRequest` 29 → 9, `isOneEditApart` 29 → 8, `validateBatch` 26 → 0, `ipv4Allowed` 25 → 0, `checkCase` 24 → 7, `parseChangelog` 23 → 10, `deobfuscate` 23 → 0. Every final count is below its audit count.
3. Sum of the final counts of the 122 functions: 279. Sum of the audit counts: 1,257. 279 < 1,257.

The module-level rows of `schema.ts` and `sent-slot.ts` read 0 in a default run because most of their mutants are static (ignored). The `schema.ts` pair with static mutants is under "schema.ts with static mutants".

## The 122 functions

| file | function | audit count | final count | stage |
| --- | --- | --- | --- | --- |
| replies/schema.ts | (module level) | 42 | 0 | 02 |
| sim/checks.ts | `checkSpread` | 38 | 1 | 03 |
| sim/sent-slot.ts | (module level) | 33 | 0 | 04 |
| digest/approvals.ts | `renderApprovalRequest` | 29 | 9 | 05 |
| triage/suspicious.ts | `isOneEditApart` | 29 | 8 | 06 |
| testmail/batch.ts | `validateBatch` | 26 | 0 | 08 |
| web/public-content.ts | `ipv4Allowed` | 25 | 0 | 09 |
| sim/checks.ts | `checkCase` | 24 | 7 | 03 |
| changelog.ts | `parseChangelog` | 23 | 10 | 10 |
| replies/views.ts | `deobfuscate` | 23 | 0 | 02 |
| sim/scenario.ts | `validateScenario` | 23 | 1 | 04 |
| triage/suspicious.ts | `punycodeDecode` | 23 | 5 | 06 |
| web/notify.ts | (module level) | 21 | 10 | 10 |
| triage/suspicious.ts | `adapt` | 18 | 0 | 06 |
| triage/eval-case.ts | `prioritize` | 17 | 0 | 14 |
| web/public-content.ts | `r4ExternalAsset` | 17 | 11 | 09 |
| triage/suspicious.ts | `digitValue` | 16 | 7 | 06 |
| web/next-path.ts | `safeNextPath` | 16 | 5 | 09 |
| web/public-content.ts | `parseAllowList` | 16 | 14 | 09 |
| texts/bot.ts | `lastSync` | 14 | 0 | 13 |
| triage/suspicious.ts | `trustedAuthResults` | 14 | 5 | 07 |
| digest/digest.ts | `renderListed` | 13 | 6 | 11 |
| outgoing/sender.ts | `approvalViewOf` | 13 | 0 | 15 |
| sim/live/calendar-days.ts | `isRealDate` | 13 | 9 | 17 |
| testmail/target.ts | `buildCompareRows` | 13 | 4 | 08 |
| triage/dkim-pass.ts | `trustedAlignedPassDomains` | 13 | 8 | 07 |
| digest/notices.ts | `renderActionFailedNotice` | 12 | 0 | 12 |
| digest/weekly.ts | `evidenceItems` | 12 | 1 | 12 |
| notices/renderers.ts | `full` | 12 | 3 | 12 |
| sim/checks.ts | `openingOf` | 12 | 0 | 03 |
| texts/minimal.ts | `reviewInPanel` | 12 | 0 | 13 |
| web/replies.ts | `cleanReplyInstruction` | 12 | 0 | 10 |
| digest/approvals.ts | `chatQuoteText` | 11 | 3 | 05 |
| sim/fixtures.ts | `sentFixtureText` | 11 | 0 | 16 |
| web/delegation.ts | (module level) | 11 | 0 | 10 |
| digest/approvals.ts | `replyRecipientLines` | 10 | 2 | 05 |
| digest/digest.ts | `sortItems` | 10 | 4 | 11 |
| notices/render.ts | `renderNotice` | 10 | 10 | 12 |
| outgoing/message.ts | `buildOutgoingMessage` | 10 | 0 | 15 |
| sim/lang.ts | `detectLang` | 10 | 6 | 16 |
| sim/live/executive.ts | `cardsOf` | 10 | 2 | 17 |
| testmail/target.ts | `renderCompareTable` | 10 | 5 | 08 |
| loops/replies.ts | `messageIdsOf` | 9 | 3 | 15 |
| mail/providers.ts | `serversFor` | 9 | 0 | 14 |
| sim/draft-checks.ts | `draftCodeChecks` | 9 | 1 | 03 |
| sim/live/date-shift.ts | `shiftDatesInText` | 9 | 3 | 17 |
| sim/live/executive.ts | `kindOf` | 9 | 0 | 17 |
| sim/manifest.ts | `byId` | 9 | 5 | 16 |
| testmail/send-log.ts | `caseStates` | 9 | 1 | 08 |
| texts/approvals.ts | `tries` | 9 | 0 | 05 |
| texts/approvals.ts | `softCap` | 9 | 0 | 05 |
| triage/cost.ts | `priceRowFor` | 9 | 3 | 14 |
| triage/dkim-pass.ts | `stripCommentsAndQuotes` | 9 | 3 | 07 |
| triage/metrics.ts | `simGoNoGo` | 9 | 0 | 14 |
| triage/settings.ts | `describeSettings` | 9 | 0 | 14 |
| contacts/address.ts | `caseFormTable` | 8 | 4 | 14 |
| digest/local-time.ts | `localInstants` | 8 | 8 | 12 |
| loops/extractor.ts | `normalizeAnswer` | 8 | 0 | 15 |
| sim/live/run-plan.ts | `planLiveRun` | 8 | 5 | 17 |
| sim/to-eval-case.ts | `threadOf` | 8 | 0 | 16 |
| texts/approvals.ts | `contentSoft` | 8 | 0 | 05 |
| texts/bot.ts | `approvalsLine` | 8 | 0 | 13 |
| texts/loop-taps.ts | `more` | 8 | 0 | 13 |
| texts/notices.ts | `loopsNone` | 8 | 0 | 13 |
| texts/notices.ts | `urgent` | 8 | 0 | 13 |
| triage/dkim-signature.ts | `tagsOf` | 8 | 1 | 07 |
| triage/suspicious.ts | `skeleton` | 8 | 1 | 06 |
| digest/digest.ts | `cutToLimit` | 7 | 0 | 11 |
| digest/notices.ts | `renderUrgentNotice` | 7 | 1 | 12 |
| digest/weekly.ts | `autoItems` | 7 | 0 | 12 |
| digest/weekly.ts | `renderWeeklyReport` | 7 | 0 | 12 |
| loops/brief.ts | `oldestFirst` | 7 | 4 | 15 |
| replies/digits.ts | `alnumStream` | 7 | 6 | 02 |
| replies/input.ts | `cutChars` | 7 | 2 | 02 |
| sim/plan-bank.ts | `buildSlot` | 7 | 0 | 16 |
| triage/address.ts | `splitAddress` | 7 | 3 | 14 |
| triage/suspicious.ts | `isRiskyAttachment` | 7 | 3 | 07 |
| triage/suspicious.ts | `isDisplayNameSpoof` | 7 | 2 | 07 |
| contacts/address.ts | `addressCasedCodePoints` | 6 | 0 | 14 |
| digest/approvals.ts | `renderApprovalSetRequest` | 6 | 1 | 05 |
| digest/callback.ts | `isReplyCallback` (gone: the reply family test is `isCallbackOfFamily`, 0 counted) | 6 | 0 | 11 |
| digest/callback.ts | `base64UrlToUuid` | 6 | 3 | 11 |
| digest/digest.ts | `renderDigestWithBrief` | 6 | 2 | 11 |
| digest/local-time.ts | `lateMin` | 6 | 5 | 12 |
| digest/review.ts | `renderListed` | 6 | 0 | 11 |
| loops/replies.ts | `isAutoReply` | 6 | 5 | 15 |
| notices/views.ts | `trustUrl` | 6 | 2 | 12 |
| outgoing/message.ts | `uniqueIds` | 6 | 0 | 15 |
| replies/digits.ts | `numberKeys` | 6 | 4 | 02 |
| sim/live/env-guard.ts | `sendAddressesAllowed` | 6 | 0 | 17 |
| sim/sent-manifest.ts | `byId` | 6 | 5 | 16 |
| sim/sent-slot.ts | `labelIssues` | 6 | 0 | 04 |
| sim/slot.ts | (module level) | 6 | 0 | 04 |
| testmail/batch.ts | (module level) | 6 | 0 | 08 |
| texts/approvals.ts | `rejected` | 6 | 0 | 05 |
| texts/notices.ts | `loops` | 6 | 0 | 13 |
| triage/suspicious.ts | `isLookalike` | 6 | 3 | 06 |
| triage/suspicious.ts | `foldName` | 6 | 1 | 07 |
| changelog.ts | `semverParts` | 5 | 3 | 10 |
| contacts/suggestions.ts | `byRank` | 5 | 5 | 14 |
| digest/digest.ts | `renderDigestMinimal` | 5 | 0 | 11 |
| digest/digest.ts | `briefOptions` | 5 | 2 | 11 |
| digest/schedule.ts | `dueDigestSlot` | 5 | 0 | 11 |
| mail/providers.ts | `presetForAddress` | 5 | 2 | 14 |
| metrics/fixtures.ts | `hiddenMoveRow` | 5 | 0 | 16 |
| outgoing/report-mail.ts | `isLinkOfBase` | 5 | 0 | 15 |
| send-limits.ts | `windowUntil` | 5 | 2 | 14 |
| sim/checks.ts | `wordCount` | 5 | 1 | 03 |
| sim/hard-cases.ts | (module level) | 5 | 0 | 04 |
| sim/live/calendar-days.ts | `formatDay` | 5 | 0 | 17 |
| sim/live/message.ts | `parseLabMessageId` | 5 | 4 | 17 |
| sim/manifest.ts | `freezeIssues` | 5 | 0 | 16 |
| sim/sent-checks.ts | `wordCount` | 5 | 1 | 03 |
| sim/sent-checks.ts | `checkSentCase` | 5 | 3 | 03 |
| testmail/blind.ts | (module level) | 5 | 0 | 08 |
| testmail/plan.ts | `planSends` | 5 | 3 | 08 |
| texts/notices.ts | `staysInAiFolder` | 5 | 0 | 13 |
| texts/notices.ts | `cost` | 5 | 0 | 13 |
| triage/eval-case.ts | `byId` | 5 | 4 | 14 |
| triage/payloads.ts | `sendPayloadFor` | 5 | 0 | 14 |
| triage/suspicious.ts | `domainOfAddress` | 5 | 1 | 07 |
| web/csp.ts | `parseDirectives` | 5 | 2 | 09 |

## Functions with a final count of 5 or more

| file | function | audit count | final count | stage |
| --- | --- | --- | --- | --- |
| digest/approvals.ts | `renderApprovalRequest` | 29 | 9 | 05 |
| triage/suspicious.ts | `isOneEditApart` | 29 | 8 | 06 |
| sim/checks.ts | `checkCase` | 24 | 7 | 03 |
| changelog.ts | `parseChangelog` | 23 | 10 | 10 |
| triage/suspicious.ts | `punycodeDecode` | 23 | 5 | 06 |
| web/notify.ts | `(module level)` | 21 | 10 | 10 |
| web/public-content.ts | `r4ExternalAsset` | 17 | 11 | 09 |
| triage/suspicious.ts | `digitValue` | 16 | 7 | 06 |
| web/next-path.ts | `safeNextPath` | 16 | 5 | 09 |
| web/public-content.ts | `parseAllowList` | 16 | 14 | 09 |
| triage/suspicious.ts | `trustedAuthResults` | 14 | 5 | 07 |
| digest/digest.ts | `renderListed` | 13 | 6 | 11 |
| sim/live/calendar-days.ts | `isRealDate` | 13 | 9 | 17 |
| triage/dkim-pass.ts | `trustedAlignedPassDomains` | 13 | 8 | 07 |
| notices/render.ts | `renderNotice` | 10 | 10 | 12 |
| sim/lang.ts | `detectLang` | 10 | 6 | 16 |
| testmail/target.ts | `renderCompareTable` | 10 | 5 | 08 |
| sim/manifest.ts | `byId` | 9 | 5 | 16 |
| digest/local-time.ts | `localInstants` | 8 | 8 | 12 |
| sim/live/run-plan.ts | `planLiveRun` | 8 | 5 | 17 |
| replies/digits.ts | `alnumStream` | 7 | 6 | 02 |
| digest/local-time.ts | `lateMin` | 6 | 5 | 12 |
| loops/replies.ts | `isAutoReply` | 6 | 5 | 15 |
| sim/sent-manifest.ts | `byId` | 6 | 5 | 16 |
| contacts/suggestions.ts | `byRank` | 5 | 5 | 14 |

Check of the self-classed remainders: for each of these 25 functions, the mutant keys (`line:column` and mutator) of the full run were matched against the Self-classed rows of the stage results file (`results/stage-NN.md`; for stage 07 also `stage-07-gaps.md`). All remaining mutants are listed with a class, except two of `renderApprovalRequest`; those two follow here. Most of these functions sit above the cap of 3 equivalent or unreachable mutants per function; their stage results files stopped at the cap and the coordinator accepted them. The match is by position, not by a read of each reason.

### renderApprovalRequest

The stage 05 results file (`results/stage-05.md`) lists 18 mutants at the old line numbers, 2 of them class `bug` (an empty quote on a too-long card got the quote-cut note). The later approval card change (`8778f3cb`: drops the false cut note of an empty quote, removes dead code) moved the lines and removed the mutants of the dead code and both `bug` rows. The full run leaves 9 mutants (current line numbers of `digest/approvals.ts`), all `equivalent` by reading the code:

| Key | Class | Reason |
| --- | --- | --- |
| 113:7 ConditionalExpression `true` | equivalent | An undefined version gives `undefined >= 2`, which is false (stage 05 row 114:7). |
| 164:7 ConditionalExpression `true` (2 mutants) | equivalent | A card that fits runs no loop; the loop condition repeats the length test (stage 05 row 164:7). |
| 164:7 EqualityOperator `text.length >= MESSAGE_MAX_CHARS` | equivalent | A card of exactly the limit fits, so the loop body does not run (stage 05 row 164:7). |
| 164:7 LogicalOperator `... \|\| quote !== null` | equivalent | A card that fits makes the loop condition false at once, so the loop body never runs. |
| 164:7 LogicalOperator `... && quote !== null \|\| view.quote !== null` | equivalent | With a view quote that is empty or whose card fits, the loop runs 0 times: `max` is 0 or the text already fits. |
| 164:42 ConditionalExpression `true` (key new after the dead-code removal) | equivalent | When `quote` is null, the view quote is null or empty; an empty quote gives `max` 0, so the loop runs 0 times. |
| 164:60 ConditionalExpression `true` (key new after the dead-code removal) | equivalent | When the view quote is null, `quote` is null as well, so the test before it already stops. |
| 168:34 ArithmeticOperator `max + 1` | equivalent | The overflow is at least 1, so `max - overflow` is always the smaller value (stage 05 row 168:34). |

No test proves these classes. `results/stage-05.md` keeps its old counts (29 at the audit, 18 at stage 05 before the card change).

## schema.ts with static mutants

The stage 02 results left this pair unrun. Run here: `bash scripts/test-audit/mutation.sh <dir> --with-static --mutate src/replies/schema.ts`, before at `HEAD` without `schema.test.ts` (`/tmp/f154-s18/schema-before`), after at `HEAD` (`/tmp/f154-s18/schema-after`). `mutation-gaps.ts --before ... --after ...` exited 1:

- `(module level)` of `schema.ts`: 52 counted mutants before, 1 after.
- 12 new cases kill 1 to 28 before-survivors each. 2 cases kill none: `limits: a language that is not pl or en is ok = false` and `limits: an extra key is ok = false`. Stryker makes no mutant of `.strict()`, and the enum mutants are killed by other cases. The stage 02 manual break check shows both cases fail when their code breaks.
- The one survivor: 17:29 StringLiteral `""` for `"en"` in `z.enum(["pl", "en"])`. No case parses a draft with `language: "en"`; a positive case would kill it. Not written here (this stage writes no test).

## New GAP functions

Functions with 5 or more counted mutants at `HEAD` that are not among the 122 (code added after the audit). A list only; it is not work of this ticket.

| file | function | final count |
| --- | --- | --- |
| texts/operator.ts | `slo_urgent_latency` | 21 |
| texts/operator.ts | `slo_llm_errors` | 18 |
| cli/render.ts | `renderToolTable` | 12 |
| ops/alert-text.ts | `operatorEventSample` | 12 |
| cli/description.ts | (module level) | 11 |
| texts/operator.ts | `slo_backup_age` | 5 |
