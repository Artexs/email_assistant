# F121 stage 10 — Demo record command

Part of [`../plan.md`](../plan.md). Decisions P5, D6, D7, D8. Needs stage 09 and C1 (the coordinator passes the seed path and a `*_demo` database URL in the task). Extra proof link: `flock /tmp/email-assistant-shared-tests.lock bun run demo:record --seed "$DEMO_SEED" --out tmp/demo > /tmp/f121-s10/record.log 2>&1` before `echo PROOF_OK`.

Carry-over reads: stage 09 files (`steps.ts`, `encode.ts`, `db-guard.ts`, the spike README), `apps/web/e2e/servers.ts`, `helpers.ts`, `docs/capabilities/live-lab.md` rule 24.6–24.8, the stage 07 sign-in path (`docs-shots/`).

## Step 1 — The spec

**Files.** New `apps/web/e2e/demo/record.spec.ts`, `apps/web/e2e/demo/demo.config.ts` (own Playwright config: `recordVideo` 1280×720, one worker, the e2e web and fake-Telegram servers with `DATABASE_URL` = the demo DB).

**Decisions.**
- Setup: drop and migrate the demo DB (after `demoDbProblem` passed), import the seed (`importDemo`), give the owner a password and accept terms by the stage 07 path, set the flags of the spike table, link Telegram to the fake.
- Steps follow `DEMO_STEPS` and the spike table. Each step records its start and end time (ms from the video start) for `toVtt`. The spec waits on visible states (role and text); a pause for the viewer is at most the step's `seconds`.
- The Telegram part opens the stage 08 view (`?chat=<id>&refresh=2`) in a second page of the same context; the worker states how both appear in one video (one composed page, or a page switch).
- Before each step ends, the visible text of the page goes through `publicContentScan`; a hit fails the run with the step id.
- The servers stop at the end, so the connected GreenMail mailbox stops polling.

## Step 2 — The command

**Files.** New `apps/web/e2e/demo/record.ts`; `package.json` script `demo:record`; `.gitignore` line for `tmp/demo/`.

**Decisions.**
- `bun run demo:record --seed <file> [--out <dir>]`: check ffmpeg (`ffmpeg_missing`), the seed (`seed_missing`), the DB (`demo_db_refused`); run the spec; run ffmpeg with `ffmpegArgs` (trim = the start of step 1); write `demo.mp4`, `demo.en.vtt`, `demo.pl.vtt` with the cue times shifted by the trim; print duration, size and sha256 of `demo.mp4` (the owner pins it at G3, stage 11).
- Exit 1 when the MP4 is over 15 MB or outside 100–130 s.

**Test.**
1. `record.ts` argument parsing: no `--seed` → `seed_missing`; a missing ffmpeg (PATH without it) → `ffmpeg_missing`; both exit 1 before any server starts.
2. The record run (proof link): three files; `ffprobe` duration 100–130 s; size ≤ 15 MB; both VTT start with `WEBVTT` and hold 8 cues; the printed sha256 equals `sha256sum tmp/demo/demo.mp4`.
3. A second record run right after the first also succeeds (the DB is rebuilt).

**Check.** `bun test apps/web/e2e/demo`, two record runs under the lock.

**Done when.** Tests 1–3 pass; the final message gives the output paths, duration, size, sha256 and the steps that are not live; Proof prints `PROOF_OK`.

**Out of scope.** Uploading (G3); the site (stage 11); voice.
