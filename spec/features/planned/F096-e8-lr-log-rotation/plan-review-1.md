PASS 64a6d1ae66f5948cf139f929e92856ca5da7b9dd

No finding blocks the plan. Its main command works on the CI Compose version (v2.38.2), so the riskiest pre-mortem failure (a red CI on `master` from `--profile '*'`) does not occur. Three major gaps remain: a new Compose file can skip the check, nobody owns the VPS proof after the ticket closes, and the next `up` restarts the shared dev stack. The plan should fix them before the build, but they do not block it.

HEAD = 64a6d1ae66f5948cf139f929e92856ca5da7b9dd. This matches the candidate. The tree was clean at start and end. I changed no repo file.

## Blocking
None.

## Unverified
- **Prettier on `deploy/README.md`.** `prettier --check` could not run: `prettier-plugin-astro` is missing in this worktree. Nothing was installed. So I could not check whether the hook rewrites lines outside the new step.
- **Recreate on the VPS (N2), `plan.md:54`.** No VPS access. Source only (F4).

## Major (plausible, with no rule that covers the event)
- **M1. The ticket outcome and the design disagree on "any Compose file".**
  - `ticket.md:9` says the check "fails when a service in **any** Compose file has no rotation".
  - The design checks a fixed default list: `plan.md:27` (D5), `stages/stage-01-compose-rotation.md:38`. The only guard for a new file is a comment (`plan.md:38`, stage `:43`).
  - Pre-mortem: E2b adds `deploy/compose.sim.yaml` (named at `plan.md:38`). CI stays green and the new containers have no rotation.
  - Fix: CI also asserts that `ls deploy/compose*.y*ml` equals the script's list, or the script finds the files itself.
- **M2. Nobody owns Done-when 6 and N2 after the land.**
  - The land closes the ticket (`plan.md:106`). Item 6 "does not keep the ticket open" (`plan.md:64`). The only reminder is `plan.md:108`, inside a done ticket.
  - The likely next VPS deploy is F094 stage 2. It uses its own copied runbook ("based on `deploy/README.md` § Update", `spec/features/active/F094-*/stages/stage-02-vps-deploy.md:18`), which lacks the new step 4.
  - Its rule "any other ticket … that has its own VPS step: name it" (same file `:11`) does not catch F096: P2 says F096 has no own VPS step (`plan.md:19`). So the one real-host proof is likely skipped.
  - Fix: add a board line in `spec/build.md`, or a note to the F094 stage 2 handover.
- **M3. The shared dev stack is missed.** `plan.md:39` says "not relevant: no DB, no job, no state". But CLAUDE.md "Shared runtime: one dev DB, GreenMail" is shared state.
  - After the land, the next `bun run db:up` or `dev:up` (`package.json` scripts) recreates the shared `db` and `greenmail` (F4 config hash). This restarts them under parallel jobs' `test:int` runs.
  - If nobody runs `up`, the dev containers stay without rotation forever.
  - `plan.md:70` correctly forbids the worker to run `up`, but no rule says who recreates the dev stack, and when.

## Minor
- **m1 (proven, temp-copy probe on Compose 5.6.1 and on a downloaded v2.38.2).** Two claims in F3 (`plan.md:46`) do not reproduce.
  - "Without `--no-env-resolution` the command fails on the missing `../.env`": it gave rc=0 with no `.env` on both versions.
  - "Without `--profile '*'` that service is missing": a `profiles: [ops]` service is listed without the flag on both versions.
  - Effect: stage test 4 (`stage:51`) does not prove that the script uses `--profile '*'`. Test 5 (`stage:52`) does not prove the two `--no-*` flags. Only "1 output line" in test 5 tells a good script from a bad one.
- **m2 (plausible).** Step 3 test 3, `git diff --stat master` (`stage:79`), compares against the moving `master` tip. Parallel lands are allowed (`spec/build.md:64`), so the diff can show other tickets' files, and the worker must guess. Use `git diff --stat master...HEAD`.
- **m3 (proven).** Test 4 "a profile service appended under `services:`" (`stage:51`) is ambiguous.
  - If the worker appends at the end of `compose.yaml`, the service lands under `volumes:`. Compose then fails: `volumes.probe additional properties 'image', 'profiles' not allowed`. That is not the expected `probe` line.
  - Name the insertion point: before `networks:` (`deploy/compose.yaml:49`).
