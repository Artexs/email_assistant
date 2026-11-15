# F094 stage 02 — VPS deploy and record

Part of [`../plan.md`](../plan.md). Decisions D8, D12 and D6; edge cases in `plan.md` § Design decisions.

Gate: stage 1 is landed, the `master` CI run of the land is green, and the owner said go (`plan.md` § User checkpoints). No other VPS deploy runs at the same time (`docs/product/stage-2/05-execution-plan.md` §4).

Steps 1 and 2 are **owner steps**: only the owner runs them, on the home VPS. No agent connects to the VPS, reads its `.env` or runs these commands. Step 3 is a short worker job that records the owner's results.

## Before step 1 (coordinator)

1. Give the owner steps 1 and 2 with the list of `master` commits that the deploy brings: `git log --oneline <VPS commit>..origin/master` (the owner gives the VPS commit from `git rev-parse HEAD`).
2. **F069 (Compose network subnet pin)**: if its VPS step (`deploy/README.md` § "Move a running stack to the pinned subnet (once)", with a `.env` edit of `WEB_TRUSTED_PROXIES`) is not done yet, the owner does it first, in its own window, by its own runbook, and checks it. Then the F094 deploy follows, so a failure is not blamed on the wrong change. The same holds for any other ticket in the list that has its own VPS step: name it.
3. **Log text at the deploy commit** (D12): `git show origin/master:apps/server/src/modules/mail/jobs.ts | grep -n 'synced \${mailboxId}: folders'` must find the line. If a later ticket (for example the structured-logs ticket F089) changed the sync log text, change the greps of steps 1 and 2 to the new text before the handover, and say so to the owner.

## Step 1 — Owner: deploy the 1.4.4 image and check the pilot (owner step)

- **Goal:** the home VPS runs the server image on Bun 1.4.4, and the pilot mailbox keeps syncing.
- **Runbook** (bash, in the repo root on the VPS; `C="docker compose -f deploy/compose.yaml --env-file .env"`; based on `deploy/README.md` § Update):
  1. `git rev-parse HEAD` — write it down: the rollback commit.
  2. `$C exec server bun --version` — expect `1.3.14` (the old image). Write down:
     - the folder count of the pilot: `$C logs --since 1h server | grep -E "synced [0-9a-f-]+: folders" | tail -n 1` (the number after `folders`);
     - the time zone list: `$C exec server bun -e 'const z = Intl.supportedValuesOf("timeZone"); console.log(z.length, z.includes("Europe/Warsaw"))'`.
  3. `deploy/backup.sh` (or `PATH=$HOME/bin:$PATH deploy/backup.sh`) — the last line is `backup ok <name> <bytes>`.
  4. Keep the old image for a fast rollback: `docker tag ea-server ea-server:pre-f094`.
  5. **Disk** (D8): always run `docker builder prune -f`, then `df -h /`. **Stop if less than 5 GB is free.** The new base image forces a full rebuild (2–3 GB of build cache, `notes/2026-11-13-operations-facts.md`); on 2026-11-13 the root volume had 3.2 GB free, so expect to grow it first (owner, sudo, the command in `notes/2026-11-13-operations-facts.md` § VPS: `sudo lvextend -r -l +100%FREE /dev/ubuntu-vg/ubuntu-lv`), then check `df -h /` again.
  6. `git fetch && git merge --ff-only origin/master`, then `cat .bun-version` → `1.4.4` and `head -n 1 deploy/Dockerfile` → `FROM oven/bun:1.4.4`.
  7. `$C up -d --wait db`
  8. `$C run --build --rm server bun run db:migrate`
  9. `T=$(date -u +%Y-%m-%dT%H:%M:%SZ); echo "$T"` — write it down: the start time of the checks.
  10. `$C up -d --build --wait` — exit 0 means the healthcheck passed.
  11. `df -h /` — write down the free space.
  12. Wait 11 minutes (two `mail.sync` ticks, `*/5 * * * *`).
- **Checks** (`$T` from runbook 9; each with its expected result):
  1. `$C exec server bun --version` → `1.4.4`.
  2. `$C logs --since "$T" server | grep -c "listening on port 8080"` → 1 or more.
  3. `$C logs --since "$T" server | grep -E "synced [0-9a-f-]+: folders"` → 2 or more lines with the pilot mailbox id, and the folder count of runbook 2.
  4. `$C logs --since "$T" server | grep -E "sync [0-9a-f-]+ failed|the next tick tries again|auth_error|folder discovery failed|not on the server, skipped|mail\.sync failed"` → no line.
  5. `$C logs --since "$T" server | grep -iE "ERR_TLS|altname|servername|CERT_|certificate"` → no line.
  6. `$C logs --since "$T" server | grep -c "telegram: polling as"` → 1 or more (when Telegram is on in `.env`).
  7. `$C run --rm server bun run mailbox:check --org-id <pilot org uuid> --mailbox-id <pilot mailbox uuid>` (no `--probe`: it changes nothing) → exit 0 and a `capabilities:` line.
  8. `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health` → `200`.
  9. The time zone command of runbook 2 → the same two values as before.
