# F151 plan — demo video and docs shots from the demo-week export

> **Status 2026-11-20 — stages 01–04 landed.** Plan base: `dc943d8dc`, refreshed 2026-11-20 ([plan-refresh-1.md](plan-refresh-1.md), review 2 applied). Eight stages. [scouts.md](scouts.md), [questions.md](questions.md).

## Input

Ticket notes (2026-11-19, 2026-11-20): F121 gates G2 (commit the seed) and G3 (upload, pin hashes) move here, default "prepare, do not publish"; make steps 2, 3, 5 live or say why not. F121 D7 stays: panel, product CLIs and GreenMail only, never raw SQL; captions name no organization.

### Product

- **P1** One organization on camera: the import "Kordelan demo (import)". Rejected: e2e organizations for some steps (two names).
- **P2** All eight steps live on the demo source. Step 2 shows shadow mode on mail that arrives during the recording, not "days passed" (Q3). A step that cannot be live is a question.
- **P3** The model: a loopback replay of the demo week's classifier answers (Q2). Rejected: the real model (spend, a key, a new video per take); invented answers.
- **P4** Global evidence on camera: the committed gate file of the replayed model and prompt, relabelled to the replay key; a provisional file makes the video "not for upload" (default, Q1). Rejected: the e2e fixture gate.
- **P5** The video cuts the waits between steps; steps keep their seconds. Rejected: faster sync.
- **P6** Docs shots need no code change: local through `DEMO_SEED_FILE`; CI and site after G2.

### Design

- **D1** Two mailboxes. A: the import, `paused`, gives history. B: `office@<domain of A>` on GreenMail, connected on camera in step 1; every live step runs on B.
- **D2** Replay key: lower-case sender, trimmed subject; it replays the row's category, confidence, reason, summary, `fields`. Ambiguous keys, rule or error rows: no entry. No hit: HTTP 500, one miss.
- **D3** Demo server env (stage 04): scope `synthetic`, the replay as an own endpoint on loopback, the gate copy, sync every 2 min; any other model route refuses (`demo_llm_not_loopback`).
- **D4** Seed checks before any server starts (stage 02): one model and prompt version, the production prompt, a gate file with a `go` category.
- **D5** Mail: IMAP APPEND into B's INBOX with the seed's sender, subject, text, Message-ID `<demo-<n>.<run tag>@ea-seed.test>`. History keeps the seed offsets, newest at now − 2 days (the first sync leaves it to the backfill); live mail gets the delivery time. Picks need confidence ≥ 0.7; the undo mail ≥ its gate threshold.
- **D6** Setup off camera, product paths only: import; flags `trust_ladder`, `approvals_page`, `delegation_pages`, `user_quiet_hours`; `auto` off on A (else `autonomy_paused` in the chat); owner Telegram link; no quiet hours; empty B; APPEND history. After the step-4 tap, `create_draft` on for B.
- **D7** Waits poll within `DEMO_WAIT_LIMITS_MS` (stage 04), else `demo_wait_timeout <what>`.
- **D8** Step 7 reminds the step-6 delegation after it is `sent`. `plan.overdueDelegation` (stage 02) stays null on every seed of this run, so no branch uses it (review 2, F6). Rejected: build and prove both (one has no seed).
- **D9** `DEMO_STEPS`: `live`, `caption` per source.
- **D10** Verdict (stage 08): `demo_source demo: upload candidate` only for exit 0, the demo source, seed day ≥ 5 (an ended day 5–7 export is final), a final gate, 0 misses, a passed model check (server `llm_settings` all `own` on loopback, a hit per delivered mail), no not-live step; else `not for upload: <first reason>`. A failed run is always `run_failed`.
- **D11** No migration, `bun.lock` change or package; CI never runs ffmpeg or the demo source.
- **D12** Trial seed (refresh 1; default, Q6). Stages 05–07 build and prove on an export of an ended run day 1 or later (C1a); proofs take the newest `demo-seed-day*.json`. The run prints `demo_seed_day <n> exported_at <iso>`; day < 5 gives `not for upload: trial_seed`. The export accepts a day not yet ended, so the guard is procedural: C1a and C1 export only an ended day; at G3 the owner compares `exported_at` with its end. Pick rules (D4, D5) never relax: a refusal is a finding; the coordinator continues on a later export. Rejected: a trial mode with smaller picks (it proves a run the final take never makes).
- **D13** Final only (C3): the day-5 runs of the stage 06 and 07 proofs, the G2 size line, the G3 verdict; stages 05–07 close on a trial seed. Alt texts and captions describe the day-5 seed; a trial-only difference goes into the note, not the text.
- **D14** Output order (review 2, B1): `demo_seed_day`, hashes and `not_live`, `demo_replay`, `demo_gate`, `demo_llm_checked`, then the verdict as the last log line of every run, also a failed one; it replaces `demo_source e2e: not for upload`. Rejected: the verdict before the stage-04 exits (an exit can follow a candidate line).

## Facts checked (base `e8f6f2b1`; refresh at `dc943d8dc`)

