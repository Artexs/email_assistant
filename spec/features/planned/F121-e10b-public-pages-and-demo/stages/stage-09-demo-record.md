# F121 stage 09 — Demo record command

Part of [`../plan.md`](../plan.md). Decisions P5, D6, D7, D8, decision 12 (epic). Needs stage 08 and coordinator step C1 (the seed file at the D6 path; the coordinator passes the path in the task). Extra proof link: `flock /tmp/email-assistant-shared-tests.lock bun run demo:record --seed "$DEMO_SEED" --out tmp/demo > /tmp/f121-s09/record.log 2>&1` before `echo PROOF_OK`.

Carry-over reads: notes §4.5 (script), `apps/web/e2e/env.ts`, `servers.ts`, `global-setup.ts`, `helpers.ts`, `docs/capabilities/live-lab.md` rule 24.7 (what an import makes), `docs/capabilities/tenancy-and-plans.md` (`org:flag`), `docs/capabilities/triage.md` (rules before AI: a VIP rule makes a mail urgent with LLM off), the stage 08 view.

## Step 1 — Spike: which steps run live (≤ 30 min, notes in the final message)

For each of the 8 steps (connect a mailbox; shadow days passed; the "what I would have done" report; "Turn on recommended"; an urgent mail arrives and the Telegram notice shows; an approval with an edit in the panel; a delegation and its chaser; Undo of an automatic move) write: live or from seed state, and how. Rules (D7): the panel, product CLIs (`org:flag`, `telegram:link`, `mailbox:connect`) and GreenMail delivery only; no SQL. Flags for the import org: the ones the steps need, set with `org:flag`. More than 2 steps not live → stop and ask.

## Step 2 — The script and captions

**Files.** New `apps/web/e2e/demo/steps.ts` (+ test), `apps/web/e2e/demo/record.spec.ts`, `apps/web/e2e/demo/demo.config.ts` (own Playwright config: `recordVideo` 1280×720, one worker), `apps/web/e2e/demo/record.ts` (the command), `package.json` script `demo:record`, `.gitignore` line for `tmp/demo/`.

**Decisions.**
- `DEMO_STEPS` holds the 8 steps in the decision-12 order; `seconds` sum 105–125; each `caption` 1–2 short lines in en and pl; a not-live step's caption names the day ("Day 3: …").
- The spec waits on visible states (role and text), never fixed sleeps longer than the step's pause for the viewer; each step marks its start time; the caption times in the VTT come from the marked times, not from the table.
- The Telegram part opens the stage 08 view in a second page of the same context, side by side via a composed page or by switching pages; the worker picks one and states it.
- The org name shown is the import name; no real name, address or host appears; the run checks the final page text with the public-content scan (`publicContentScan`) on each step's visible text and fails on a hit.

**Test.**
1. `toVtt(steps, "en")` for 2 steps (10 s, 15 s, start 0) = a WEBVTT file with cues `00:00:00.000 --> 00:00:10.000` and `00:00:10.000 --> 00:00:25.000`.
2. `DEMO_STEPS`: 8 ids, unique, sum of seconds in 105–125, every caption has en and pl.

## Step 3 — Encode

**Decisions.** `record.ts` runs the spec, then ffmpeg: trim the setup before step 1, H.264 (`-crf 28`, `yuv420p`, `+faststart`), no audio track, ≤ 15 MB; writes `demo.mp4`, `demo.en.vtt`, `demo.pl.vtt` to `--out`. Missing ffmpeg → exit 1 `ffmpeg_missing`. `--seed` missing or unreadable → exit 1 `seed_missing`. It imports the seed with `--replace` into the e2e DB.

**Test.**
3. Arg builder (pure function) for in/out paths gives the fixed ffmpeg argument list (assert the list).
4. The record run (proof link) ends with three files; `ffprobe` duration 100–130 s; file size ≤ 15 MB; both VTT parse (start with `WEBVTT`, 8 cues).

**Check.** `bun test apps/web/e2e/demo/steps.test.ts`, the record run under the lock.

**Done when.** Tests 1–4 pass; the final message gives the output paths, duration, size, and the spike table; Proof prints `PROOF_OK`.

**Out of scope.** Uploading the files (G3); the site (stage 10); voice.