- **Report** (to the coordinator; paste only these, never `.env` text or a password): the date and `$T` (UTC); the VPS commit before (runbook 1) and after (`git rev-parse --short HEAD`); the free space of runbook 5 and 11; the output of checks 1, 8 and 9 (and the values of runbook 2); the counts of checks 2, 3 and 6 and the folder count; "none" or the lines of checks 4 and 5; the `capabilities:` line of check 7.
- **Rollback** when runbook 10 fails, or check 1, 3, 7, 8 or 9 fails:
  1. `git checkout <commit of runbook 1>`
  2. `docker tag ea-server:pre-f094 ea-server`
  3. `$C up -d --no-build --wait` (the old image; no build, no disk use)
  4. Never run `db:rollback`. Return later with `git checkout master`.
  5. Report the failing check and its lines. The coordinator reverts the stage 1 land on `master` the same day (D8), so the pin and the VPS agree again.
- **Not a rollback by itself:** a line from check 4 or 5, or a missing line in check 2 or 6: report it at once; the coordinator decides with the owner (a line for another mailbox, or a line from a mail server outage, can be unrelated to the runtime).
- **Done when:** checks 1–9 hold and the report reached the coordinator.
- **Out of scope:** `.env` edits for F094 (an F069 `.env` edit belongs to its own step, "Before step 1" item 2), `SEND_SCOPE` or other scope changes, `mailbox:check --probe` (it sends mail; only on a test account), any send.

## Step 2 — Owner: the next-day check (owner step)

- **Goal:** the runtime change did not break the sync later (a leak, a stall). No alerting exists yet (E8b is not built), so this check is by hand.
- **When:** 24 hours or more after runbook 10 of step 1.
- **Checks:**
  1. `$C logs --since 24h server | grep -cE "synced <pilot mailbox id>: folders"` → 280 or more (288 ticks a day).
  2. The grep of step 1 check 4 with `--since 24h` → no line, or the lines are reported.
  3. `$C logs --since 24h server | grep -iE "ERR_TLS|altname|servername|CERT_"` → no line.
  4. `docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' | grep server` → below 300 MiB (the server used 136 MiB on 2026-11-13, `notes/2026-11-13-operations-facts.md`).
  5. `df -h /` → write down the free space.
- **Then:** when checks 1–4 hold, `docker image rm ea-server:pre-f094` (frees the old image). When one fails: report it; the coordinator decides with the owner whether to roll back (step 1 Rollback; the old image tag still exists).
- **Report:** the counts and lines of checks 1–5.
- **Done when:** checks 1–4 hold and the report reached the coordinator.

## Step 3 — Record the deploy (worker job)

- **Goal:** the note and the alert entry say that the VPS runs 1.4.4, with the date and the checks.
- **Input:** the owner's reports of steps 1 and 2, pasted by the coordinator into the spawn prompt (`plan.md` § How to run, item 8). If a value is missing, stop and ask in the final message; do not guess it.
- **Files:** `notes/2026-11-13-bun-version-drift.md`, `docs/known-alerts.md`, this ticket's `plan.md` (§ Log and the status line only).
- **Decisions:** D6.
- **Do:**
  1. Drift note, section `## Closed (F094)`: replace the list item `- VPS: pending (F094 stage 2).` (the whole line) with this list item:

     ```md
     - VPS: on 1.4.4 since <date> (commit <after>). Checked: <n> `synced` lines for the pilot in 11 minutes and <n> in 24 hours, no sync or TLS error line, `mailbox:check` exit 0, `/health` 200, server memory <n> MiB.
     ```

  2. `docs/known-alerts.md`, STARTTLS entry: in its `**Pin:**` line, replace "the image runs it after the VPS deploy of F094 stage 2" with "the VPS image runs it since <date>".
  3. `plan.md`: status line → `> **Status <date> — done.** Pin 1.4.4 in CI, image and VPS.`; add a Log line `- <date>: VPS on 1.4.4 (commit <after>); stage 2 checks of steps 1 and 2 passed.`
  4. `bunx prettier --write` on the two Markdown files and `plan.md`.

- **Test:**
  1. `grep -c "VPS: pending" notes/2026-11-13-bun-version-drift.md` → `0`.
  2. `grep -c "VPS: on 1.4.4 since" notes/2026-11-13-bun-version-drift.md` → `1`.
  3. `grep -c "the VPS image runs it since" docs/known-alerts.md` → `1`.
- **Check:** the stage 2 Proof of `plan.md` § Proof.
- **Done when:** Tests 1–3 hold and the Proof prints `PROOF_OK`.
- **Out of scope:** any file outside the three named; `spec/build.md`.

## Stage done when

- The owner's reports show that the checks of steps 1 and 2 passed.
- Step 3 is committed by explicit paths, and the stage 2 Proof of `plan.md` § Proof prints `PROOF_OK`, run after the last commit with nothing after it.
