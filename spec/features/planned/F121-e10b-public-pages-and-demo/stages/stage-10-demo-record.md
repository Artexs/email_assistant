# F121 stage 10 — Demo record command

Needs stage 09: `DEMO_STEPS`, `toVtt`, `ffmpegArgs`, `demoDbProblem` and the spike table. Needs stage 07: `shotSource()`, `setupDemoOrg`. Needs coordinator step C3: the two `DEMO_*DATABASE_URL` keys in the main `.env`. Does not wait for C1 (D10). Playwright: lock rule until F136 lands (F136 should land first; if it is late, this stage runs under the lock).

Part of [`../plan.md`](../plan.md). Decisions P5, D5, D7, D8, D10. Extra proof link: `flock /tmp/email-assistant-shared-tests.lock bun run demo:record --out tmp/demo > /tmp/f121-s10/record.log 2>&1` before `echo PROOF_OK` (e2e source).

Carry-over reads: stage 09 files (`steps.ts`, `encode.ts`, `db-guard.ts`, the spike README), `apps/web/e2e/servers.ts`, `helpers.ts`, `docs/capabilities/live-lab.md` rule 24.6–24.8, the stage 07 sign-in path (`docs-shots/`).

## Step 1 — The spec

**Files.** New `apps/web/e2e/demo/record.spec.ts`, `apps/web/e2e/demo/demo.config.ts` (own Playwright config: `testMatch` `*.spec.ts`, `recordVideo` 1280×720, one worker, the e2e web and fake-Telegram servers with `DATABASE_URL` = the demo DB).

The demo DB comes from coordinator step C3: `DEMO_DATABASE_URL` and `DEMO_MIGRATOR_DATABASE_URL` in `.env` (never in task text). Add both keys, empty, to `.env.example`. A missing key exits 1 `demo_db_missing`.

**Decisions.**
- Setup: drop and migrate the demo DB (after `demoDbProblem` passed). Source `e2e`: run the e2e seed into it. Source `demo`: `setupDemoOrg` (stage 07). Then set the flags of the spike table and link Telegram to the fake. The run logs `demo_source e2e|demo` once.
- Steps follow `DEMO_STEPS` and the spike table. Each step records its start and end time (ms from the video start) for `toVtt`. The spec waits on visible states (role and text); a pause for the viewer is at most the step's `seconds`.
- The Telegram part opens the stage 08 view (`?chat=<id>&refresh=2`) in a second page of the same context; the worker states how both appear in one video (one composed page, or a page switch).
- Before each step ends, the visible text of the page goes through `publicContentScan`; a hit fails the run with the step id.
- The servers stop at the end, so the connected GreenMail mailbox stops polling.

## Step 2 — The command

**Files.** New `apps/web/e2e/demo/record.ts` with its argument parser in `apps/web/e2e/lib/demo/record-args.ts` (bun test); `package.json` script `demo:record`; `.gitignore` line for `tmp/demo/`.

**Decisions.**
- `bun run demo:record [--seed <file>] [--out <dir>]`: `--seed` sets `DEMO_SEED_FILE` for `shotSource()`; without it the D5 rule picks the source. Check ffmpeg (`ffmpeg_missing`), a named seed file that does not exist (`seed_missing`), the DB (`demo_db_refused`); run the spec; run ffmpeg with `ffmpegArgs` (trim = the start of step 1); write `demo.mp4`, `demo.en.vtt`, `demo.pl.vtt` with the cue times shifted by the trim; print duration, size and sha256 of `demo.mp4` (the owner pins it at G3, stage 11).
- Exit 1 when the MP4 is over 15 MB or outside 100–130 s.

**Test.**
1. `record.ts` argument parsing: `--seed /no/such.json` → `seed_missing`; a missing ffmpeg (PATH without it) → `ffmpeg_missing`; both exit 1 before any server starts. No `--seed` and no default file → source `e2e`.
2. The record run (proof link): three files; `ffprobe` duration 100–130 s; size ≤ 15 MB; both VTT start with `WEBVTT` and hold 8 cues; the printed sha256 equals `sha256sum tmp/demo/demo.mp4`.
3. A second record run right after the first also succeeds (the DB is rebuilt).
4. Integration (`apps/server/test/integration/`): the record setup with source `demo` calls `setupDemoOrg` (stage 07) on the demo DB; a seed made as in stage 07 test 2 → the owner signs in. The full demo-source recording is the follow-up ticket's.
5. On source `e2e` the command prints `demo_source e2e: not for upload` after the sha256 (D10, G3).

**Check.** `bun test apps/web/e2e/lib`, the integration test, two record runs under the lock.

**Done when.** Tests 1–5 pass; the final message gives the output paths, duration, size, sha256 and the steps that are not live; Proof prints `PROOF_OK`.

**Out of scope.** Uploading (G3); the site (stage 11); voice.
