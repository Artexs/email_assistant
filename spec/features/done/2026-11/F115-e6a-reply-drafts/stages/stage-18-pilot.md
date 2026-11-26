# F115 stage 18 — Pilot

Part of [`../plan.md`](../plan.md). `[risky]` (deploy, real mailbox, sending to people). Needs 17. The coordinator runs it (VPS steps are pre-approved, `spec/build.md`); owner step O1 is in it.

## Step 1 — Deploy and turn on

- **Goal:** release the build to the VPS by `deploy/README.md` § Release: every deploy is a release (plan F9). Tag a patch or minor version by `docs/release-checklist.md` (CI green on the tag), then `deploy/release.sh v<x.y.z>`; it takes the backup, runs `db:migrate` and keeps the rollback image. Its last line must be `release ok <tag> previous <old>`; then watch 30 min (checklist). Turn on the org flag `reply_drafts` for the pilot org only and the switch `reply_drafts` for the pilot mailbox (a password mailbox, D19). One-off commands run in the `cli` service: `$C run --rm cli bun run <script> …` (`deploy/README.md` § Logs). `SEND_SCOPE` stays as it is on the VPS. Keep `reply_drafts` OFF until the release that you deploy holds stage 17 (the consent version `2026-11-19`, `TERMS_VERSION` `2026-11-19-2`): without it an owner with the flag on gets "Confirm the new Telegram terms in the panel" and no panel version can cover reply data. After the release, every pilot owner who linked Telegram earlier taps Confirm in the "New Telegram terms" block of the Telegram card (`/mailboxes`; it shows while `reply_drafts` is on and the consent is older than `REPLY_CONSENT_SINCE`, also with `open_loops` off) before the reply cards show in Telegram (`deploy/README.md` § Reply drafts, Release step 2).
- **Checks (each with its command output in `pilot.md` in this folder; counts and codes only, no mail text):**
  1. `$C run --rm cli bun run job:run --name replies.drafter`, then `bash deploy/logs.sh --since 1h --event reply_drafted` (and `--event reply_draft_failed`) → event lines with ids and codes only. A `job:run` in `cli` prints to the terminal; the server's own runs reach the log.
  2. A `needs_reply` mail to the pilot mailbox (from the owner's other address) gets a draft in Drafts within 1 min (the `actions` row `applied` with `copy_hash`).
  3. **N1a:** `$C run --rm cli bun run reply:check-copy --org-id <org id> --action-id <id>` (stage 08; it needs the organization id, as every CLI) prints `same` after 1 h without an edit. Then turn on the flag `draft_copy_check` for the pilot org (D9).
  4. **N1b:** the owner opens Interia webmail: is the draft in the thread? (owner answer in `pilot.md`).
  5. **N1c:** the owner answers one mail from webmail; within 10 min `email_flags.answered` is true or the Sent mark exists, and the sweep closes the draft as `answered`.

## Step 2 — Owner step O1 (not a stop)

- The owner sends three real replies from drafts after edits: at least one by tap (Telegram or panel) and at least one from the mail client. The coordinator records the outcome counts (`replyOutcomeCounts` for the pilot week) in `pilot.md`.
- A mail-client send must end the system send as `sent_by_user` or `draft_changed` when the owner taps it later (no double reply).

## Step 3 — Exit record

- **Goal:** `pilot.md` lists the PD-083 exit bar items with their evidence: the stage 02 report numbers, the injection set result, the owner's check of 20 drafts against the judge (owner step; if not done, write "not done" and the default), the three real replies.
- **Rollback:** the flag `reply_drafts` off stops new drafts at once; open reply sends stay held by the committer (D12) and expire. A code rollback is `deploy/rollback.sh` (no `db:rollback`); turn the flag off first. The old code ignores the new tables. A release older than stage 03 does not know the new outbox kinds: one `pending` or `sending` row of them makes `claimDueOutbox` fail the whole claim batch for all orgs, so no Telegram notice goes out. Before such a rollback, run the SQL of `deploy/README.md` § Reply drafts (stage 17): it fails those rows and ends the open reply actions.
- **Done when:** `pilot.md` is committed with checks 1–5 and the O1 result or "waiting for the owner"; the ticket closes with the last land.
- **Out of scope:** turning the flag on for other orgs; "Turn on recommended" (E4-B, after the exit bar).
