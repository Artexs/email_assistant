# F116 stage 13: close rules, obligations and evidence

Stage file: `spec/features/active/F116-e5b-open-loops/stages/stage-13-close-rules.md`. Evidence logs: `/tmp/f116-s13/`.

## What was built

- Core (`packages/core/src/loops/replies.ts`): `normalizeSubject`, `isAutoReply`, `replyMatch`, `SUBJECT_MATCH_DAYS`.
- Server (`apps/server/src/modules/loops/`): `reply-read.ts` (candidate query, `decideReply`), `match.ts` (`matchReplies`), `follow-up-expiry.ts` (`expireFollowUpSends`, shared with `onSentOff`), `jobs.ts` (`createLoopMatchJob`), `repo.ts` (`markAutoReply`), `hooks.ts` (`isOpen` now runs the reply rules).
- Wiring: `apps/server/src/main.ts` schedules `loops.match` (`50 */2 * * * *`) outside the model scope block, so it runs with the scope off. `job:run --name loops.match` prints counts through `createCliOutput`.

## Decisions taken (default, no owner input needed)

- `isOpen` only answers; it never closes the loop (the job closes it). A reply since the last run makes it answer false, so the committer expires the send with `loop_closed` and sends no mail.
- An `auto` mail before the first real reply sets `auto_reply_at` in the same run that closes the loop (T8 reads both ways).
- `delegated` loops use the same rules; `detectReply` of delegations is unchanged (PD-121).
- The job needs the flag `open_loops` and a not suspended org; it does not need the `sent_sync` flag or the switch (the switch off already closes loops `sent_off`).
- Limits per run: 500 loops per mailbox (oldest wait first), 200 candidate mails per loop.

## Copy sites of a value before any delete rule (obligation: list every place a value is copied)

This stage adds no delete rule. It copies no text from a mail into a loop: a close stores only `closed_by_email_id` (an FK with `ON DELETE SET NULL`), `closed_at`, `close_reason`, `auto_reply_at`. The audit row of a close holds `loop_id`, `kind`, `reason`; the log line holds `mailbox_id`, `count`, `kind`. The copies of loop values that a later delete rule must reach are the stage 07 and stage 10 sites: `open_loops.subject/text/to_addresses/cc_addresses/counterpart` (cleared by `clearLoopTexts`, `clearLoopTextsOfPerson`, `onSentOff`), `actions.payload` and `outbox.text` of follow-up rows (`[removed]` by the erase), and the Drafts-folder copy (reverse row). Stage 13 adds none.

## Obligations and the check for each

- Exactly one / once / never twice / only X, a two-connection race test with committed rows, also as table owner: `apps/server/test/integration/loops-match-concurrent.test.ts`, three connection pairs (app role, table owner, app role with table owner): one close and one audit row and one expiry for two `matchReplies` at once; `auto_reply_at` once; a close against a restart of the wait (a mail counts only after `wait_from_at`); a close against `onSentOff`; a close against the committer that sends the approved follow-up (20 loops, no deadlock).
- Scanner and parser probes, quoted, encoded and look-alike: `packages/core/src/loops/replies.test.ts` (subjects, addresses, message ids, `Auto-Submitted`, `Precedence`).
- Logger drops non-UUID ids: the log line holds only UUID ids and codes; `loops-match.test.ts` ("logs") runs `logProblems` with planted values.
- Bun 1.4.4 `toMatchObject` does not compare Dates: the tests compare `getTime()` or `toISOString()`.
- Scripts print through `createCliOutput`: `apps/server/src/scripts/job-run.ts` (`out.print`).
- New integration tests pass `env -i` CI-style: `/tmp/f116-s13/env-i.log`.
- `/api` routes: none added (no `apiDoc` needed). Unit tests that call docker or compose: none added.
- A mutation check for each guard: `/tmp/f116-s13/mutate.py`, one log per mutation in `/tmp/f116-s13/`.

## Mutation results

Killed: m01 (after `wait_from_at`), m02 (own address), m03 (auto never closes), m04 (30 days), m05 (recipient), m06 (message id compared whole), m07 (NFKC), m08 (empty subject), m09 (`Auto-Submitted: no`), m10 (no sender), m11b (both once-guards of `auto_reply_at`), m13 (end of the send), m14 (loop lock), m15 (dropped), m16 (`isOpen`), m17 (kind filter), m19 (mailbox filter), m20 (flag), m21 (loop filter of the expiry), m23b (stop at the first auto), m24 (`isOpen` for a promised loop), m25b (close twice: no status check and no conditional update).

Equivalent (each alone; see why): m11 and m12 are two guards of one rule (the check under the lock and the `WHERE auto_reply_at IS NULL`); only removing both is observable (m11b, killed). m25 and m26 likewise (the status check under the lock and the conditional update of `closeLoop`); m25b removes both and is killed. m18 (org filter of the candidate read) and m22 (org in the header join): the composite FKs `(mailbox_id, org_id)` and `(email_id, org_id)` make the mailbox filter and the email id decide the same rows.

## Carry-over for later stages

- Stage 11 (cards): a follow-up send that the close rules expire (`expired` / `loop_closed`) needs its card edit; `expireFollowUpSends` calls `expireSend` with `noDelegationHooks`, so no card hook runs from this path (same as `onSentOff`).
- Stage 14 (commands): `doneLoop`, `dropLoop` should also end the waiting sends with `expireFollowUpSends` (exported from `follow-up-expiry.ts`; not yet from `index.ts`).
- The sync stores `emails.subject` already decoded (imapflow envelope). The rules read the stored text as it is; an encoded-word subject never matches.
- The own addresses are the mailbox addresses of the organization. An alias of the user that is not a mailbox counts as a stranger, so a reply from an alias closes the loop (a false close). Not handled in this stage.
