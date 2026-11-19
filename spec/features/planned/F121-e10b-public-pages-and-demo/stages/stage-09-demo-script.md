# F121 stage 09 — Demo script: spike, steps, captions, encoder arguments

Needs stage 08: `GET /_fake/view` (the spike shows the Telegram step through it). Reads the e2e seed at HEAD; does not wait for C1 (D10). May run next to 01–07.

Part of [`../plan.md`](../plan.md). Decisions P5, D7, D8, D10, decision 12 (epic). Review before the land (Polish captions). Stage 10 runs the recording; this stage builds the pure parts and decides the step list (review 1 N16: the old stage was too big).

Carry-over reads: notes §4.5 (script), `apps/web/e2e/env.ts`, `servers.ts`, `global-setup.ts`, `docs/capabilities/live-lab.md` rule 24.7 (what an import makes), `docs/capabilities/tenancy-and-plans.md` (`org:flag`), `docs/capabilities/triage.md` (rules before AI: a VIP sender rule makes a mail urgent with LLM triage off), the stage 08 view.

## Step 1 — Spike (≤ 30 min; result in the final message and in `apps/web/e2e/demo/README.md`)

For each of the 8 steps (connect a mailbox; shadow days passed; the "what I would have done" report; "Turn on recommended"; an urgent mail arrives and the Telegram notice shows; an approval with an edit in the panel; a delegation and its chaser; Undo of an automatic move) decide on the e2e seed (D10): live or from seed state, which e2e organization and user show it, and how. Rules (D7): panel, product CLIs (`org:flag`, `telegram:link`, `mailbox:connect`) and GreenMail delivery only; no SQL. Flags: those the steps need, by `org:flag` (Q2). More than 2 steps not live → stop and ask. The table has one column for the demo source, left `open`: the follow-up ticket fills it.

## Step 2 — Steps and captions

**Files.** New `apps/web/e2e/demo/steps.ts` and test.

**Decisions.**
- `DEMO_STEPS` (interfaces.md): 8 steps in the decision-12 order; `seconds` = the planned length, sum 105–125; `caption` 1–2 short lines in en and pl; a not-live step's caption names the day ("Day 3: …"); `live` from the spike.
- Captions hold no name, address or host; they pass `publicContentScan`.
- `toVtt(cues, lang)` (review 1 N8): `cues = { stepId; startMs; endMs }[]`, measured by the recording and already shifted by the trim offset (stage 10). The caption text comes from `DEMO_STEPS` by `stepId`. Cue order = input order; a cue with `endMs <= startMs`, a negative time or an unknown step id throws.

**Test.**
1. `toVtt([{stepId:"connect",startMs:0,endMs:10000},{stepId:"shadow",startMs:10000,endMs:25000}], "en")` = `WEBVTT`, blank line, cue `00:00:00.000 --> 00:00:10.000` with the en caption of `connect`, cue `00:00:10.000 --> 00:00:25.000`.
2. `toVtt` with `endMs = startMs` throws; unknown id throws.
3. `DEMO_STEPS`: 8 unique ids, sum of `seconds` 105–125, every caption has en and pl, `publicContentScan` finds nothing in the captions.

Mutation: drop the `endMs <= startMs` check → test 2 fails.

## Step 3 — Encoder arguments and the demo database guard

**Files.** New `apps/web/e2e/demo/encode.ts`, `apps/web/e2e/demo/db-guard.ts` and tests.

**Decisions.**
- `ffmpegArgs({ input, output, trimStartMs })`: a fixed list: `-ss` trim, H.264 (`libx264`, `-crf 28`, `-pix_fmt yuv420p`, `-movflags +faststart`), `-an` (no audio).
- The recording runs on its own database (review 1 N9: a live `mailbox:connect` makes a later `--replace` refuse). `DEMO_DATABASE_URL` must name a database whose name ends in `_demo`, and it must differ from `DATABASE_URL` and `E2E_DATABASE_URL`; else exit 1 `demo_db_refused`. Stage 10 drops and migrates it at each run.

**Test.**
4. `ffmpegArgs({input:"a.webm",output:"b.mp4",trimStartMs:2500})` equals the fixed list with `-ss 2.500`.
5. `demoDbProblem("postgres://h/ea_demo", other)` → null; `.../ea_dev` → `demo_db_refused`; the same URL as `E2E_DATABASE_URL` → `demo_db_refused`.

Mutation: remove the `_demo` suffix rule → test 5 fails.

**Check.** `bun test apps/web/e2e/demo`.

**Done when.** Tests 1–5 pass; the spike table is in the final message and the README; Proof prints `PROOF_OK`.

**Out of scope.** The Playwright spec and the real recording (stage 10); upload (G3).
