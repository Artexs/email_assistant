# F116 stage 25 — Pilot

Part of [`../plan.md`](../plan.md). `[risky]` (production, real mail, sending to people). Needs stage 24 and gate G1. The coordinator runs this stage (VPS steps are pre-approved, `spec/build.md`); the owner taps the real follow-up (O1).

## Step 0 — Gate G1 (second pass)

- **Input:** the first E3a weekly report on the pilot (due loops per day, median reply time, replies that only promise) and the E2b live week result (`docs/product/stage-2/epics/E05-discovery-notes.md` §5).
- **Rules:** PD-119: the median answer comes after day 3 → set the default `loop_wait_days` to 4 or 5 (one constant and the migration default stay; the per-mailbox value is set by the route). PD-120: ≤ 3 due Waiting loops per day and the follow-up template passes the E2a draft judge → `auto_follow_up` on by default for new mailboxes (a code change: one small job before step 1). PD-122: ≥ 20% of replies in Waiting threads only promise → a new ticket, not this stage.
- **Who:** the coordinator decides on these rules and the defaults and writes an owner-decisions entry. Missing data (no weekly report yet) → keep the defaults and say so.

## Step 1 — Lab first

- **Goal:** on the `ea-sim` lab (F113), with flags `sent_sync`, `open_loops`, `delegate_button` on for the lab org: the E2b week scorer's planted dropped threads all appear in the brief within the set wait (M2-surfaced on the sim = 100% of planted cases), and no follow-up is planned for a planted phishing thread.
- **Check:** the scorer output file and `bun run stats:week` for the lab org; the counts go in the final message (no text).

## Step 2 — The pilot mailbox

- **Goal:** on the owner's pilot org (Interia): flags on, "Track my sent mail" on, the owner's Telegram chat confirms the new terms.
- **Procedure:** backup first; name the rollback target (flags off; no migration to undo); deploy the land commit; turn the flags on with the operator CLI; wait for one morning brief.
- **Check (N1):** one real Waiting loop gets "Draft follow-up" → the card shows the original To and Cc → the owner taps Send (O1) → the mail arrives in the thread at the recipient (the owner checks it in the client) and the loop restarts its wait. Interia's Drafts copy and `\Answered` behaviour are noted in `notes/2026-11-<day>-open-loops-pilot.md`.
- **Stop rule:** a wrong recipient, a follow-up on a closed loop, or loop text in a Telegram chat with an old consent → flags off at once, a `docs/known-alerts.md` entry, a ticket.

## Done when (stage)

G1 is recorded; steps 1 and 2 hold; the pilot note is committed; the final message gives the counts of the first pilot week (loops opened per kind, closed per reason, follow-ups sent).

## Out of scope

New product rules from G1 beyond the three above (a new ticket).
