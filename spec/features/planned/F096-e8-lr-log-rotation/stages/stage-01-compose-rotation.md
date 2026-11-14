# F096 stage 01 — Compose log rotation, check script, CI step, runbook

Part of [`../plan.md`](../plan.md). Not `[risky]`. Decisions P1, D1–D10. About 80 changed lines.

Read first: `deploy/compose.yaml`, `deploy/compose.dev.yaml`, `deploy/backup.sh` (shell style), `.github/workflows/ci.yml` (job `image`), `deploy/README.md` § Update and § Logs.

The one rotation value, used everywhere in this stage:

```yaml
logging:
  driver: json-file
  options:
    max-size: 10m
    max-file: "5"
```

## Step 1 — Rotation for every Compose service

- **Goal:** each service of the two Compose files has the rotation value above.
- **Files:** `deploy/compose.yaml`, `deploy/compose.dev.yaml`.
- **Interfaces:** none.
- **Decisions:** P1, D2, D3, D4, D9.
  - `deploy/compose.yaml`: after `name: email-assistant`, add a top-level extension field with a one-line comment above it: `# Docker log rotation for every service: 5 files of 10 MB per container (deploy/README.md § Logs). deploy/check-logging.sh checks it.` The field is `x-logging: &logging` with the map `driver: json-file` and `options:` `max-size: 10m`, `max-file: "5"`. In `db` and `server`, add `logging: *logging` (a plain alias; no `<<:` merge key). Place it after `image:` in each service.
  - `deploy/compose.dev.yaml`: in `greenmail`, after `image:`, write the full block of the top of this file (an anchor does not cross files). Do not add `logging` to the `db` override: the base file gives it.
  - `max-file` is the quoted string `"5"`. Do not add `compress` or any other option.
  - Change nothing else in the files: no reorder, no reformat, keep all comments.
- **Test:** Step 2 tests 1–4.
- **Check:** `bash deploy/check-logging.sh` (after Step 2).
- **Done when:** Step 2 test 1 passes on the repo files.
- **Out of scope:** `/etc/docker/daemon.json`, other services, any `up`, `run` or `down` of a stack.

## Step 2 — The check script

- **Goal:** one command proves that every service of every Compose file rotates its log, and names the services that do not.
- **Files:** new `deploy/check-logging.sh` (mode 755: `chmod +x`, and `git add` keeps the mode).
- **Interfaces:**
  - Call: `bash deploy/check-logging.sh [compose file …]`. Works from any working folder.
  - No arguments: it checks `<repo>/deploy/compose.yaml` and `<repo>/deploy/compose.dev.yaml` together (merged, in this order). `<repo>` is the parent of the script's folder: `root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`. With arguments: it checks exactly these files, in the given order, as given (relative to the caller's folder).
  - Command inside: `docker compose -f <file1> -f <file2> … --profile '*' config --no-env-resolution --no-interpolate --format json`, piped to `jq`. Keep the JSON in a pipe or a shell variable; never write it to stdout, stderr or a file.
  - Success: exit 0, stdout one line `logging ok: <service names, sorted, space-separated>`. For the repo files: `logging ok: db greenmail server`.
  - Failure: exit 1, stderr one line `logging missing or different: <service names, sorted, space-separated>`. Only the bad services.
  - `docker compose config` fails (a bad file, a missing file): the script exits non-zero (`set -euo pipefail`, also for the pipe), and prints `check-logging: docker compose config failed` to stderr after the Compose error.
  - A comment block at the top (3–5 lines): what it checks; that a new Compose file must be added to the default list; that it never prints the config because the config can hold secrets (D6); that CI runs it (`image` job).
- **Decisions:** D5, D6.
  - The jq filter compares each service's `.logging` with the exact value `{"driver":"json-file","options":{"max-size":"10m","max-file":"5"}}`. A sketch that works on jq 1.7: `jq -r --argjson want '<value>' '.services | to_entries | map(select(.value.logging != $want) | .key) | sort | join(" ")'` for the bad list, and `.services | keys | join(" ")` for the ok line. One `docker compose config` run, the JSON read twice from a variable, is fine.
  - Shell style as `deploy/backup.sh`: `#!/usr/bin/env bash`, `set -euo pipefail`, quoted variables.
