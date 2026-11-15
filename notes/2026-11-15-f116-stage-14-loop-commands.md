# F116 stage 14: loop commands, obligations and evidence

Stage file: `spec/features/active/F116-e5b-open-loops/stages/stage-14-loop-commands.md` (its section "Built in stage 14" has the decisions and the carry-over). Evidence logs: `/tmp/f116-s14/`.

## What was built

- `apps/server/src/modules/loops/follow-up-draft.ts`: `draftFollowUp`, `oneLineSubject`, `recipientsOf`.
- `apps/server/src/modules/loops/loop-commands.ts`: `laterLoop`, `doneLoop`, `dropLoop`, `reopenLoop`, `untrackLoop`.
- `apps/server/src/modules/loops/repo.ts`: repo functions renamed `setLoopLater`, `reopenLoopRow`; `via` in the audit data; `waitFromAt` for a reopen.
- `apps/server/src/modules/actions/repo/planned.ts`: `createPlannedForLoop`.
- `apps/server/src/modules/loops/match.ts`: `ownAddressesOf(db, ctx, mailboxId)` adds the From addresses of the Sent rows (stage 13 review N2).
- Audit event `loop.would_draft`; log fields `loop_id` (UUID) and `via` (code); log line `loop_command`.
- Docs: `docs/capabilities/sent-mail.md` rules 20 and 21.

## Obligations and the check for each

- Exactly one / once / never twice / only X, a two-connection race test with committed rows, also as table owner: `apps/server/test/integration/loops-commands-race.test.ts`, three connection pairs each (app role, table owner, app role with table owner):
  - one follow-up waits at a time: two taps give one pair; three taps after a rejected one give one new pair with `k` 2;
  - a closed loop never keeps a waiting follow-up: a tap against Done, Drop, Untrack;
  - a loop closes once: each of Done, Drop, Untrack twice at once (one `ok`, one `already`, one `loop.closed` row, one `action.expired` row); Done against Drop;
  - Later has three uses: five taps at once give three `ok`, two `limit_reached`, three different due dates;
  - a reopen happens once (twice at once); a loop is never open with cleared texts (Reopen against `clearLoopTexts`);
  - the settings share lock: a setter that holds the row makes the tap wait, then the tap answers `drafts_off`.
- Stage 16 note, never catch the key-conflict error and commit: `draftFollowUp` throws `the follow-up keys exist after the loop lock` when `createPlannedForLoop` returns fewer than two rows; no `try` or `catch` is around it. Test `loops-follow-up-draft.test.ts` "a key that exists with no waiting send" (committed rows: the call rejects, nothing new stays). `grep -c "catch (" apps/server/src/modules/loops/follow-up-draft.ts` prints 0. Mutation d17 (the throw removed) is killed.
- Scanner and parser probes, quoted, encoded and look-alike forms: the subject of the loop goes through `cleanUserText` (CRLF, LF, CR, U+2028, U+2029, U+0085, vertical tab, bidi and zero-width marks, the `=?utf-8?q?` encoded form stays plain text) in `loops-follow-up-draft.test.ts`; addresses go through the draft schema (display name, zero-width, soft hyphen, Cyrillic look-alike with a header line, space, no domain: all `not_allowed`, no row); the alias compare (case, spaces, other mailbox, other organization) in `loops-match-aliases.test.ts`.
- Web dialog, reload removes the row: no web dialog in this stage (no `apps/web` change). The Edit dialog of stage 11 has TG-4 as carry-over (stage 21 or 22).
- Every place a value is copied before any delete rule (below).
- Logger drops non-UUID ids: the log line holds `org_id`, `loop_id` (`org_id` from the tenant context, `loop_id` from the input (Postgres accepted it as a UUID before the line is written; the logger also drops any value that is not a lower-case UUID)), `command`, `kind`, `via`; test `loops-commands.test.ts` "the commands log ids and codes only" runs `logProblems` with the planted subject and addresses.
- Bun 1.4.4 `toMatchObject` does not compare Dates: the tests compare `getTime()` or `toISOString()`.
- Scripts print through `createCliOutput`: no script added.
- New integration tests pass with `env -i` CI-style: `/tmp/f116-s14/env-i.log`.
- New `/api` routes need `apiDoc`: none added (stage 20 adds the routes).
- Unit tests that call docker or compose: none added.
- A mutation check for each guard: `/tmp/f116-s14/mutate.py`, one log per mutation in `/tmp/f116-s14/mut-*.log`, summary `/tmp/f116-s14/mutate-summary.log`.

## Every place a value of a loop or its sent mail is copied (before any delete rule)

This stage adds no delete rule and no table. It writes these copies of loop values:

