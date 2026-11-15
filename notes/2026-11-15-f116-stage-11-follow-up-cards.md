# F116 stage 11: follow-up cards, lists and expiry (worker notes)

Stage file: `spec/features/active/F116-e5b-open-loops/stages/stage-11-follow-up-cards.md`. Read this note before stage 14, 15, 18, 19 or 22.

## What the stage built

- Core: card of kind `follow_up` (`renderApprovalRequest`), result lines (`renderFollowUpResult`), fixed `action_failed` and `send_held` variants, new notice kind `loop_consent`. `ApprovalView` gets `to`, `cc`, `followUpNumber` (all optional).
- Server `actions`: `SendRow` carries a loop send (`email` null, `loop_id`, `mailbox_id` from the loop). All readers of cards, lists, expiry and notices include follow-ups. `listSetSends`, `getSetSend` and `listSetsToNotify` stay mail-only on purpose.
- Server `channels`: `loopConsentOf` (`channels/consent.ts`) is the one consent gate. `notices/loop-consent.ts` splits owners and queues the `loop_consent` line. `notices/follow-up-closed.ts` edits the card of a follow-up whose loop closed. `detectForOrg` catches each detector (review 10, N7).
- Migration `20261115190001_outbox_loop_consent.sql` (a wider `outbox_kind_check`).
- Web: the approvals summary shows To, Cc and the number; Edit is allowed for a waiting follow-up; new text `appr_closed_loop_closed`.

## Decisions taken (defaults, no owner input)

1. A failed follow-up gives one fixed `action_failed` notice (not a `send_result` line). `outcome_unknown` has its own text ("may have been sent"). No "Send again" and no "It went out" for a follow-up: a forged tap answers "not found".
2. `loop_consent` has two kinds, `approval` and `result`, one row per owner, kind and UTC day.
3. A follow-up card whose To and Cc text is over 2,400 characters is refused (never cut). The panel still shows it. The send expires `not_notified` after 7 days if no owner is covered.
4. `ADDRESS_PATTERN` refuses control, zero-width and bidi characters (the address on the card must be the address that is sent). This also applies to delegate addresses.
5. The consent counts only when it is newer than the user's last `chat.unlinked` row (N4). A consent row at the same instant as the unlink row does not count. A user who re-links by the CLI has no consent until the panel confirm button exists (stage 22).
6. Card edit for `expired` / `loop_closed` is a detector (`followUpClosedDetector`), because the committer, the switch-off and the close rules end a send with no approval hook. Other expiry reasons edit no card (as for mail).
7. Flag `open_loops` stays off until stage 22 lands (N6). No flag was changed.

## Every place a value of a loop or its sent mail is copied (before any delete rule)

| Copy                                                          | Written by                                               | Holds                                                           | Delete rule                                                                                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actions.payload` of the draft                                | stage 12 and 14 writers, panel edit (`insertEditedPair`) | To, Cc, subject, quote (own sent text), body text after an edit | `clearActionPayloads` (retention); DSR erase scrubs by address (`actions.payload` json); an open action stops the erase                                                                     |
| `actions.payload` of the send                                 | same                                                     | To, Cc                                                          | same                                                                                                                                                                                        |
| `outbox.view` and `outbox.text` of the card (`approval`)      | `detectApprovals`                                        | every To and Cc, subject, body, quote                           | `clearOutboxTexts` by time; DSR erase scrubs `outbox.text` and `view` by address (test 7 of `privacy-dsr-loops.test.ts` covers both); the row goes with its loop (`outbox.loop_id` cascade) |
| `outbox.view` of `approval_edit`                              | `queueCardEdits`                                         | the whole card text (`original`)                                | `clearOutboxTexts`; same erase rule                                                                                                                                                         |
| `outbox.view` of `send_result`                                | `detectSendResults`                                      | first To, subject                                               | same                                                                                                                                                                                        |
| `outbox.view` of `action_failed`, `send_held`, `loop_consent` | detectors                                                | no recipient, no subject, no text                               | none needed                                                                                                                                                                                 |
| `audit_log.data`                                              | approve, reject, expire, edit                            | `loop_id` only                                                  | none                                                                                                                                                                                        |
| API answers (`/approvals`)                                    | read time                                                | everything above                                                | not stored                                                                                                                                                                                  |

## Gaps and notes for the next worker

- Web: the Edit dialog now opens for a follow-up. A Playwright case "a reload removes the row while the dialog is open" is not written: this job may not run `test:e2e`. The pure parts are tested in `apps/web/src/lib/approvals-edit.test.ts` (404 and `loop_closed` answers).
- `listSendLimitHolds` (operator console, lab limits) is still mail-only; the follow-up holds are in `listFollowUpLimitHolds` and only feed the `send_held` notice.
- The stage 14 and 15 writers of the follow-up draft must set payload `to` and `cc` from the loop (D12: a `delegated` loop sends to the counterpart only), strip CR/LF from the subject (review 10, N2), and must not set `set_id`.
- Stage 18 and 19: call `loopConsentOf` (channels) for each member or user; the gate test (`consent-gate.test.ts`) lists the files that may queue a loop row. A new sender must be added there on purpose.
- A consent withdrawn between the check and the queue is not re-checked (the card is already queued). Accepted.
- Mutation checks: `/tmp/f116-s11/mutation-*.log` (27 mutants, all killed). Equivalent and not mutated: the `loop_id === null` test of `inSetMessage` (the set readers are mail-only) and the final length guard of the card renderer (the shrink steps come first).