- `record.spec.ts` throws `demo_source_recording_not_built` for a non-e2e source.
- Gate files classifier-v2 and v3 are `provisional: true`; production prompt `classifier-v2`; `recommended` needs a final file (`trust.md` rules 1, 3).
- A first sync searches the last 24 h by internal date; the history check waits 5 min on `never_synced` (`sync.md` rule 6, `trust.md` rule 7).
- Notices wait through quiet hours 22:00–07:00 Warsaw. The export has no history check, Telegram link or user; import makes the mailbox `paused`, open actions `expired` (`live-lab.md` rule 24). `create_draft` is off by default.
- The C1 run starts 2026-11-23; day 1 ends 2026-11-23T23:00Z, day 5 2026-11-27T23:00Z (`notes/2026-11-15-vps-deploy-queue.md` § Demo run for F151). `exportDemo` takes day 1–7, cuts at 00:00 Warsaw after it, and does not refuse a day not yet ended. Import replaces. The lab switches A to assist on day 4 with `keepSwitches: false` and never sets `create_draft`, so `overdueDelegation` is null on every seed (D8).

## Not verified

- An export holds enough mail for D4/D5 (stage 05 run).
- A second mailbox fits the demo org's plan; GreenMail keeps an APPEND's internal date; `publicContentScan` passes on demo-week text.

## Rules for every stage

- Format only the stage's files. No `.env` read. No secret, real address or host anywhere.
- Never commit a seed, upload a video, pin a hash or run `docs-deploy` (G2, G3).
- `demo:record` runs under `flock /tmp/email-assistant-shared-tests.lock`; `docs:shots` follows `CLAUDE.md` at the time of the run.
- Logs hold counts and codes only, no mail data.
- Pure parts and tests: `apps/web/e2e/lib/` or the tool folder.
- A gap or deviation is a question, not a choice.

## Proof

The last line of `bun run check:job`; stages 05–08 add a run command. Done when: the ticket's Acceptance (6 items) and each stage's Done when.

## Coordinator steps and owner gates

- **C1a** (VPS, coordinator, from 2026-11-23T23:00Z): `$L demo-export --day <N>` of the newest ended run day (`deploy/README.md` § Sim stack step 12), copied to `~/.local/share/email-assistant/demo/demo-seed-day<N>.json` (0600); remove the VPS copy. Repeat for a later day after a refusal. The sim run uses the production classifier setup (`openai`, `gpt-6-luna`, `classifier-v2`), else D4 refuses; hold it until C3 (Q7).
- **C1** (after 2026-11-27T23:00Z): the same with `--day 5`.
- **C3** Final take (D13): a follow-up ticket ([draft](followup-final-take.md): stop-and-ask rules, new `*_demo` database, Q7). The coordinator opens it at the last F151 land, before C2.
- **C2** At close: `bun run db:worktree f121_demo --drop` from the main checkout. C3 and later takes make a new `*_demo` database first.
- **G2** owner: commit the export (under 5 MB) to `apps/web/e2e/demo/demo-seed.json`. Default: not committed.
- **G3** owner: watch and upload a candidate; the coordinator pins the hashes. Needs a final gate file (Q1). Default: no upload.

## Review

Opus review before the land: 01, 04, 05, 06, 08. Others land on the proof.

## Stages

1. [Replay model](stages/stage-01-replay-model.md). Landed (`0df5bec69`).
2. [Demo run plan](stages/stage-02-demo-run-plan.md). Landed (`d66055cd6`).
3. [Cut timeline](stages/stage-03-cut-timeline.md). Landed (`08ed7ce79`).
4. [Demo command and env](stages/stage-04-demo-command-env.md) `[risky]`. Landed (`1377e28f9`, review PASS).
5. [Demo setup](stages/stage-05-demo-setup.md) `[risky]`.
6. [Demo recording](stages/stage-06-demo-recording.md) `[risky]`.
7. [Shots, docs and gates](stages/stage-07-shots-docs-gates.md).
8. [Upload verdict and model check](stages/stage-08-upload-verdict.md) `[risky]`: no export; builds before 06 (numbered 08 so that files naming 05–07 stay true).

## How to run (coordinator)

01–04 landed. 08 now. 05 after C1a (a trial export is enough) and the `*_demo` database. 06 after 05 and 08. 07 after 06. C3 as the follow-up ticket. Standing worker route and prepare (`spec/build.md`), task "Implement F151 stage NN from its folder". Land with `limen land <id> --yes --keep-open`; the last land closes the ticket; then open the C3 ticket, then C2.

## Planning progress

- [written] ticket, plan, questions, scouts (4 of 4), stages 01–08; reviews 1 and 2 applied.
- Refresh 1 (2026-11-20): D12, D13, C1a, C3; stages 05–07; no scouts. Review 2 repair: D8, D10, D12–D14, C1a, C3, Q7; stage 08 new.
- Words (`wc -w`, review 2 repair): plan 1499; stages 01–08: 698, 696, 661, 602, 700, 646, 698, 675.

## Cold review

`claude-opus-5-5`, high: `[risky]` stages (paid-model guard, public video). Review 1: fixed ([response](plan-review-1-response.md)). Review 2 ([plan-review-2.md](plan-review-2.md), FAIL on refresh 1): B1, F2–F8 fixed ([plan-refresh-1.md](plan-refresh-1.md) § Review 2); F1 is coordinator text there. Re-review: the coordinator starts it.