- **Test** (save the commands and their output in `/tmp/f096-s01/cases.log`; `d=/tmp/f096-s01/neg`; each broken copy starts fresh: `rm -rf "$d" && mkdir -p "$d/deploy" && cp deploy/compose.yaml deploy/compose.dev.yaml "$d/deploy/"`; call the script with `"$d/deploy/compose.yaml" "$d/deploy/compose.dev.yaml"`):
  1. Repo files: `bash deploy/check-logging.sh; echo "exit=$?"` → stdout `logging ok: db greenmail server`, `exit=0`. The same from another folder: `(cd /tmp && bash "$OLDPWD/deploy/check-logging.sh")` → the same line, exit 0.
  2. Copy, the `logging:` block of `greenmail` removed from the copied `compose.dev.yaml` → exit 1, stderr `logging missing or different: greenmail`.
  3. Copy, `max-file: "5"` changed to `max-file: "3"` in the anchor of the copied `compose.yaml` → exit 1, stderr `logging missing or different: db server`.
  4. Copy, a profile service appended under `services:` of the copied `compose.yaml` with no `logging`: `probe:` with `image: alpine:3.20` and `profiles: [ops]` → exit 1, stderr `logging missing or different: probe`.
  5. Secrets: `POSTGRES_PASSWORD=canary-f096-secret bash deploy/check-logging.sh > "$d.out" 2>&1; echo "exit=$?"; grep -c canary-f096-secret "$d.out"; wc -l < "$d.out"` → `exit=0`, `0`, `1`. The job worktree has its own `.env` from the prepare script; the one output line proves no `.env` line reached the output. Never `cat` the `.env`.
  6. A missing file: `bash deploy/check-logging.sh /tmp/f096-s01/none.yaml; echo "exit=$?"` → exit not 0, stderr ends with `check-logging: docker compose config failed`.
- **Check:** tests 1–6 as written; `bash -n deploy/check-logging.sh` (syntax).
- **Done when:** tests 1–6 give the expected results, saved in `/tmp/f096-s01/cases.log`.
- **Out of scope:** a Bun test, a `package.json` script, `shellcheck` installs.

## Step 3 — CI step and runbook

- **Goal:** CI fails when a service has no rotation; the operator can check the VPS and knows how long Docker keeps logs.
- **Files:** `.github/workflows/ci.yml`, `deploy/README.md`.
- **Interfaces:** none.
- **Decisions:** D7, D8, D10.
  - `ci.yml`, job `image`: a new step right after the step `Check that the image uses the pinned Bun`:
    ```yaml
          - name: Check that every Compose service rotates its log
            run: bash deploy/check-logging.sh
    ```
    Change no other step or job.
  - `deploy/README.md` § Update: after step 3 ("Update and start" with its code block), add step 4:
    - Text: `Check the log rotation. Each line must end with \`json-file 10m 5\`:`
    - Code block (sh): `docker inspect --format '{{.Name}} {{.HostConfig.LogConfig.Type}} {{index .HostConfig.LogConfig.Config "max-size"}} {{index .HostConfig.LogConfig.Config "max-file"}}' $($C ps -q)`
    - Then: `A line that differs: run \`$C up -d --force-recreate --wait <service>\` for that service, then check again. A recreated container starts a new log file.`
  - `deploy/README.md` § Logs: after the first paragraph and its code block, add one paragraph of 2–4 short sentences: Docker keeps at most 5 files of 10 MB per container (`logging:` in `deploy/compose.yaml`); older lines are gone, and a recreated container starts empty; at about 0.5 MB a day the files hold months; a new service in any Compose file needs the same block, and `bash deploy/check-logging.sh` checks it (CI runs it).
  - Style: Simplified Technical English, short sentences, as the rest of the README. The pre-commit hook runs prettier on the `.md` file; that is fine. Do not format other files.
- **Test:**
  1. `grep -n "check-logging.sh" .github/workflows/ci.yml` → one line in the `image` job.
  2. `grep -c "json-file 10m 5" deploy/README.md` → 1 or more; `grep -c "check-logging.sh" deploy/README.md` → 1 or more.
  3. `git diff --stat master` → only `deploy/compose.yaml`, `deploy/compose.dev.yaml`, `deploy/check-logging.sh`, `.github/workflows/ci.yml`, `deploy/README.md` (and the ticket folder if the coordinator asks for a log line).
- **Check:** the three greps. Read the `ci.yml` diff once: the new step has the same indent as the steps next to it (6 spaces before `- name:`). A wrong indent breaks the whole workflow on `master`.
- **Done when:** tests 1–3 pass, and the Proof below prints `PROOF_OK`.
- **Out of scope:** the VPS deploy itself (plan.md P2), § First install, other README sections, `docs/known-alerts.md`.

## Stage done when

- Steps 1–3 done; `/tmp/f096-s01/cases.log` holds tests 1–6 of Step 2.
- The final message lists the commits and quotes the line `logging ok: db greenmail server`.
- Proof, after the last commit, with nothing after it:
  `mkdir -p /tmp/f096-s01 && bash deploy/check-logging.sh > /tmp/f096-s01/check.log 2>&1 && bun run lint > /tmp/f096-s01/lint.log 2>&1 && bun run typecheck > /tmp/f096-s01/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f096-s01/unit.log 2>&1 && bun run test:int:ci > /tmp/f096-s01/int.log 2>&1 && echo PROOF_OK`
