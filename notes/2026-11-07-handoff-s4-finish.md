# Handoff: finish S4 (eval decision, VPS deploy, real sends)

> Created 2026-11-07 23:01 from Claude Code (Opus 5.5). Repo: `/home/artek/Documents/repos/email_assistant` (branch `master`, last commit `8f4d55e`, pushed). Session: `~/.claude/projects/-home-artek-Documents-repos-email-assistant/256fe465-c41c-4f7b-9b80-eedf0c2cf52e.jsonl` (this PC only).

## Start here (for the new agent)

1. Read this file. Then read the task file `tasks/active/s4-drafts-approvals-delegation.md` (status line, "Results", the last 20 log lines) and the stage files 20, 22, 23 in `tasks/active/s4-drafts-approvals-delegation/`.
2. Check the claims under "Current state" against `git log`, `git status` and the task file. Write down each difference.
3. Reply to the user in max 4 lines: the goal in your own words, the differences, the first step.
4. **Wait for the user**: the first step needs the user's decision on the eval miss (Open questions), and stages 22–23 touch the VPS and send real mail.

If this file does not answer a question, search the session file for the topic word. Do not guess.

## Goal of the next agent

Finish S4: settle stage 20 (the eval gate miss), deploy S4 to the VPS with `SEND_SCOPE=self` and do the first real round trip (stage 22), then `SEND_SCOPE=all` with a real delegate (stage 23), then close the task.
Done when: the task file's "Done when" and "Done-checklist" are ticked with evidence, and the task (with its folder) is `git mv`ed to `tasks/done/`.

## Background

S4 = the assistant writes a delegation draft, sends it only after the owner's Telegram tap, tracks the reply and proposes reminders. All code is built: stages 1–18 and 21 are done, and every stage review and both group reviews (checkpoints 2 and 3) gave PASS. The VPS runs S3 at `00588d7` (pre-S4, deployed by another chat; S3 is in `tasks/done/`).

## The user's words

> "Continue with it. What do you want from me? Do it until you finish it." — build to the end without stops; take decisions with a recommendation.
> "Keep in mind that there is some limits on the Cloud Code subscription … especially when you are running the review with the stronger model like Opus." — stage reviews on Sonnet (high); Opus only where the plan requires it.
> "But ultimately I need to just proceed with it and finish this task to do all the missing steps." — this handoff: finish S4 in a new chat.

## Current state

