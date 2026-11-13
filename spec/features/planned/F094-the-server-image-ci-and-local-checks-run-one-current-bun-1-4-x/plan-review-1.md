FAIL 36396c0e0eeabd45187a619ff5965f39c0e0f33f

Stage 1 (the pin, the STARTTLS test, the docs) is sound and can be built as written. Stage 2 (the VPS deploy) has three major gaps, so the plan needs one revision before the coordinator starts. HEAD is 36396c0e. It matches the candidate.

## Major

**M1. On a disk that is nearly full, the VPS deploy can fill the disk. The disk also holds the Postgres volume.** (Proven from repo facts. The disk effect itself is plausible.)

- When `FROM` changes, Docker must rebuild every layer of the image.
- `notes/2026-11-13-operations-facts.md:25` gives 3.2 GB free on the root volume. Line 29 says that a cold build needs 2–3 GB of build cache.
- `stages/stage-02-vps-deploy.md:17` and `plan.md` F12 copy the general rule "stop if less than 3 GB is free" from `deploy/README.md:45`. The prune runs only below 3 GB. At 3.2 GB free, the owner builds without a prune, and the `oven/bun:1.4.4` base image is a new download.
- If the disk fills, Postgres writes fail and sync stops.
- Fix:
  - Always run `docker builder prune -f` before the build.
  - Raise the stop line (for example 5 GB), or require the PD-055 volume growth first.
  - Add a `df -h /` check after runbook step 8.
  - Say that a rollback also starts a cold build, because the prune removed the 1.3.14 layers.

**M2. After an 11-minute window, nothing watches the pilot sync.** (Gap.)

- `stage-02-vps-deploy.md:22-28` checks 2 sync ticks. Stage 2 step 2 then closes the ticket (`plan.md` § How to run item 8).
- No alerting exists yet: E8b is still planned (`05-execution-plan.md:53`).
- A delayed failure from the runtime change would reach the user unseen, for example a socket or memory leak, or a scheduler stall.
- Fix: add a next-day check before step 2 lands. For example:
  - `$C logs --since 24h server | grep -c "synced <pilot id>: folders"` is about 288.
  - `docker stats --no-stream` shows the server's memory.

**M3. After a rollback, no rule stops the 1.4.4 pin from coming back.** (Gap.)

- `stage-02-vps-deploy.md:33` rolls the VPS back to 1.3.14 and says "the coordinator reopens stage 1". But stage 1 has already landed. `master` keeps `.bun-version` 1.4.4, so CI and every job run 1.4.4 while the VPS runs 1.3.14. That is the drift again, in reverse.
- The next VPS deploy of any other ticket brings 1.4.4 back with the same failure. No rule warns about it.
- Fix: after a rollback, `git revert` the pin commit on `master` the same day, or block VPS deploys of other tickets until F094 is fixed. Write the choice down.

## Minor

1. **Other commits ride along with the deploy.** (`stage-02-vps-deploy.md:12`, `plan.md` D8.)
   - F069 is in `active/`. Its subnet pin (c19abfb, `deploy/compose.yaml`) is on `master`, and its VPS step is pending (`F069…/plan.md:14,21`). It needs a `.env` edit (`WEB_TRUSTED_PROXIES`).
   - This conflicts with "Out of scope: `.env` edits" (`stage-02…:35`) and "No `.env` line" (`plan.md` § User steps).
   - Fix: name F069 by number, and deploy it first, in a separate window. Then the F094 checks test only the runtime, and a failure is not wrongly blamed on Bun.
   - That Compose refuses or rebuilds the changed network is plausible, not checked.
2. **The error grep misses some failure lines.** Check 4 (`stage-02…:27`) does not match these lines:
   - `sync <id>: folder discovery failed:` (`mail/sync.ts:526`)
   - `… not on the server, skipped` (`:545`)
   - `… returned below cursor` (`:362`)
   - the scheduler line `mail.sync failed:` (`platform/scheduler.ts`)

   After a discovery failure, the job still writes `synced <id>: folders N`, so check 3 passes. Fix: compare `folders N` before and after the deploy, and widen the grep.

3. **The time window of checks 2–3 can miss lines.** They use `--since 12m` after an 11-minute wait (`stage-02…:22,25-26`). If the owner starts the checks more than about 1 minute late, `listening on port 8080` is no longer in the window. Fix: use `--since <UTC time of runbook step 8>`.
4. **The name check of the real product path has no committed test.** A DNS host connects to the resolved IP with `servername` = the host name. Only the planner's uncommitted probe F6 (`plan.md` F6) covers this path. The new D4 test covers only STARTTLS to an IP host with no `servername`. `imap-tls.test.ts` checks trust, not the name. Fix (hardening): a "wrong servername is refused" test for nodemailer and imapflow with implicit TLS.
5. **The time-zone list is not covered.** (Plausible, not checked on the image.)
   - `notes/2026-11-03-bun-timezones.md:4-5` and `notes/2026-11-11-web-settings-rules-facts.md:52-54` say the lists differ by Bun version. `tenancy/service.ts:34` validates against that list.
   - F10 does not name this risk, and no stage checks it.
   - My local probe: `bun` 1.4.4 and `bunx bun@1.3.14` give the same 445 names (`Europe/Kyiv` yes, `Europe/Kiev` no). The image's list is still unknown.
   - Fix: compare `Intl.supportedValuesOf("timeZone")` in the container before and after the deploy.