| Copy                                         | Written by                      | Holds                                                    | Delete rule that reaches it                                                                                     |
| -------------------------------------------- | ------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `actions.payload` of the `create_draft` row  | `draftFollowUp`                 | To, Cc (or the counterpart), subject (one line), quote   | `clearActionPayloads` (retention); DSR erase scrubs by address; the row goes with the loop (`actions.loop_id` cascade) |
| `actions.payload` of the `send` row          | `draftFollowUp`                 | To, Cc (or the counterpart), `loop_id`                   | same                                                                                                            |
| `audit_log.data` (`action.planned`)          | `draftFollowUp`                 | `action_type`, `status`, `loop_id`, `via`                | none needed (no text)                                                                                           |
| `audit_log.data` (`loop.would_draft`, `loop.closed`, `loop.later`, `loop.reopened`) | the commands | `loop_id`, `kind`, `reason`, `later_count`, `via`        | none needed (no text)                                                                                           |
| log line `loop_command`                      | all commands                    | `org_id`, `loop_id`, `command`, `kind`, `via`            | none needed (no text)                                                                                           |
| `open_loops.wait_from_at`, `due_at`          | `reopenLoop`, `laterLoop`       | times                                                    | the loop row                                                                                                    |

The quote is read from `sent_emails.body_text` at draft time and copied only into the draft payload (the stage 11 table has the later copies: `outbox.view`, `outbox.text`). The alias rule reads `sent_emails.from_address` and copies nothing.

## Evidence

- Chain: `/tmp/f116-s14/proof.log` (the final message of the job names the exit and `PROOF_OK`); each step has its own log in `/tmp/f116-s14/`.
- `env -i` run of the new and the touched loop tests: `/tmp/f116-s14/env-i.log` (166 pass, 0 fail, 7 files).
- Mutations: 49 mutants of the new guards, `/tmp/f116-s14/mutate-summary.log`. 43 killed at once. Six survived and are equivalent, each for a stated reason:
  - c08, c09, c15, c16: each is one of two guards of the same rule (the check in the command and the conditional update or check in the repo function: `setLoopLater`, `reopenLoopRow`, `closeLoop`). The combined mutants c08b, c09b, c15b, c16b (both guards removed) are killed.
  - a03 (no `org_id` filter in the alias read): the mailbox id is unique and its composite FK ties it to one organization, so the filter on `mailbox_id` alone selects the same rows (the same reason as stage 13 m18). The filter stays as a second guard.
  - a05 (no trim of the alias): `replyCandidates` trims and lower-cases the own addresses again before the compare, so the result is the same.

## Repair after the review (FAIL on 70211178)

- B1 and TG1: `recipientsOf` has no fallback to `to_addresses[0]`; a `delegated` loop with no counterpart gives `not_allowed`.
- TG2: race tests of Reopen against `setSentSync(off)`.
- Sent switch off (owner decision): `onSentOff` and `composition.ts` clear the copies below.
- Own addresses (owner decision): the people of the loop are removed from the alias set.

### Every place where the Sent mail body, subject or an address is copied, and what the switch off does

| Place                                                    | Holds                                         | Switch off                                                                                                  | Test (`loops-sent-off-copies.test.ts`)                      |
| -------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `sent_emails`                                            | body, subject, From, To, Cc                   | deleted by `setSentSync`                                                                                    | the scan finds no row                                       |
| `sent_analyses`                                          | no text                                       | cascade with the Sent row                                                                                   | the scan                                                    |
| `open_loops` (open loop)                                 | subject, ask, To, Cc, counterpart             | closed `sent_off`, texts cleared (`onSentOff`)                                                              | the scan                                                    |
| `open_loops` (loop closed before the switch off)         | the same                                      | **stays until retention** (stage 08 rule and test; an owner decision of that stage)                         | the scan names this table as the only one left              |
| `actions.payload`, `create_draft` and `send` of any loop | `quote`, `to`, `cc`, `subject`                | the four keys are removed (`clearLoopSentCopies`); status, `kind`, `loop_id` stay                           | payload tests, `applying` and applied rows, the scan        |
| `outbox.view`, `outbox.text` of the follow-up cards      | recipients, subject, quote, rendered text     | text `[removed]`, view `{}`; `pending` or `sending` ends `failed` / `outdated` (`clearLoopCards`)           | card test with six card kinds and states, the scan          |
| a message that Telegram delivered                        | the card text                                 | stays in the chat: nothing recalls it                                                                       | not testable                                                |
| `audit_log`, log lines, `loop_command`                   | ids and codes                                 | none needed                                                                                                 | the scan                                                    |
| other mailbox, other organization                        | their own copies                              | untouched                                                                                                   | "another mailbox ... keep their copies"                     |

The scan test lists every table of the schema for the planted values before and after the switch off, so a place that this table misses fails it.
