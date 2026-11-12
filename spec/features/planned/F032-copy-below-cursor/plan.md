> **Status 2026-11-07 — planned.** Idea from S3 (stage 18). Not started. The real-mailbox numbers come from the stage 20 week.

# Store and triage a copy that lands below the UID cursor

Scope: `docs/roadmap.md` (S3 follow-up). Needs: S3. Related, other case: [`sync-return-of-a-later-copy.md`](../F029-sync-return-of-a-later-copy/plan.md).

Update 2026-11-09: the rules are per synced folder now (a cursor for each folder of `mailbox_folders`); see [`../../done/2026-11/F058-sync-sort-folders/plan.md`](../../done/2026-11/F058-sync-sort-folders/plan.md).

## Goal

S3 stage 6 only logs and counts a copy that lands below the UID cursor. Interia may keep the UID on a COPY back to INBOX. The sync then does not see the mail as new. Store such a copy as `#n` and triage it: body fetch and the chunk insert path.

## Done when

- A copy below the cursor is stored as a new copy `#n` of its identity.
- The copy gets a body fetch and is triaged through the normal chunk insert path.
- A sync test covers the case. The `returned below cursor` line shows `copies 0` after the fix.

## Data from the stage 20 week

The values of `copies <c>` in the `sync <mailboxId> returned below cursor` lines are open. Stage 20 has not run. Fill them in from the stage 20 week of real use.

One copy counts again on every sync for 7 days. So give the distinct rows from the debug line `copy below cursor: email <id>` when it is on. If it is off, give the highest `copies` value.

- Distinct rows: _open (stage 20)_
- Highest `copies` value: _open (stage 20)_

## Plan

Write the file-level plan when the task starts.

- [ ] Write the plan (detect, store as `#n`, body fetch, triage, tests).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-07: Created from the S3 follow-ups (stage 18, step 18.3).
