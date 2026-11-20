# F151 plan — demo video and docs shots from the demo-week export

> **Status 2026-11-20 — planned.** Plan base: `e8f6f2b1`. Seven stages. [scouts.md](scouts.md), [questions.md](questions.md).

## Input

Ticket notes (coordinator, 2026-11-19 and 2026-11-20), word for word:
- "`bun run demo:record --seed <C1 file>` logs `demo_source demo` and writes an MP4 of 100–130 s with en and pl captions. Owner gates G2 (commit the seed) and G3 (upload, pin `DEMO_VIDEO_SHA256`) of F121 move here; default: prepare, do not publish."
- "This ticket redoes the spike on the C1 demo seed (real triage on the sim stack) and makes them [steps 2, 3, 5] live or says why not."
- F121 D7 stays: the recording "drives only the panel, product CLIs and GreenMail delivery, never raw SQL"; captions name no organization.

### Product

- **P1** One organization on camera: the import "Kordelan demo (import)"; no e2e organization. Rejected: e2e organizations for some steps (two names in one video).
- **P2** All eight steps live on the demo source. Step 2 shows shadow mode on mail that arrives during the recording ("it only shows what it would do"), not "days passed" (default, Q3). A step that the worker cannot make live is a question, not a choice.
- **P3** The model is a loopback replay of the demo week's own classifier answers (default, Q2). Rejected: the real model (spend, a key, a video that changes per take); invented answers.
- **P4** Global evidence on camera is the committed gate file of the replayed model and prompt. The recording relabels it to the replay key. A provisional source file makes the video "not for upload" (default, Q1). Rejected: the e2e fixture gate (decisions that no real file holds).
- **P5** The video cuts the waits between steps (sync, jobs). Each step keeps its planned seconds. Rejected: faster intervals (sync allows 2, 3, 5 min).
- **P6** Docs shots need no code change: locally through `DEMO_SEED_FILE`; CI and the site only after G2.

### Design

- **D1** Two mailboxes. A: the imported one; it stays `paused` (import placeholder secret) and gives the history and the overdue delegations. B: `office@<domain of A>` on GreenMail, connected on camera in step 1; every live step runs on B.
- **D2** Replay key: the lower-case sender address and the trimmed subject of the block after "The email to classify:". The answer replays the seed row's category, confidence, reason, summary and `fields` (a delegation needs `task`). A key with two different answers, and a rule or error row, give no entry. The delegate comes by name from the prompt's delegate list. No hit: HTTP 500 and one miss.
- **D3** Demo-source server env (keys in stage 04): scope `synthetic`, the replay as an own OpenAI endpoint on loopback, the gate copy, the step-6 delegate as send test address, sync every 2 min. Unless every role row is `openai`, endpoint `own`, on loopback, the run refuses (`demo_llm_not_loopback`). The e2e source keeps scope `off`.
- **D4** Seed checks before any server starts: one model and prompt version over the picks; that version is the production prompt at `HEAD`; a gate file exists; a moving category is `go` (codes in stage 02).
- **D5** Mail goes by IMAP APPEND into B's INBOX on GreenMail with the seed's sender, subject and text and Message-ID `<demo-<n>.<run tag>@ea-seed.test>` (the `synthetic` scope takes it). History mail keeps the seed offsets, the newest at now − 2 days, so the first sync (last 24 h) leaves it to the history backfill. Live mail gets the time of delivery. Picks need confidence ≥ 0.7; the undo mail ≥ its gate threshold.
- **D6** Setup off camera, product paths only: import, flags `trust_ladder`, `approvals_page`, `delegation_pages`, `user_quiet_hours`; `auto` off on A (else the re-gate sends `autonomy_paused` into the chat); Telegram link of the owner; quiet hours none; empty B on GreenMail; APPEND the history set. After the tap of step 4, `create_draft` on for B (off by default).
- **D7** Waits between steps poll with a limit and fail `demo_wait_timeout <what>`: first sync of B 3 min; shadow mail triaged 3 min; history check done 8 min; after the tap 4 min; step-6 delegation `sent` 2 min. The demo test timeout is their sum plus the steps plus 5 min.
- **D8** Step 7 reminds an imported overdue delegation with fewer than 2 reminders and an active delegate, when A's seed settings are `assist` with `create_draft` on; else the step-6 delegation after it is `sent`.
- **D9** `DEMO_STEPS` keeps ids and seconds; `live` and `caption` become per source.
- **D10** The upload line: `demo_source demo: upload candidate` only with a final gate, 0 misses and no not-live step; else `not for upload: <reason>`. The run also proves the model route: server `llm_settings` lines all `own` on loopback, and replay hits for every delivered mail.
- **D11** No migration, `bun.lock` change or new package; CI never runs ffmpeg or the demo source.

