# F151 plan — demo video and docs shots from the demo-week export

> **Status 2026-11-20 — stages 01–04 landed.** Plan base: `dc943d8dc`, refreshed 2026-11-20 ([plan-refresh-1.md](plan-refresh-1.md)). Seven stages. [scouts.md](scouts.md), [questions.md](questions.md).

## Input

Ticket notes (coordinator, 2026-11-19 and 2026-11-20): owner gates G2 (commit the seed) and G3 (upload, pin `DEMO_VIDEO_SHA256`) of F121 move here, default "prepare, do not publish"; redo the spike on the demo seed and make steps 2, 3, 5 live or say why not. F121 D7 stays: the recording "drives only the panel, product CLIs and GreenMail delivery, never raw SQL"; captions name no organization.

### Product

- **P1** One organization on camera: the import "Kordelan demo (import)". Rejected: e2e organizations for some steps (two names).
- **P2** All eight steps live on the demo source. Step 2 shows shadow mode on mail that arrives during the recording, not "days passed" (default, Q3). A step that cannot be live is a question.
- **P3** The model is a loopback replay of the demo week's own classifier answers (default, Q2). Rejected: the real model (spend, a key, a video per take); invented answers.
- **P4** Global evidence on camera is the committed gate file of the replayed model and prompt. The recording relabels it to the replay key. A provisional source file makes the video "not for upload" (default, Q1). Rejected: the e2e fixture gate (decisions that no real file holds).
- **P5** The video cuts the waits between steps; each step keeps its seconds. Rejected: faster sync intervals.
- **P6** Docs shots need no code change: locally through `DEMO_SEED_FILE`; CI and the site only after G2.

### Design

- **D1** Two mailboxes. A: the import; it stays `paused` and gives history and overdue delegations. B: `office@<domain of A>` on GreenMail, connected on camera in step 1; every live step runs on B.
- **D2** Replay key: lower-case sender and trimmed subject. The answer replays the seed row's category, confidence, reason, summary and `fields`. An ambiguous key, a rule or error row give no entry. No hit: HTTP 500 and one miss.
- **D3** Demo-source server env (stage 04): scope `synthetic`, the replay as an own OpenAI endpoint on loopback, the gate copy, sync every 2 min; any other model route refuses (`demo_llm_not_loopback`).
- **D4** Seed checks before any server starts (stage 02): one model and prompt version, the production prompt, a gate file with a `go` category.
- **D5** Mail goes by IMAP APPEND into B's INBOX on GreenMail with the seed's sender, subject and text and Message-ID `<demo-<n>.<run tag>@ea-seed.test>` (the `synthetic` scope takes it). History mail keeps the seed offsets, the newest at now − 2 days, so the first sync (last 24 h) leaves it to the history backfill. Live mail gets the time of delivery. Picks need confidence ≥ 0.7; the undo mail ≥ its gate threshold.
- **D6** Setup off camera, product paths only: import, flags `trust_ladder`, `approvals_page`, `delegation_pages`, `user_quiet_hours`; `auto` off on A (else the re-gate sends `autonomy_paused` into the chat); Telegram link of the owner; quiet hours none; empty B on GreenMail; APPEND the history set. After the tap of step 4, `create_draft` on for B (off by default).
- **D7** Waits between steps poll with the limits of `DEMO_WAIT_LIMITS_MS` (stage 04) and fail `demo_wait_timeout <what>`.
- **D8** Step 7 reminds an imported overdue delegation with fewer than 2 reminders and an active delegate, when A's seed settings are `assist` with `create_draft` on; else the step-6 delegation after it is `sent`.
- **D9** `DEMO_STEPS`: `live` and `caption` per source.
- **D10** The upload line: `demo_source demo: upload candidate` only with a final gate, a day-5 seed (D12), 0 misses and no not-live step; else `not for upload: <reason>`. The run also proves the model route: server `llm_settings` lines all `own` on loopback, and replay hits for every delivered mail.
- **D11** No migration, `bun.lock` change or new package; CI never runs ffmpeg or the demo source.
- **D12** Trial seed (refresh 1; default, Q6). Stages 05–07 build and prove on any export of run day 1 or later (C1a). Proofs take the newest `demo-seed-day*.json` in the D6 folder. The run prints `demo_seed_day <n>`; day < 5 gives `not for upload: trial_seed`. Pick rules (D4, D5) never relax for a trial: a refusal is a finding, and the coordinator continues the stage on a later export. Rejected: a trial mode with smaller pick counts (it proves a run the final take never makes).
- **D13** Final only (C3): the day-5 runs of the stage 06 and 07 proofs, the G2 size line, the G3 verdict. Stages 05–07 close on a trial seed.

## Facts checked (base `e8f6f2b1`; refresh at `dc943d8dc`)

