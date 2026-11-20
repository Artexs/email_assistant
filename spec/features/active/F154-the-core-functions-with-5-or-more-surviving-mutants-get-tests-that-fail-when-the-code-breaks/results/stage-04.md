# Stage 04 results: sim slot schemas and scenario validation

## Runs

Both runs: `bash scripts/test-audit/mutation.sh <dir> --mutate src/sim/sent-slot.ts --mutate src/sim/scenario.ts --mutate src/sim/slot.ts --mutate src/sim/hard-cases.ts`.
The before run used a `git archive` copy of the commit before the stage (the mutation lock queued it behind other runs while the new tests already existed in the worktree). The after run used the worktree at the stage tip.
Compare: `bun scripts/test-audit/mutation-gaps.ts --before /tmp/f154-s04/before/mutation.json --after /tmp/f154-s04/after/mutation.json` exited 0 (`0 new cases kill no before-survivor`).

## Before and after (counted mutants: survived plus no coverage)

| file | function | before | after |
| --- | --- | --- | --- |
| packages/core/src/sim/sent-slot.ts | (module level) | 33 | 0 |
| packages/core/src/sim/scenario.ts | validateScenario | 23 | 1 |
| packages/core/src/sim/sent-slot.ts | labelIssues | 6 | 0 |
| packages/core/src/sim/slot.ts | (module level) | 6 | 0 |
| packages/core/src/sim/hard-cases.ts | (module level) | 5 | 0 |
| packages/core/src/sim/sent-slot.ts | issue | 3 | 0 |
| packages/core/src/sim/slot.ts | issue | 3 | 0 |
| packages/core/src/sim/scenario.ts | warsawNoonOffsetMinutes | 2 | 1 |
| packages/core/src/sim/hard-cases.ts | withBrief | 1 | 1 |
| packages/core/src/sim/scenario.ts | dayString | 1 | 0 |

## New cases and kills of before-survivors

Every case below kills at least one mutant that survived or had no coverage before.

