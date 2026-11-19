# Coordinator handoff, 2026-11-19 evening

The owner restarted the coordinator session. This note holds what the old session knew and the files do not show.

## Board
- Active: only F115 (reply drafts). Closed today: F029, F064, F102, F104, F107, F110, F113, F114, F116, F119, F120.
- Owner rule (spec/build.md): work only on `active/`; start no `planned/` ticket. Exception: F138 stage 01 (done).
- Owner decision (docs/owner-decisions.md 2026-11-19): tickets that wait on time close with the data of today.

## Running job
- `2026-11-19-f115-drafter-v3-no-invented-comm-b4ea3556` (Opus, cap $3), task `/tmp/f115v3.md`.
  - drafter-v2 holdout: invented commitments 5 (bar 0), send as is 90.5%, code checks 252/252, injection 14/14. Gate `passed: false` (`evals/results/gate/drafter-drafter-v2-gpt-6-luna-low-lab-01-v1.json`).
  - The job finds the fault on the lab `week` part (dev shows 0), writes drafter-v3, then ONE blind holdout re-gate. It switches `prompts.drafter` only on a pass.
  - On its wake: land with `limen land <id> --yes --keep-open` (F115 has open stages). Drop its DB: `bun run db:worktree 2026-11-19-b4ea3556 --drop`.
- Coordinator decision: PD-083 bars stay (0 invented commitments). Told the owner: if v3 misses by a few, a pilot on v2 is possible because every draft needs his Send tap. He has not answered.

## F115 after a passed gate (stage 18)
- Release a new tag (v0.4.2) with the F115 stage 17 code (consent fix) and the drafter switch. VPS: `home_vm`, `~/email_assistant`; detail in `notes/2026-11-15-vps-deploy-queue.md` § v0.4.1. Restore `deploy/compose.sim.yaml` with `git checkout --` before `deploy/release.sh`. Never touch the ea-sim stack.
- Then `reply_drafts` on for the pilot org, the owner confirms the new Telegram terms, three real replies (stage 18 file).

## Pilot org flags on (VPS, v0.4.1)
sent_sync, security_log, review_command, approvals_page, delegation_pages, trust_ladder, sender_context, contact_wait, open_loops, delegate_button. Off: reply_drafts, sender_suggestions.

## Waiting on the owner
- "go" for a planned batch: proposed F138 (stages 02-06), F124, F139 (needs a plan), F108. Proposed to drop F037 and F047 as stale.
- PD-083 owner check: `spec/features/active/F115-e6a-reply-drafts/owner-check-20.md`.
- Browser checks after v0.4.1: terms dialog, /approvals, /delegations, /report, a TOTP sign-in.
- Did the owner send mail himself from the Interia mailbox in the last 30 days (Wysłane holds only the assistant's 3 mails)?

## Other open facts
- The F113 lab day `day-20261120-215c` stays scheduled on the VPS (cap $1); score it later with `docker exec ea-sim-lab-1 bun run lab score --run day-20261120-215c`.
- Backup fix `36c1a440` is live since v0.4.1.
- Tag v0.4.0 was never deployed.
