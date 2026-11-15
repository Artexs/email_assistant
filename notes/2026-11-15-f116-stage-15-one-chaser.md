# F116 stage 15: the one chaser (worker notes, 2026-11-15)

Stage file: `spec/features/active/F116-e5b-open-loops/stages/stage-15-one-chaser.md`. Code: `apps/server/src/modules/loops/chaser.ts`, `loops/jobs.ts` (`createLoopChaserJob`), `delegation/chaser.ts` (the delegation parts).

## What changed

- `loops.chaser` replaces `delegation.chaser` in `main.ts` (same schedule `20 */15 * * * *`). `job:run --name loops.chaser [--force]`; `--name delegation.chaser` runs the same job and prints one alias line.
- `delegation/chaser.ts` exports `planDelegationReminders` (marks overdue, returns the pairs), `createReminderSet` (writes the set), `recordDelegationRun`, `logDelegationRunDone`, `chaserDay`, `chaserRanToday`, `lockChaserDay`. `runChaserForMailbox` is a thin wrapper of them; `createChaserJob` is gone (the job is `createLoopChaserJob`).
- `runLoopChaser(deps, ctx, mailboxId, { now, force })`: one transaction: settings share lock and version compare, suspended check, advisory day lock, day gate again, delegation part, loop part, reminder set, markers. Markers: `delegation.chaser_run` (unchanged) and the new `loops.chaser_run` (counts only). Each part has its own day gate.
- Loop part: one statement locks every candidate loop `FOR UPDATE` in ascending id order (the order `onSentOff` uses). Then (c) stale and (d) expired close; (a) and (b) plan follow-ups through `planFollowUpPair` (the planning core that `draftFollowUp` now shares; actor `system`, `via` `chaser`). At most 10 planned sends per mailbox and run, delegation reminders first.
- The planning core: `judgeFollowUp` (stage 14 rules) and `planFollowUpPair` are exported from `follow-up-draft.ts`.

## Decisions taken as defaults (also in the final message)

1. **The job offers each follow-up number once.** If any send with key `<loop>:send:follow_up:<n>:*` exists (rejected, expired, failed, `outcome_unknown`), the chaser plans no new pair for that `n`. A user tap still can. Reason: the job runs daily; a rejected or expired card would come back every day. This also settles the stage 14 carry-over N6 (a `failed` send with an unknown outcome): the chaser never plans a second mail after it.
2. **Stale (c) applies to `waiting` and `delegated` loops only.** A `promised` loop ends `expired` (d) after 7 days; it never reaches 30 days.
3. **`auto_follow_up` is read from the raw JSON** (`tool_switches.auto_follow_up === true`). The core schema `toolSwitchesSchema` has no such key and its parse drops it. Stage 22 adds the key to the schema and the panel switch; then `autoFollowUpOn` can use the parsed value.
4. **`loops_chaser_done`**: `count` = follow-up cards planned by the loop part (reminders keep their own `chaser_done`); extra lines with `kind` `stale` and `expired`. Fields `mailbox_id`, `count`, `kind` were allowed already.
5. **The chaser does not call `isOpen`** and so adds no `sentFromAddressesOf` GROUP BY (carry-over N3). The committer still calls it at send time. N3 is **not solved**: `matchReplies` (every 2 minutes) and each `isOpen` still scan the Sent rows of the mailbox. No migration here (the stage does not name one). A later stage can read the aliases once per run or add the index `sent_emails (mailbox_id, lower(from_address))`.
6. **Candidate limit 500 per mailbox and run** (`CANDIDATE_BATCH`), ordered by id. A loop that is never ready (waiting card, offered once) stays a candidate; with more than 500 such loops, newer ones wait. Not expected at pilot size.
7. **A mailbox error exits `job:run` with 1** (the old chaser logged and exited 0).

## Stage 14 carry-over, done here

- NOTE A: `clearLoopCards` queues one `approval_edit` (outcome `expired`) with the fixed text `approvals.followUpRemoved` (en, pl) as the original for each delivered card whose follow-up the switch expired; `checkCardEdit` accepts it although the card text is `[removed]`. Test `loops-sent-off-card-edit.test.ts` (setSentSync off, detectNotices adds none, the sender edits the message and drops the buttons).
- NOTE B: the comment of `clearLoopSentCopies` is true now (an `applying` send finishes from the payload in memory).
- Test gaps: own mailbox address in To, Cc or as counterpart does not close (m7); mixed-case recipient closes (m8): `loops-match-aliases.test.ts`.

## Every place a Sent value is copied (before any delete rule)

Values: subject, ask, To, Cc, counterpart, the own text (quote).

| Place | Written by | Removed by |
| --- | --- | --- |
| `sent_emails` | Sent reader | `deleteSentEmails` (switch off) |
| `open_loops` subject, text, to, cc, counterpart | analysis (stage 12) | `onSentOff` for loops that it closes; a loop closed before keeps them until `clearLoopTexts` 90 days after close (a loop that the chaser closes `stale` or `expired` is such a loop) |
| `actions.payload` `quote`, `to`, `cc`, `subject` of `create_draft` and `send` | `draftFollowUp` and the chaser (`planFollowUpPair`) | `clearLoopSentCopies` |
| `outbox.text`, `outbox.view` of the approval card, the edit rows and the result notices | stage 11 notices | `clearLoopCards` (stage 14); the delivered Telegram message gets the fixed-text edit (this stage) |
| `audit_log` | `loops.chaser_run`, `loop.closed`, `action.planned` | holds ids, codes and counts only (scan test) |
| log lines | `loops_chaser_done`, `loop_command` | ids, codes and counts only (scan test) |

The scan test `loops-chaser-sent-off.test.ts` plants values, runs the real chaser and scans every table and every log line before and after the switch off.

## Open for later stages

- Stage 18: the brief says "would draft a follow-up" in shadow mode; the chaser writes no row for it.
- Stage 22: the switch `auto_follow_up` in the panel and in `toolSwitchesSchema`.
- The owner question of stage 14 (a loop closed before the switch-off keeps its texts 90 days) is unchanged.