Facts used only by stages 01–04: this file at `e8f6f2b1`.
- `record.spec.ts` throws `demo_source_recording_not_built` for a non-e2e source.
- Gate files: classifier-v2 (`info` go at 0.95) and v3, both `provisional: true`; production prompt `classifier-v2`. `recommended` needs a non-provisional file (`trust.md` rules 1, 3).
- Sync cron `*/N`, N 2, 3 or 5; a first sync searches the last 24 h by internal date; the history check waits 5 min on `never_synced` (`sync.md` rule 6, `trust.md` rule 7).
- Notices wait through quiet hours 22:00–07:00 Warsaw. The export has no history check, Telegram link or user; import makes the mailbox `paused` and open actions `expired` (`live-lab.md` rule 24). `create_draft` is off by default, also in assist. `planDelegation` needs `task`.
- Stages 01–04 landed; the stage 04 review notes are in [notes-for-stages-05-06.md](notes-for-stages-05-06.md).
- The C1 run starts 2026-11-23; day 1 ends 2026-11-23T23:00Z, day 5 2026-11-27T23:00Z (`notes/2026-11-15-vps-deploy-queue.md` § Demo run for F151). `exportDemo` takes any day 1–7, keeps rows before 00:00 Warsaw after that day, and does not refuse a day not yet ended. The import replaces an earlier one. Days 1–3 are shadow, so a trial seed gives `overdueDelegation` null (D8 fallback).

## Not verified

- A trial or final export holds enough mail per D4/D5 (stage 05 run).
- The demo org's plan allows a second mailbox; GreenMail keeps the internal date of an APPEND; `publicContentScan` passes on demo-week text (stages 05–07).

## Rules for every stage

- Format only the stage's files. No `.env` read. No secret, real address or host in code, logs or files.
- Never commit a seed, upload a video, pin a hash or run `docs-deploy` (G2, G3).
- `demo:record` runs under `flock /tmp/email-assistant-shared-tests.lock`; `docs:shots` follows `CLAUDE.md` at the time of the run.
- Replay server and recording log counts and codes only, no mail data.
- Pure parts and tests live in `apps/web/e2e/lib/` or the tool folder.
- A gap or a deviation is a question in the final message, not a choice.

## Proof

The last line of `bun run check:job`; stages 05–07 add a run command. Done when: the ticket's Acceptance (6 items) and each stage's Done when.

## Coordinator steps and owner gates

- **C1a** (VPS, coordinator, from 2026-11-23T23:00Z): `$L demo-export --day <N>` of the newest run day (`deploy/README.md` § Sim stack step 12), copied to `~/.local/share/email-assistant/demo/demo-seed-day<N>.json` (mode 0600); remove the VPS copy. Again for a later day after a refusal. The sim run uses the production classifier setup (`openai`, `gpt-6-luna`, `classifier-v2`), else D4 refuses.
- **C1** (from F121, after 2026-11-27T23:00Z): the same with `--day 5` (`demo-seed-day5.json`).
- **C3** Final take (D13): a follow-up ticket, not a stage. After C1, run the stage 06 and 07 Proof commands; update the README result line and the G2 and G3 lines of the F121 close-out note.
- **C2** At close: `bun run db:worktree f121_demo --drop` from the main checkout. C3 and later takes make a new `*_demo` database first.
- **G2** owner: commit the export (under 5 MB) to `apps/web/e2e/demo/demo-seed.json`. Default: not committed.
- **G3** owner: watch and upload an upload candidate; the coordinator pins the hashes. Needs a final gate file (Q1). Default: no upload.

## Review

Opus review before the land: stages 01, 04, 05, 06. Others land on the proof.

## Stages

1. [Replay model](stages/stage-01-replay-model.md). Landed (`0df5bec69`).
2. [Demo run plan](stages/stage-02-demo-run-plan.md). Landed (`d66055cd6`).
3. [Cut timeline](stages/stage-03-cut-timeline.md). Landed (`08ed7ce79`).
4. [Demo command and env](stages/stage-04-demo-command-env.md) `[risky]`. Landed (`1377e28f9`, review PASS).
5. [Demo setup](stages/stage-05-demo-setup.md) `[risky]`.
6. [Demo recording](stages/stage-06-demo-recording.md) `[risky]`.
7. [Shots, docs and gates](stages/stage-07-shots-docs-gates.md).

## How to run (coordinator)

01–04 landed. 05 after C1a (a trial export is enough) and the `*_demo` database. 06 after 05. 07 after 06. C3 after C1, as a follow-up ticket. Spawn with the standing worker route and prepare (`spec/build.md`), task "Implement F151 stage NN from its folder". Land with `limen land <id> --yes --keep-open`; the last land closes the ticket; then C2.

## Planning progress

- [written] ticket, plan, questions, scouts (4 started, 4 packets), stages 01–07; review 1 applied.
- Refresh 1 (2026-11-20): D12, D13, C1a, C3; stages 05–07 changed; no scouts.
- Words (`wc -w`, after refresh 1): plan 1487; stages 698, 696, 661, 602, 699, 699, 671.

## Cold review

`claude-opus-5-5`, high: `[risky]` stages (paid-model guard, public video). Review 1 ([plan-review-1.md](plan-review-1.md)): all findings fixed ([response](plan-review-1-response.md)).
