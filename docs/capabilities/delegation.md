# Delegation

> Checked against the code at `1ca3052`, 2026-11-14.

## What it does now

An organization keeps a list of delegates: people who get tasks from the user. Today the owner manages the list with `bun run delegates:*`; there is no web page for it. When the classifier calls a mail `delegation` and picks a delegate id from the list, triage plans a draft and a send to that delegate and writes one `delegations` row (`drafted`). After the owner approves the send (`drafts-and-send.md`) the delegation is `sent` and has a due date. A mail from the delegate in the same thread closes the wait: the delegation becomes `answered` and every linked member gets a notice with a ✅ Done button. When no answer comes by the due date, the chaser job marks the delegation `overdue` and plans a reminder for the owner to approve, at most 2 reminders per delegation. `bun run delegations:list` and `delegations:done` read and close delegations from the shell.

## Rules

1. **Delegates.** A delegate has a name (1 to 100 characters), an address (lower case, valid, never an address of a mailbox of the organization), competence tags (at most 10, each at most 30 characters, lower case) and an `active` flag.
   - `bun run delegates:add --org-id <uuid> --name <text> --email <address> [--tags a,b,c]` adds one. A second add of the same address in the organization says "already there". `delegates:list` shows the active delegates (`--all` shows all). `delegates:disable` and `delegates:enable` change the flag with `--id <uuid>`. Each change writes an audit row (`delegate.added`, `delegate.changed`).
   - A delegate is never deleted. A disabled delegate is not offered to the classifier and gets no reminder; a send that is already planned for it still shows `(inactive)` in the approval message.
2. **How the classifier picks a delegate.** The triage job reads the active delegates and gives the list (id, name, tags) to the classifier. The category `delegation` is allowed only when the list is not empty. The output schema allows only these ids (or null), and the code checks the id again. The rules are in `triage.md` § Rules (hard rules and the classifier call). The recipient of the draft is the address of the `delegates` row, never LLM text.
3. **The delegation row.** `saveTriage` (the triage transaction) inserts the `delegations` row when the mail has the final category `delegation` and the `create_draft` of kind `delegation` is `ready`. Both payloads then get the `delegation_id`. The task text comes from the classifier (`task_summary`).
   - `due_at`: the due date that the classifier found, at 17:00 in the organization timezone. A date that does not exist gives no date.
   - When the send is `applied` the delegation becomes `sent` with `sent_message_id`, and `due_at` = 3 days later when it had no date.
   - A mail that gets only a `clarification` draft (no delegate) makes no delegation.
4. **Reply detection.** After `saveTriage` writes the status of a mail, it asks `detectReply`: is there an open delegation (`sent` or `overdue`) of this mailbox whose delegate address is the `From` address of the mail, and whose `sent_message_id` (or the `Message-ID` of its applied send) is in the `In-Reply-To` or `References` header? If yes, `markAnswered` sets the delegation to `answered` (with `answered_email_id`) and expires its pending reminders (`delegation_closed`). The same transaction writes the audit row `delegation.answered`. The mail is then triaged like any other mail. The flow diagram of `docs/architecture.md` §4.1 shows the branch.
   - Only the delegate's own address counts. A reply from another address does not close the delegation (E5b, F116).
5. **The notice and the Done tap.** The notifier queues one `delegation_answered` notice for every linked member (dedup `delegation_answered:<delegation id>`). Its ✅ Done button is the callback `dd:<delegation id>`; it works for every linked member, not only owners. `closeDelegation` allows `done` only from `answered` or `overdue`: a `done` delegation answers "already", any other state answers "not closable". `done` expires the pending reminders. `bun run delegations:done --org-id <uuid> --id <uuid>` does the same from the shell.
6. **Digest lines for delegations (S4):** a `logged` send reads "would ask you to send it"; the phrases for the other statuses are `waits for your approval`, `approved, sending`, `sending`, `sent`, `rejected`, `not sent (approval expired)` and `not sent (failed)`. The footer shows `👥 Delegations: <n> waiting for a reply, <m> overdue` when there are open delegations.
7. **Reminder sets:** the chaser (rule 8) plans up to 10 reminders at once. They go as one message `📤 Send <n> reminders?` with 📤 Send all and ✖️ Skip all (`as:<set id>`, `rs:<set id>`). Each item shows the recipient, the subject and the task (cut to 150 characters).
   A tap approves only the sends that the message showed.
   - Check against the code: the task is cut to 150 characters only while the message fits in 4096 characters. A long set shrinks the texts in four steps (task 150, then 40; subject 80, then 60; name 80, then 40), so no item drops out (`renderApprovalSetRequest`). A set of one reminder reads `📤 Send 1 reminder?`.
8. **The job `delegation.chaser`** (`delegation/chaser.ts`, a tick every 15 min) acts once per local day per mailbox, from 07:30 in the organization timezone, only in `assist` mode with the switch `create_draft` on: it marks `sent` delegations past `due_at` as `overdue` and plans a reminder (draft + send, `awaiting_approval`) for every overdue delegation with an active delegate, at most 2 reminders per delegation, 3 days apart, at most 10 per run (one set message, `drafts-and-send.md` § Rules). A reminder is never sent without a tap. The run writes an audit row `delegation.chaser_run`; the first statement of its transaction share-locks the settings row and compares the settings version (the S3 `saveTriage` rule), so a settings change makes it skip.
   - Check against the code: no new reminder is planned while an earlier reminder send of the same delegation still waits (`awaiting_approval`, `approved` or `applying`). The reminder is a `reminder` draft (a fixed template, no quote) in the same thread as the delegation mail, with the delegate as the only recipient.
   - `bun run job:run --name delegation.chaser [--force]` runs it once (`drafts-and-send.md` § Entry points); `--force` skips the 07:30 and once-per-day gate of the chaser.