## Facts checked (base `e8f6f2b1`)

- `record.spec.ts` throws `demo_source_recording_not_built` for a non-e2e source; e2e env has scope `off`.
- An own endpoint never gets `OPENAI_API_KEY` (`openai-env.ts`); a loopback base URL is kind `own`, cost 0 (`triage.md` rule 16).
- The classifier user prompt ends with "The email to classify:" and a `Subject:` line (`classifier-v2.ts`).
- Gate files at base: v2 `info` go; v3 `notification`, `spam` go; both `provisional: true`. The e2e fixture is non-provisional.
- `recommended` needs a non-provisional global file; history blocks only at 50 acted-on mails (`docs/capabilities/trust.md` rules 1, 3).
- Sync cron `*/N` with N 2, 3 or 5; the history check waits 5 min on `never_synced` (`sync.md` rule 6, `trust.md` rule 7).
- Notices wait through quiet hours 22:00–07:00 Warsaw (`digest-and-notices.md` rule 3a). The export has no history check, Telegram link or user; import makes the mailbox `paused` and open actions `expired` (`live-lab.md` rule 24).
- The production prompt is `classifier-v2`; its gate: `info` go at 0.95. `planDelegation` needs `task`. A first sync searches the last 24 h by internal date. `create_draft` is off by default, also after the switch to assist (plan-review-1 B1, F2, F4, N6).
- The C1 export does not exist at this base.

## Not verified

- A real C1 export holds enough mail per D4/D5 (stage 02 refusals; stage 05 run).
- The demo org's plan allows a second mailbox (stage 06).
- GreenMail keeps the internal date of an APPEND (stage 05).
- `publicContentScan` passes on real demo-week text (stages 06, 07).

## Done when

The ticket's Acceptance (6 items) and each stage's Done when.

## Rules for every stage

- Format only the stage's files. No `.env` read. No secret, real address, host or tailnet name in code, logs or files.
- Never commit a demo seed, upload a video, pin a hash or run `docs-deploy`: those are G2 and G3.
- `demo:record` runs under `flock /tmp/email-assistant-shared-tests.lock`; `docs:shots` follows `CLAUDE.md` at the time of the run.
- The replay server and the recording log counts and codes only: no mail text, subject, address or header.
- Pure parts and tests live in `apps/web/e2e/lib/` or the tool folder.
- A gap or a deviation is a question in the final message, not a choice.

## Proof

The last line of `bun run check:job`, after the last commit. Stages 05–07 add a run command.

## Coordinator steps and owner gates

- **C1** (from F121): the export at the D6 path of F121 before stage 05 starts. The sim run must use the production classifier setup (base: `openai`, `gpt-6-luna`, `classifier-v2`), else D4 refuses.
- **C2** At close: `bun run db:worktree f121_demo --drop` from the main checkout. A later take for G3 makes a new `*_demo` database first.
- **G2** owner: commit the export (under 5 MB) to `apps/web/e2e/demo/demo-seed.json`. Default: not committed.
- **G3** owner: watch and upload an upload candidate; the coordinator pins the hashes. Needs a final gate file (Q1). Default: no upload.

## Review

Opus review before the land: stages 01, 04, 05, 06. Others land on the proof.

## Stages

1. [Replay model](stages/stage-01-replay-model.md).
2. [Demo run plan](stages/stage-02-demo-run-plan.md).
3. [Cut timeline](stages/stage-03-cut-timeline.md).
4. [Demo command and env](stages/stage-04-demo-command-env.md) `[risky]`.
5. [Demo setup](stages/stage-05-demo-setup.md) `[risky]`.
6. [Demo recording](stages/stage-06-demo-recording.md) `[risky]`.
7. [Shots, docs and gates](stages/stage-07-shots-docs-gates.md).

## How to run (coordinator)

Start 01 and 03 at once. 02 after 01. 04 after 02. 05 after 04 and C1 (export and `*_demo` database). 06 after 03 and 05. 07 after 06. Spawn with the standing worker route (`spec/build.md`), `--prepare 'bash scripts/limen-prepare.sh'`, task "Implement F151 stage NN from its folder". Land with `limen land <id> --yes --keep-open`; the last land closes the ticket; then C2.

## Planning progress

- [written] ticket, plan, questions, scouts (4 started, 4 packets), stages 01–07; review 1 applied.
- Words (`wc -w`, after review 1): plan 1,494; stages 696, 699, 659, 600, 679, 697, 587.

## Cold review

`claude-opus-5-5`, high: the plan has `[risky]` stages (paid-model guard, public video). Review 1 ([plan-review-1.md](plan-review-1.md)): 1 blocking, 12 findings, 8 notes; all fixed, none rejected ([response](plan-review-1-response.md)). Stage 04 split into 04 and 05 (N3).
