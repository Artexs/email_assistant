# F094 stage 02 — VPS deploy and record

Part of [`../plan.md`](../plan.md). Decisions D8 and D6; edge cases in `plan.md` § Design decisions.

Gate: stage 1 is landed, the `master` CI run of the land is green, and the owner said go (`plan.md` § User checkpoints). No other VPS deploy runs at the same time (`docs/product/stage-2/05-execution-plan.md` §4).

Step 1 is an **owner step**: only the owner runs it, on the home VPS. No agent connects to the VPS, reads its `.env` or runs these commands. Step 2 is a short worker job that records the owner's results.

## Step 1 — Owner: deploy the 1.4.4 image and check the pilot (owner step)

- **Goal:** the home VPS runs the server image on Bun 1.4.4, and the pilot mailbox keeps syncing.
- **Before (coordinator):** give the owner this step and the list of `master` commits that the deploy brings (`git log --oneline <VPS commit>..origin/master`; the owner gives the VPS commit from `git rev-parse HEAD`). If the list holds another ticket's VPS step (for example a Compose network move or a first deploy with its own runbook section), name it; the owner does that step by its own runbook in the same window, or first.
- **Runbook** (bash, in the repo root on the VPS; `C="docker compose -f deploy/compose.yaml --env-file .env"`, `deploy/README.md` § Update):
  1. `git rev-parse HEAD` — write it down: the rollback point.
  2. `$C exec server bun --version` — expect `1.3.14` (the old image).
  3. `deploy/backup.sh` (or `PATH=$HOME/bin:$PATH deploy/backup.sh`) — the last line is `backup ok <name> <bytes>`.
  4. `df -h /` — stop if less than 3 GB is free; run `docker builder prune -f` and check again.
  5. `git fetch && git merge --ff-only origin/master`, then `cat .bun-version` → `1.4.4` and `head -n 1 deploy/Dockerfile` → `FROM oven/bun:1.4.4`.
  6. `$C up -d --wait db`
  7. `$C run --build --rm server bun run db:migrate`
  8. `$C up -d --build --wait` — exit 0 means the healthcheck passed.
  9. Wait 11 minutes (two `mail.sync` ticks, `*/5 * * * *`).
- **Checks** (each with its expected result):
  1. `$C exec server bun --version` → `1.4.4`.
  2. `$C logs --since 12m server | grep -c "listening on port 8080"` → 1 or more.
  3. `$C logs --since 12m server | grep -E "synced [0-9a-f-]+: folders"` → 2 or more lines with the pilot mailbox id.
  4. `$C logs --since 12m server | grep -E "sync [0-9a-f-]+ failed|the next tick tries again|auth_error"` → no line.
  5. `$C logs --since 12m server | grep -iE "ERR_TLS|altname|servername|CERT_|certificate"` → no line.
  6. `$C logs --since 12m server | grep -c "telegram: polling as"` → 1 or more (when Telegram is on in `.env`).
  7. `$C run --rm server bun run mailbox:check --org-id <pilot org uuid> --mailbox-id <pilot mailbox uuid>` (no `--probe`: it changes nothing) → exit 0 and a `capabilities:` line.
  8. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health` → `200`.
- **Report** (to the coordinator; paste only these, never `.env` text or a password): the date (UTC); the VPS commit before (runbook 1) and after (`git rev-parse --short HEAD`); the output of checks 1 and 8; the counts of checks 2, 3 and 6; "none" or the lines of checks 4 and 5; the `capabilities:` line of check 7.
- **Rollback** when check 1, 3, 7 or 8 fails, or when `up --wait` in runbook 8 fails: `git checkout <commit of runbook 1>`, then `$C up -d --build --wait`. Never run `db:rollback`. Return later with `git checkout master`. Report the failing check and its lines; the coordinator reopens stage 1 with them. A line from check 4 or 5, or a missing line in check 2 or 6, is not a rollback by itself: report it at once, and the coordinator decides with the owner (a line for another mailbox, or a line from before the restart, can be unrelated to the runtime).
- **Done when:** checks 1–8 hold and the report reached the coordinator.
- **Out of scope:** `.env` edits, `SEND_SCOPE` or other scope changes, `mailbox:check --probe` (it sends mail; only on a test account), any send.

## Step 2 — Record the deploy (worker job)

- **Goal:** the note and the alert entry say that the VPS runs 1.4.4, with the date and the checks.
- **Input:** the owner's report, pasted by the coordinator into the spawn prompt (`plan.md` § How to run, item 7). If a value of the report is missing, stop and ask in the final message; do not guess it.
- **Files:** `notes/2026-11-13-bun-version-drift.md`, `docs/known-alerts.md`, this ticket's `plan.md` (§ Log and the status line only).
- **Decisions:** D6.
- **Do:**
  1. Drift note, section `## Closed (F094)`: replace the list item `- VPS: pending (F094 stage 2). …` (the whole line) with this list item:

     ```md
     - VPS: on 1.4.4 since <date> (commit <after>). Checked: <n> `synced` lines for the pilot in 11 minutes, no sync or TLS error line, `mailbox:check` exit 0, `/health` 200.
     ```

  2. `docs/known-alerts.md`, STARTTLS entry: in its `**Pin:**` line, replace "the image runs it after the VPS deploy of F094 stage 2" with "the VPS image runs it since <date>".
  3. `plan.md`: status line → `> **Status <date> — done.** Pin 1.4.4 in CI, image and VPS.`; add a Log line `- <date>: VPS on 1.4.4 (commit <after>); checks 1–8 of stage 2 passed.`
  4. `bunx prettier --write` on the two Markdown files and `plan.md`.

- **Test:**
  1. `grep -c "VPS: pending" notes/2026-11-13-bun-version-drift.md` → `0`.
  2. `grep -c "VPS: on 1.4.4 since" notes/2026-11-13-bun-version-drift.md` → `1`.
  3. `grep -c "the VPS image runs it since" docs/known-alerts.md` → `1`.
- **Check:** the stage 2 Proof of `plan.md` § Proof.
- **Done when:** Tests 1–3 hold and the Proof prints `PROOF_OK`.
- **Out of scope:** any file outside the three named; `spec/build.md`.

## Stage done when

- The owner's report shows checks 1–8 passed (step 1).
- Step 2 is committed by explicit paths, and the stage 2 Proof of `plan.md` § Proof prints `PROOF_OK`, run after the last commit with nothing after it.