9. **The end of a delegation.** `cancelled` comes from the send: the owner rejected it, it expired, its draft is missing or the send failed (reasons in the flow below). A cancelled delegation can become `sent` again by "Send again" or "It went out" (`drafts-and-send.md` § Rules). A reminder send that fails or expires never cancels the delegation. The retention job clears the task text of a delegation that is no longer open (`clearDelegationTasks`).

## Entry points

| Kind     | Name                                                                                          | Where                                                       |
| -------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| job      | `delegation.chaser` (`20 */15 * * * *`: second 20 of every 15th minute; acts from 07:30 local) | `apps/server/src/modules/delegation/chaser.ts`              |
| CLI      | `bun run delegates:add`, `delegates:list`, `delegates:disable`, `delegates:enable`            | `apps/server/src/scripts/delegates.ts`                      |
| CLI      | `bun run delegations:list`, `delegations:done`                                                | `apps/server/src/scripts/delegations.ts`                    |
| CLI      | `bun run job:run --name delegation.chaser [--force]`                                          | `apps/server/src/scripts/job-run.ts`                        |
| Telegram | callback `dd:<delegation id>` (the ✅ Done button); `as:` and `rs:` for a reminder set        | `apps/server/src/modules/channels/callbacks.ts`             |
| function | `addDelegate`, `setDelegateState`                                                             | `apps/server/src/modules/delegation/service.ts`             |
| function | `createDelegation`, `detectReply`, `markAnswered`, `cancelDelegation`, `closeDelegation`      | `apps/server/src/modules/delegation/service.ts`             |
| function | `delegationHooks`                                                                             | `apps/server/src/modules/delegation/service.ts`             |
| function | `listDelegates`, `listDelegations`, `countOpenDelegations`, `listDueDelegations`              | `apps/server/src/modules/delegation/repo.ts`                |
| function | `createChaserJob`, `runChaserForMailbox`, `reminderDecision`                                  | `apps/server/src/modules/delegation/chaser.ts`              |
| function | `saveTriage`                                                                                  | `apps/server/src/modules/triage/service.ts`                 |
| function | `delegationAnsweredDetector`                                                                  | `apps/server/src/modules/channels/notices/delegation-answered.ts` |
| function | `delegationInputOf`, `planActions`                                                            | `packages/core/src/triage/planners.ts`                      |
| function | `renderApprovalSetRequest`, `renderDelegationAnswered`                                        | `packages/core/src/digest/approvals.ts`                     |

## Data

`delegates`: `id`, `org_id`, `name`, `email` (lower case; unique per organization), `competence_tags` (text array), `active`, `created_at`, `updated_at`.

`delegations`: `id`, `org_id`, `mailbox_id`, `email_id`, `delegate_id`, `draft_action_id`, `send_action_id` (unique), `task_summary`, `due_at`, `status`, `status_reason`, `sent_message_id`, `sent_at`, `last_reminder_at`, `reminders_sent`, `answered_email_id`, `answered_at`, `answered_notified_at`, `created_at`, `updated_at`. A status `sent`, `answered` or `overdue` needs `sent_message_id` and `sent_at` (a check).

Audit events: `delegate.added`, `delegate.changed`, `delegation.created`, `delegation.sent`, `delegation.answered`, `delegation.overdue`, `delegation.cancelled`, `delegation.done`, `delegation.chaser_run`.

Status flow of `delegations.status` (moved from `docs/architecture.md` §4.6):

```
delegations.status: drafted → sent                                    (the delegation send is applied; due_at = 3 days later when the mail states no date)
                 drafted → cancelled                                  (reason: rejected | expired | draft_missing | send_failed | outcome_unknown)
                 cancelled → sent                                     ("Send again" after send_failed | outcome_unknown, when the new send is applied; or "It went out" after outcome_unknown, with the stored outgoing_message_id and no new send)
                 sent → overdue                                       (the chaser, after due_at)
                 sent | overdue → answered                            (a mail from the delegate in the thread of the sent mail; the pending reminders expire)
                 answered | overdue → done                            (the Done tap, or bun run delegations:done; the pending reminders expire)
```

## Limits

- No manual delegation (a "Delegate" button on a mail, or a sent mail that becomes a delegation) and no reply from another address of the delegate: E5b (F116; PD-121, PD-124).
- No web page for delegates or delegations: E4-A (F102). Delegates are managed only with the CLI.
- No delegate import: a delegate is added one by one.
- At most 2 reminders per delegation. After that the delegation stays `overdue` until the owner closes it.
- No command changes the name, the address or the tags of a delegate: the owner adds a new delegate and disables the old one.

## Decisions

- ADR 0003 (plan, policy, commit; the send and the approval of a delegation).
- PD-124 (Limits only: manual delegation).
- `docs/architecture.md` keeps the flow of §4.1 with the branch "reply in a delegation thread".

## Tests

- `apps/server/test/integration/delegation-service.test.ts`
- `apps/server/test/integration/delegation-chaser.test.ts`
- `apps/server/test/integration/delegation-repo.test.ts`
- `packages/core/src/triage/planners.test.ts`
- `packages/core/src/digest/approvals.test.ts`