6. **Wrong fact in the ticket.** `ticket.md:44` says F086 is "in `done/`". At 36396c0, F086 is in `spec/features/active/`. `plan.md` § How to run item 1 handles this correctly with "When F086 is in done/".
7. **Two rules conflict.**
   - `plan.md` § Rules says "run only the changed test file on the pin".
   - Stage 1 step 2 Test 5 runs `bunx bun@1.3.14`.
   - Stage 1 step 3 Check runs `ci-bun.sh test apps/server/src/modules/testmail` (a folder).
   - Fix: list both as exceptions to the rule.
8. **D6 and stage 1 disagree.** D6 (`plan.md`) puts both "Rule" and "Open" under `## History (pin 1.3.14)`. Stage 1 step 3 Do 2 (`stage-01…:103`) renames only `## Rule` and keeps `## Open` with marks. The worker follows the stage, so the two must agree.
9. **The image-check step makes the worker guess.** `stage-01…:22-30`:
   - It does not show how to put the `newgrp docker` heredoc into the background `nohup bash -c '…'` form.
   - "optional but asked" is ambiguous.
   - Fix: give one exact command.
10. **Prettier reformats a whole note.** `notes/2026-11-03-imapflow-tls-under-bun.md` already fails `prettier --check` (I ran it). Stage 1 step 3 Do 6 runs `--write` on it, so the change is bigger than "append one line". This is harmless, but the reviewer must expect it.
11. **The alert text keeps an outdated phrase.** In `docs/known-alerts.md:338`, "fails the name check on the image Bun" becomes wrong after F094. Stage 1 step 3 Do 3 adds a sentence but keeps the phrase. `notes/2026-11-13-bun-version-drift.md:20` has the same problem.
12. **A small line-number error.** `stage-01…:20` cites `ci.yml:121-123`. The check is at lines 122–123.

## Questions

- **Q-a.** `ticket.md:9` says ".bun-version is the only place that holds the version". But `deploy/Dockerfile` line 1 also holds it, and `plan.md` Done-when 1 says "no other file sets a Bun version". Accept the two places with the `image` job check, or use an `ARG` that reads `.bun-version`? Reword the ticket either way.
- **Q-b.** The stage 2 greps depend on the log text at the deploy commit. F089 (structured logs, after F086) can change that text before the owner deploys. The coordinator must check `mail/jobs.ts:42-44` at the deploy commit before it hands over step 1.
- **Q-c.** The push to `task/f094-bun-pin` (D7) goes to GitHub. The plan takes default (a) for Q1 without an owner OK.

## Pre-mortem: which stage let each failure through

- **The pilot mailbox stopped syncing:** stage 2, through the 11-minute window only (M2), the disk margin (M1) and the narrow grep (minor 2).
- **A TLS check got weaker:** stage 1 has a good guard for STARTTLS to an IP host. The real DNS-host path has no committed guard (minor 4).
- **CI on `master` went red:** D7 covers it (CI on a `task/` branch before the land, then the next `master` run). There is a residual window: CI tests the job branch, not the merge result. Done-when 5 catches that after the land.
- **The VPS deploy broke:** stage 2. The causes are M1, the F069 commits that ride along (minor 1), and the pin coming back after a rollback (M3).

The stages are not too big. Stage 1 is three steps on about 8 files plus one Proof, which suits one Sonnet job.

## Checks run

- `git rev-parse HEAD` printed 36396c0e0eeabd45187a619ff5965f39c0e0f33f. `git status --short` was empty at the end.
- `bun install --frozen-lockfile`: exit 0, 967 packages.
- `bunx prettier --check` on the five files of stage 1 step 3 plus `plan.md`: only `notes/2026-11-03-imapflow-tls-under-bun.md` was flagged.
- D4 probe: a temporary copy of `smtp-starttls.test.ts` with the D3/D4 edits applied, deleted after the run.
  - On 1.4.4: `10 pass, 0 fail`.
  - On `bunx bun@1.3.14`: `7 pass, 3 fail`. The 3 failures are the two upgrade tests and the new test. This matches F3, F4 and stage 1 step 2 Test 5.
- Time-zone probe (minor 5): both versions gave identical lists on this PC.
- Read and grep checks that confirmed the plan's facts: F2, F5 (`client.ts:77-95`), F11 (`ci.yml:3-9`), F12 (`jobs.ts:42-44`, `main.ts:82,246`, `polling.ts:67`, `check.ts:68-77`, `deploy/README.md:45,62,226-237`), and F13. F13 is complete except for dated notes.
- Not checked: F10 (the Bun 1.4 blog, an external source) and F8 (the image build). I did not use docker.