- **m4 (plausible).** "With arguments … relative to the caller's folder" (`stage:38`) is not tested.
  - All argument tests use absolute `/tmp` paths (`stage:47`).
  - "Shell style as `deploy/backup.sh`" (`stage:46`) invites `cd "$(dirname "$0")/.."` (`deploy/backup.sh:6`). That breaks relative arguments without a sign.
  - Add a relative-path case.
- **m5 (proven by reading).** `ticket.md:26` says "each broken copy of `plan.md` § Done when". The broken copies are defined in stage tests 2–4 (`stage:49-51`), not in § Done when. Point to the stage.

## Notes
- **n1.** P2 says "an own deploy restarts the DB for 10 lines of YAML" (`plan.md:19`). But the next normal deploy also recreates `db` at `$C up -d --wait db` (`deploy/README.md:50`, F4), while the old `server` still runs. The runbook step (D8, `stage:70-73`) does not warn the operator. The outcome is the same; only the reasoning is off.
- **n2.** N1 is checked only after the push to `master` (`plan.md:53`, `:107`). F094 uses a CI run on a `task/**` branch before the land (`F094 stage-01:39`). My v2.38.2 probe already covers most of N1's risk. The runner image can move off 2.38.2 before the land.
- **n3.** Stage size: about 80 lines in 3 steps. One Sonnet job can do it. The secret handling (D6) holds: with `--no-interpolate` the JSON keeps `${APP_PASSWORD:?}` as literal text, and the script never prints the JSON.

## Checks I ran
- `test -z "$(git status --porcelain)" && test "$(git rev-parse HEAD)" = 64a6d1ae66f5948cf139f929e92856ca5da7b9dd && echo CLEAN_AND_MATCH` → `CLEAN_AND_MATCH`.
- **Temp copy, Compose 5.6.1, block added as in Step 1, no `.env`, `POSTGRES_PASSWORD` unset:**
  - The plan's `config … --format json | jq` gave rc=0 and no bad services. Keys: `db greenmail server`.
  - Each `logging` value is `{"driver":"json-file","options":{"max-file":"5","max-size":"10m"}}`.
  - A missing file gives `compose file "…" is invalid: open …: no such file or directory`, rc=1.
- **Same copy, Compose v2.38.2** (official release binary from GitHub, run from a temp folder; the CI runner version per F5):
  - The same commands are accepted, including `--profile '*'`.
  - With the block: no bad services. Test 3 → `db server`. Test 4 → `probe`.
  - The repo files at HEAD, with no block → `db greenmail server`. So the check fails before Step 1.
- `prettier --check deploy/README.md` → could not run (plugin missing). Unverified.
- Temp folders `/tmp/f096rev.*` and `/tmp/f096dl.*` are deleted.

## Note check
- HEAD is the candidate 64a6d1ae: proven. `test -z "$(git status --porcelain)" && test "$(git rev-parse HEAD)" = 64a6d1ae66f5948cf139f929e92856ca5da7b9dd && echo CLEAN_AND_MATCH`
- Each finding quotes file:line and has a label and a severity: not proven. The evidence is this message only. No saved file or command shows it.
- Plan claims about the code checked against the files: not proven. The probes ran in bash calls joined with `;` and pipes, and they saved no log. The results are listed above.
- First line `PASS <sha>` and a final verdict line with counts: not proven. The evidence is this message only. No file or command shows it.
- Easy-to-miss rule "Read-only: change no file": followed. `test -z "$(git status --porcelain)" && test "$(git rev-parse HEAD)" = 64a6d1ae66f5948cf139f929e92856ca5da7b9dd && echo CLEAN_AND_MATCH`

Verdict: PASS. Findings: blocking 0, major 3, minor 5, notes 3.