- DONE: stages 1–18, 21 (code, docs, notes, known alerts, follow-ups). Stage 1 = the user's Interia send probe (all facts held, no plan change). Lint 0, typecheck 0, unit 1112 pass, int 836 pass (after the merge of fake-telegram).
- DONE (with a caveat): stage 19 ran on GreenMail with `tools/fake-telegram` in place of the phone (main-session decision); steps 1–15 pass. Box 19.1 is unticked: its done-when names the user's phone. Ask the user if a real-phone look is wanted, else tick it with that note.
- PARTIAL: stage 20. Run 2 of the `classifier-v2` eval (OpenAI `gpt-6-luna`, 108 cases): injection 16/16, whitelist 12/12, delegate pick 8/8, draft kind 16/16, delegation 12/12. **One gate miss:** on the 86 LLM rows of the same 92 old cases, `info` precision 75.0% → 69.2% (−5.8, limit 5; one mail `syn-urgent-16` read as `info`); `spam` −3.5 (inside the limit). Box 20.1 unticked; waits for the user.
- NOT STARTED: stage 22 (VPS deploy, `SEND_SCOPE=self`, first real send to the user's own second address and a reply), stage 23 (`SEND_SCOPE=all`, a real delegate, one week of use), the done-checklist, the move to `tasks/done/`.

## Decisions (and why)

- **Deploy rule:** no VPS deploy of a master commit after `c0340b4` before stage 20 passes or the user accepts the miss — `classifier-v2` is live code on master. Written in the S4 task head, stage 20, and S3 stage 19.
- **Main-session recommendation for stage 20:** accept the miss — one case, and the results have no generation settings, so one case changes between runs. Rejected for now: a fix round (it can move other categories, and it costs another run of about $0.02).
- Other build decisions are in the task log (2026-11-07 lines): approve refuses while the draft is not applied (`draft_not_ready`); a 5xx is never soft; a lone send finds its draft by the derived idempotency key; Polish date names in pl drafts; eval gate "delegate pick ≥ 7/8" (10/12 could never be met).

## Dead ends and traps

- The stage 20 comparison went wrong twice: the v1 "Metrics per category" table holds only the **86 LLM rows** (6 rule rows left out) of 92 cases. Compare v2 on the same basis: leave out the 12 delegation cases, `inj-13`…`inj-16` and the rule rows. The v2 per-case data is in `evals/.runs/gpt-6-luna-none-classifier-v2-all.jsonl` (this PC, not in git).
- Other chats work in this repo at the same time (fake-telegram is done and merged; test-mail-traffic plan is active). They committed in this checkout and pushed S4 commits. Stage by explicit path; never `git add -A`. `tasks/done/test-mail-traffic*` changes are not S4's.
- Quiet hours (22:00–07:00 Warsaw) hold approval messages: a dev run at night needs another org timezone (stage 19 used `America/New_York`).
- Docker socket: this shell has no docker group; `dev:up` fails. The containers db (5433) and GreenMail (3143/3025) were up. SQL went through `psql` as `postgres`.

## Key data

- LLM provider in the local `.env`: `openai` (`gpt-6-luna`, reasoning effort none). The eval: `bun run eval --set all --fresh --out evals/results/<date>-<model>-classifier-v2.md`.
- Stage 22 needs from the user: the second address the user owns in the VPS `.env` (`SEND_TEST_ADDRESSES`), `SEND_SCOPE=self`, and the go. The user edits the VPS `.env`; the agent never prints or edits it. VPS shell: `ssh home_vm` (see `deploy/README.md` and S3 stage 19 in `tasks/done/s3-assist-actions/`).
- Stage 23 needs: a real delegate (`delegates:add`), `SEND_SCOPE=all` (only after one `self` round trip: send, reply, answered), the user's go; stage 23.1 step 0 checks held `approved` sends first.
- Pilot ids (from S3 stage 19): org `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, mailbox `8bc7f572-a7f5-4fa5-aaab-db16dc663e96`.

## Files and links

- `tasks/active/s4-drafts-approvals-delegation.md` — status, Results (stages 1, 19, 20), rules, checkpoints, log.
- `tasks/active/s4-drafts-approvals-delegation/stage-20-eval-prompt-v2.md`, `stage-22-vps-deploy-self-send.md`, `stage-23-first-real-delegation.md` — the open steps.
- `evals/results/2026-11-07-gpt-6-luna-classifier-v2.md` (v2 run 2), `evals/results/2026-11-06-gpt-6-luna-none.md` (v1).
- `notes/2026-11-07-send-approval-facts.md` — S4 facts; `notes/2026-11-03-interia-imap-capabilities.md` § "Send probe (S4 stage 1)".
- `deploy/README.md` — approvals, sends, jobs, rollback (S4 sections).
- `tools/fake-telegram/README.md` — the fake Bot API for agent-only Telegram runs.

## Open questions

- Stage 20: accept the `info` miss (recommended), or a fix round? — the user.
- Stage 19.1: does the user want to see the approval message once on a real phone? — the user.
- Stage 22: the user's second address for `SEND_TEST_ADDRESSES`, and the go for the VPS deploy. — the user.
- Leftovers to clean by hand: a probe mail "EA probe send …" from the first probe run may still be in the Interia INBOX `[not verified]`; a disabled test delegate `manual-test@localhost` in the dev DB. — the user / the agent with the user's yes.

## Suggested skills

- `run-task` — the remaining stages (no planner: the stage files hold the detail).

## Earlier handoffs

- `notes/2026-11-07-handoff-s4-build.md` — the build start (this chat).
