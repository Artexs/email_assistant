# Handoff: build S4 (drafts, approvals, delegation)

> Created 2026-11-07 15:55 CET from Claude Code (Opus 5.5). Repo: `email_assistant`, branch `master`, S4 plan commits `c251528` and `0d5e051` (pushed). The planning sessions ran on the user's Mac; their session files (`~/.claude/projects/-Users-artek-Documents-repos-email-assistant/4f65c9f2-….jsonl`, `59d29c21-….jsonl`) and the older handoffs under `~/.pi/agent/notes/` exist only on that Mac. Everything the build needs is in the repo.

## Start here (for the new agent)

1. Read this file. Then read the task file `tasks/active/s4-drafts-approvals-delegation.md` in full and `tasks/README.md` § "How to run a slice".
2. Check the claims under "Current state" against `git log`, `git status` and `tasks/active/s3-assist-actions.md` (its status line). Write down each difference.
3. Reply to the user in max 4 lines: the goal in your own words, the differences you found, your first step.
4. **Wait for the user** before you build: S4 may start only when S3 is done (see "Current state").

## Goal of the next agent

Build S4 from the approved plan with the `run-task` skill, stage by stage (the plan has the full step detail: skip the `planner` subagent).
Done when: the task file's "Done when" and "Done-checklist" are ticked with evidence, and the task is in `tasks/done/`.

## Background

S4 = the assistant hands tasks from the user's mail to the user's delegates: it writes the forwarding mail as a draft, sends it only after the user's tap in Telegram, then tracks the delegate's reply and proposes reminders. It is the first slice that sends mail to other people, so the plan is strict on "at most once" and "never without a tap". 23 stages, 20 `[risky]`, 5 user checkpoints.

## The user's words

> "Okay, so I assume you send me just questions with your recommendations. So go with your recommendation" — every default of questions 1–12 in the task file is a decision (recorded in `0d5e051`).
> "I will start it on the different machine that have access to the full GitHub history." — this handoff lives in the repo, not in `~/.pi`.

## Current state

- DONE: the S4 plan (task file + 23 stage files in `tasks/active/s4-drafts-approvals-delegation/`), three cold reviews (round 3: no blocker or major open), the user's approval. Probe scripts in `notes/2026-11-07-s4-probes/` (`.ts.txt`, README).
- NOT STARTED: the S4 build. No S4 code exists.
- S3 (the base of S4), status on 2026-11-07 15:53 CET: stages 1–15 and 18 done and pushed; stage 16 (dev run with the user's phone) and stage 17 (restore test, needs the `age` key and a backup file) are blocked; stages 19–20 (VPS) wait for the user's go. S4 stage 22 needs S3 stages 19–20 on the VPS.

## Decisions (and why)

- Wait for S3 before the S4 build — S4 changes many S3 interfaces (D33 of the task file); building both in one working tree at once makes them change the same files. Rejected: start S4 stage 1 in parallel (the parallel-agents note says a worktree does not isolate the dev DB and the ports).
- First build step, before stage 2: compare D33 and the stage 7/10/11 interface blocks with the final S3 code (`apps/server/src/modules/actions/repo.ts` and friends) and fix the plan where S3 changed — the round-3 reviewer named this the third biggest risk; S3 kept changing during planning.

## Dead ends and traps

- The probe scripts are `.ts.txt` on purpose: as `.ts` they fail `eslint .` (the repo-wide lint).
- Stage 1 (Interia probe) needs the user: the Interia password on stdin and `/pause` / `/resume` of the pilot mailbox around the run.
- Stage 19 needs the dev bot on the user's phone. A Telegram test-user account would let the agent test alone: the user was offered a planned task for it and has not answered; see `notes/2026-11-07-telegram-test-accounts.md` (another session's recon).

## Key data

- Check after each step: the commands in the task file's "Rules for every step".
- Real-system gates: `ACTIONS_SCOPE` and `SEND_SCOPE` stay `off` in `.env`; `SEND_SCOPE=self` only from stage 19 (command line on the Mac) and stage 22 (VPS); `all` only at stage 23 with the user's go.

## Files and links

- `tasks/active/s4-drafts-approvals-delegation.md` — the plan: P1–P8, D1–D33, facts, rules, checkpoints, the stage list, the review log.
- `tasks/active/s4-drafts-approvals-delegation/stage-01…23-*.md` — one file per stage.
- `tasks/active/s3-assist-actions.md` — the S3 status and interfaces.
- `notes/2026-11-07-s4-probes/README.md` — how to run the SMTP/IMAP probes again.
- `notes/2026-11-07-parallel-agents-worktrees.md` — proposal: one worktree per agent and what it does not isolate.
- `notes/2026-11-07-telegram-test-accounts.md` — Telegram test environment recon.

## Open questions

- The Telegram test-user account (a planned task before S4 stage 19)? — the user.

## Suggested skills

- `run-task` — the build, stage by stage (skip the planner). It lives in `~/.pi/agent/skills/` on the user's Mac; if that machine has no such skill, follow `tasks/README.md` § "How to run a slice" (plan → build → review per stage, the main session commits).

## Earlier handoffs

- `~/.pi/agent/notes/2026-11-07-handoff-s4-plan-finish.md` and `~/.pi/agent/notes/2026-11-06-handoff-s4-drafts-plan.md` (on the user's Mac only; the planning work they describe is finished).