| test file | case | kills |
| --- | --- | --- |
| packages/core/src/sim/hard-cases.test.ts | src/sim/hard-cases.test.ts > hard-case registry > reply_needed_thread with seed 7 builds the short thread and the exact brief | 5 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > a week that crosses a month end with no DST change has no issue | 2 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > deadlines on both edges of the window has no issue | 5 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a Tuesday bankStart gives one exact issue list | 3 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a Tuesday weekStart gives one exact issue list | 1 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a VIP that is no persona gives one exact issue list | 1 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a deadline a day after the week window gives one exact issue list | 3 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a deadline a day before the bank window gives one exact issue list | 7 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a delegate in a client persona gives one exact issue list | 1 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a delegate that is no persona gives one exact issue list | 1 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a later persona that reuses the key of a delegate gives one exact issue list | 2 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a persona address on a real host gives one exact issue list | 1 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a persona key equal to the executive key gives one exact issue list | 2 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a persona key used twice gives one exact issue list | 1 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a persona with the executive address gives one exact issue list | 2 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a topic that names no persona gives one exact issue list | 1 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a week with the autumn DST change of Europe/Warsaw gives one exact issue list | 1 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: a week with the spring DST change of Europe/Warsaw gives one exact issue list | 1 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > one rule broken: an executive address outside the company domain gives one exact issue list | 1 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > several broken rules list their issues in the order of the checks | 3 |
| packages/core/src/sim/scenario.test.ts | src/sim/scenario.test.ts > validateScenario > the week after the spring DST change has no issue | 1 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent label refusals > a label with no reply, no promise and no dates parses | 2 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent label refusals > refuses a due with no expected reply with one exact issue list | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent label refusals > refuses a promise with no promiseDue with one exact issue list | 6 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent label refusals > refuses a promiseDue with no promise with one exact issue list | 6 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent label refusals > refuses both rules broken with one exact issue list | 10 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent label refusals > the fixture label parses to its own value | 1 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > conditional_promise breaks its rule with one exact issue list | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > far_date breaks its rule with one exact issue list [0] | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > far_date breaks its rule with one exact issue list [1] | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > fyi_team breaks its rule with one exact issue list | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > injection_quote breaks its rule with one exact issue list [0] | 7 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > injection_quote breaks its rule with one exact issue list [1] | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > many_recipients breaks its rule with one exact issue list [0] | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > many_recipients breaks its rule with one exact issue list [1] | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > many_recipients breaks its rule with one exact issue list [2] | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > other_thread_subject breaks its rule with one exact issue list | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > past_date breaks its rule with one exact issue list | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > question_in_forward breaks its rule with one exact issue list [0] | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > question_in_forward breaks its rule with one exact issue list [1] | 7 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > question_in_forward breaks its rule with one exact issue list [2] | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > reply_to_ooo breaks its rule with one exact issue list | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > reported_speech breaks its rule with one exact issue list [0] | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > reported_speech breaks its rule with one exact issue list [1] | 7 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > thanks_only breaks its rule with one exact issue list | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > time_word_due breaks its rule with one exact issue list [0] | 6 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > time_word_due breaks its rule with one exact issue list [1] | 6 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot hard-case rules > time_word_due breaks its rule with one exact issue list [2] | 9 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot refusals > refuses a due and an ask with no expected reply with one exact issue list | 8 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot refusals > refuses a due with no expected reply and no ask with one exact issue list | 6 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot refusals > refuses a promise with no promiseDue with one exact issue list | 6 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot refusals > refuses a promiseDue with no promise with one exact issue list | 6 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot refusals > refuses a quote with no thread mail with one exact issue list | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot refusals > refuses a recipient in to and cc with one exact issue list | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot refusals > refuses an ask with no expected reply with one exact issue list | 6 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot refusals > refuses an expected reply with no ask with one exact issue list | 6 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot refusals > refuses the executive as a recipient with one exact issue list | 5 |
| packages/core/src/sim/sent-slot.test.ts | src/sim/sent-slot.test.ts > sent slot refusals > refuses the executive in cc with one exact issue list | 5 |
| packages/core/src/sim/slot.test.ts | src/sim/slot.test.ts > slotSchema refusals > refuses a contextRef with another urgency source with one exact issue list | 5 |
| packages/core/src/sim/slot.test.ts | src/sim/slot.test.ts > slotSchema refusals > refuses a delegation with no expectedDraft with one exact issue list | 5 |
| packages/core/src/sim/slot.test.ts | src/sim/slot.test.ts > slotSchema refusals > refuses a non-urgent slot with an urgency source of context and no contextRef with one exact issue list | 7 |
| packages/core/src/sim/slot.test.ts | src/sim/slot.test.ts > slotSchema refusals > refuses a non-urgent slot with an urgency source with one exact issue list | 5 |
| packages/core/src/sim/slot.test.ts | src/sim/slot.test.ts > slotSchema refusals > refuses an expectedDraft on another category with one exact issue list | 5 |
| packages/core/src/sim/slot.test.ts | src/sim/slot.test.ts > slotSchema refusals > refuses an urgent slot with no urgency source with one exact issue list | 5 |
| packages/core/src/sim/slot.test.ts | src/sim/slot.test.ts > slotSchema refusals > refuses context urgency with no contextRef with one exact issue list | 5 |

0 new cases kill no before-survivor

## Self-classed

Three remaining mutants (key: file, line:column, mutator, replacement). All three are in the stage table's files; two are `equivalent` or `unreachable` within the cap.

| key | function | class | reason |
| --- | --- | --- | --- |
| `sim/hard-cases.ts` 48:49 StringLiteral `` (empty template) | `withBrief` | unreachable | The error text of a brief over 200 characters. No rule of the table builds such a brief; the existing test applies every rule to each of its categories and asserts a length of at most 200. |
| `sim/scenario.ts` 173:58 StringLiteral `"Stryker was here!"` | `validateScenario` | equivalent | The fallback host of an address with no `@`. Any non-reserved host text gives the same `address_not_reserved` issue as the empty text. |
| `sim/scenario.ts` 152:21 ArithmeticOperator `(localAsUtc - noonUtc) * MINUTE_MS` | `warsawNoonOffsetMinutes` | equivalent | The function only feeds an equal-or-not comparison of two days of one week. A scale applied to both sides gives the same result. |

## Bugs

none.

## Notes

- The tests keep the original loose test for a case when the exact case kills nothing new (the hard-case facts, the reply-needed thread length, a brief of 300 characters, the duplicate address and missing group of the scenario). Those old cases stay so the behaviour keeps its check.
- Old cases that the exact issue lists replace were removed in the same branch: the loose urgency, contextRef and expectedDraft cases of `slot.test.ts`; the promise, ask and due cases of `sent-slot.test.ts`; the per-code `codes()` cases of `scenario.test.ts`.
- Issue lists assert the zod `code` (`custom`) too. That kills the `code` string mutants of the refinements.
- The issue path of a slot label rule is a single string such as `labels.ask`, not `["labels", "ask"]`. The test pins this current value.
