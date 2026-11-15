# F115 stage 18 — Pilot

Part of [`../plan.md`](../plan.md). `[risky]` (deploy, real mailbox, sending to people). Needs 17. The coordinator runs it (VPS steps are pre-approved, `spec/build.md`); owner step O1 is in it.

## Step 1 — Deploy and turn on

- **Goal:** deploy `master` to the VPS by `deploy/README.md` (backup first, name the rollback target, verify after). Run `bun run db:migrate` there if stage 03 is not yet on the VPS. Turn on the org flag `reply_drafts` for the pilot org only (operator console or CLI) and the switch `reply_drafts` for the pilot mailbox. `SEND_SCOPE` stays as it is on the VPS.
- **Checks (each with its command output in `pilot.md` in this folder; counts and codes only, no mail text):**
  1. `job:run --name replies.drafter` → the log shows `reply_drafted` or `reply_draft_failed` event lines with codes only.
  2. A `needs_reply` mail to the pilot mailbox (from the owner's other address) gets a draft in Drafts within 1 min (the `actions` row `applied` with `copy_hash`).
  3. **N1a:** `bun run reply:check-copy --action-id <id>` (stage 08) prints `same` after 1 h without an edit. Then turn on the flag `draft_copy_check` for the pilot org (D9).
  4. **N1b:** the owner opens Interia webmail: is the draft in the thread? (owner answer in `pilot.md`).
  5. **N1c:** the owner answers one mail from webmail; within 10 min `email_flags.answered` is true or the Sent mark exists, and the sweep closes the draft as `answered`.

## Step 2 — Owner step O1 (not a stop)

- The owner sends three real replies from drafts after edits: at least one by tap (Telegram or panel) and at least one from the mail client. The coordinator records the outcome counts (`replyOutcomeCounts` for the pilot week) in `pilot.md`.
- A mail-client send must end the system send as `sent_by_user` or `draft_changed` when the owner taps it later (no double reply).

## Step 3 — Exit record

- **Goal:** `pilot.md` lists the PD-083 exit bar items with their evidence: the stage 02 report numbers, the injection set result, the owner's check of 20 drafts against the judge (owner step; if not done, write "not done" and the default), the three real replies.
- **Rollback:** the flag `reply_drafts` off stops new drafts at once; open reply sends stay held by the committer (D12) and expire.
- **Done when:** `pilot.md` is committed with checks 1–5 and the O1 result or "waiting for the owner"; the ticket closes with the last land.
- **Out of scope:** turning the flag on for other orgs; "Turn on recommended" (E4-B, after the exit bar).
