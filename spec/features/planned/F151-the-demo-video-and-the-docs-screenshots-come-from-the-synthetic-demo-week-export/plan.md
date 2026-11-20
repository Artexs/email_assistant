# F151 plan — demo video and docs shots from the demo-week export

> **Status 2026-11-20 — planned.** Plan base: `e8f6f2b1`. Six stages. [scouts.md](scouts.md), [questions.md](questions.md).

## Input

Ticket notes (coordinator, 2026-11-19 and 2026-11-20), word for word:
- "`bun run demo:record --seed <C1 file>` logs `demo_source demo` and writes an MP4 of 100–130 s with en and pl captions. Owner gates G2 (commit the seed) and G3 (upload, pin `DEMO_VIDEO_SHA256`) of F121 move here; default: prepare, do not publish."
- "This ticket redoes the spike on the C1 demo seed (real triage on the sim stack) and makes them [steps 2, 3, 5] live or says why not."
- F121 D7 stays: the recording "drives only the panel, product CLIs and GreenMail delivery, never raw SQL"; captions name no organization.

### Product

- **P1** One organization on camera: the import "Kordelan demo (import)". The demo source loads no e2e organization. Rejected: e2e organizations for some steps (two organization names in one video).
- **P2** All eight steps live on the demo source. Step 2 shows shadow mode on mail that arrives during the recording ("it only shows what it would do"), not "days passed" (default, Q3). A step that the worker cannot make live is a question, not a choice.
- **P3** The model is a loopback replay of the demo week's own classifier answers (default, Q2). Rejected: the real model during the recording (spend, a key on the recording machine, a video that changes per run); invented canned answers.
- **P4** Global evidence on camera is the committed gate file of the replayed model and prompt. The recording relabels it to the replay key. A provisional source file makes the video "not for upload" (default, Q1). Rejected: the e2e fixture gate (decisions that no real file holds).
- **P5** The video cuts the waits between steps (sync every 2 min, jobs every 15 s). Each step keeps its planned seconds. Rejected: faster intervals (config allows 2, 3, 5 min).
- **P6** Docs shots need no code change: a local run takes the export through `DEMO_SEED_FILE`; CI and the site take demo shots only after G2.

### Design

- **D1** Two mailboxes. A: the imported one; it stays `paused` (import placeholder secret) and gives the history and the overdue delegations. B: `office@<domain of A>` on GreenMail, connected on camera in step 1; every live step runs on B.
- **D2** Replay key: the lower-case sender address and the trimmed subject of the block after "The email to classify:" in the user prompt. A key with two seed answers that differ is left out. The delegate comes by name from the prompt's delegate list. No hit: HTTP 500 and one miss.
- **D3** Demo-source server env: `TRIAGE_LLM_SCOPE=synthetic`, `LLM_PROVIDER=openai`, `OPENAI_BASE_URL=http://127.0.0.1:<replay port>/v1`, `OPENAI_OWN_MODEL=<seed model>`, `OPENAI_OWN_API_KEY` empty, `GATE_EVIDENCE_DIR=<work dir>/gate`, `SEND_TEST_ADDRESSES=<step-6 delegate>`. A non-loopback base URL refuses the run (`demo_llm_not_loopback`). The e2e source keeps `TRIAGE_LLM_SCOPE=off`.
- **D4** Seed checks before any server starts: one model and one prompt version over the replayed rows (`demo_seed_mixed_models`); that prompt version is the production classifier prompt at `HEAD` (`demo_prompt_mismatch`); a gate file for the key exists (`demo_gate_missing`); a moving category is `go` (`demo_nothing_recommended`).
- **D5** Delivered mail goes by SMTP to GreenMail with the seed's sender, subject and text. The Message-ID is `<demo-<n>.<run tag>@ea-seed.test>`, so the `synthetic` scope takes it. History mail keeps the seed order, the newest dated now − 1 day. Live mail is dated now.
- **D6** Setup off camera, product paths only: import, flags `trust_ladder`, `approvals_page`, `delegation_pages`, `user_quiet_hours`; Telegram link of the owner; quiet hours none (`PATCH /api/me/notify`, equal start and end); empty the GreenMail folders of B; deliver the history set.
- **D7** Waits between steps poll with a limit and fail `demo_wait_timeout <what>`: first sync of B 3 min; shadow mail triaged 3 min; history check done 8 min; urgent notice in the chat, delegation send waiting with its Drafts copy, undo mail moved 4 min.
- **D8** Step 7 reminds an imported overdue delegation with fewer than 2 reminders and an active delegate; with none, the delegation of step 6. Log `demo_delegation_source seed|live`.
- **D9** `DEMO_STEPS` keeps one id list and the seconds; `live` and `caption` (en, pl) become per source (`e2e`, `demo`).
- **D10** The upload line: `demo_source demo: upload candidate` only with a final gate, 0 misses and no not-live step; else `not for upload: <reason>`.
- **D11** No migration, no `bun.lock` change, no new package; CI never runs ffmpeg or the demo source.

## Facts checked (base `e8f6f2b1`)

- `record.spec.ts` throws `demo_source_recording_not_built` for a non-e2e source; e2e env has `TRIAGE_LLM_SCOPE: "off"` (`apps/web/e2e/env.ts`).
- An own endpoint never gets `OPENAI_API_KEY`; empty `OPENAI_OWN_API_KEY` gives the dummy key (`openai-env.ts`). A loopback base URL is kind `own`, cost 0 (`docs/capabilities/triage.md` rule 16).
- The classifier user prompt ends with "The email to classify:" and a `Subject:` line (`classifier-v2.ts`, `buildUserPrompt`).
- Gate files at base: v2 `info` go; v3 `notification`, `spam` go; both `provisional: true`. The e2e fixture is non-provisional.
- `recommended` needs a non-provisional global file; history blocks only at 50 acted-on mails (`docs/capabilities/trust.md` rules 1, 3).
- Sync cron `*/N` with N 2, 3 or 5; the history check waits 5 min on `never_synced` (`sync.md` rule 6, `trust.md` rule 7).
- Notices wait through quiet hours 22:00–07:00 Warsaw (`digest-and-notices.md` rule 3a).
- The export has no history check, Telegram link or user rows; import makes the mailbox `paused` and open actions `expired` (`live-lab.md` rule 24).
- The C1 export does not exist at this base.

## Not verified

- A real C1 export holds enough mail per D4/D5 (stage 02 refusals; stage 05 run).
- `create_draft` is on after "Turn on recommended" (stage 04; off → setup turns it on through the settings route).
- The demo org's plan allows a second mailbox (stage 04).
- `publicContentScan` passes on real demo-week text (stages 05, 06).

## Done when

The ticket's Acceptance (6 items) holds, and each stage's Done when.

## Rules for every stage

- Format only the stage's files. No `.env` read. No secret, real address, host or tailnet name in code, logs or files.
- Never commit a demo seed, upload a video, pin a hash or run `docs-deploy`: those are G2 and G3.
- `demo:record` runs under `flock /tmp/email-assistant-shared-tests.lock`; `docs:shots` follows `CLAUDE.md` at the time of the run.
- The replay server and the recording log counts and codes only: no mail text, subject, address or header.
- Pure parts and their tests live in `apps/web/e2e/lib/` or the tool folder; Playwright folders hold specs only.
- A gap or a deviation is a question in the final message, not a choice.

## Proof

The last line of `bun run check:job` (`check:job PASS master=… tip=…`), after the last commit. Stages 05 and 06 add their run command in the stage file.

## Coordinator steps and owner gates

- **C1** (from F121): the export at the D6 path of F121 before stage 05 starts.
- **C2** At close: `bun run db:worktree f121_demo --drop` from the main checkout. A later take for G3 makes a new `*_demo` database first.
- **G2** owner: commit the export (under 5 MB) to `apps/web/e2e/demo/demo-seed.json`. Default: not committed.
- **G3** owner: watch and upload an upload candidate; the coordinator pins the hashes. Needs a final gate file (Q1). Default: no upload.

## Review

Opus review before the land: stages 01, 04, 05. Others land on the proof.

## Stages

1. [Replay model](stages/stage-01-replay-model.md) — loopback replay server and table.
2. [Demo run plan](stages/stage-02-demo-run-plan.md) — mail picks, seed checks, gate copy.
3. [Cut timeline](stages/stage-03-cut-timeline.md) — cut waits, per-source steps.
4. [Demo setup and env](stages/stage-04-demo-setup.md) `[risky]`.
5. [Demo recording](stages/stage-05-demo-recording.md) `[risky]`.
6. [Shots, docs and gates](stages/stage-06-shots-docs-gates.md).

## How to run (coordinator)

Start 01 and 03 at once. 02 after 01. 04 after 01 and 02. 05 after 03, 04 and C1 (export and `*_demo` database). 06 after 05. Spawn with the standing worker route (`spec/build.md`), `--prepare 'bash scripts/limen-prepare.sh'`, task "Implement F151 stage NN from its folder". Land with `limen land <id> --yes --keep-open`; the last land closes the ticket; then C2.

## Planning progress

- [written] ticket, plan, questions, scouts (4 started, 4 packets), stages 01–06.
- Words (`wc -w`): plan 1,355; stages 680, 697, 642, 696, 699, 587.

## Cold review

Pending.
