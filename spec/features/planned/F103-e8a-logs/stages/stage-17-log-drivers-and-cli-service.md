# F103 stage 17 — Log drivers and the `cli` service

Part of [`../plan.md`](../plan.md). Review job before the land (the driver split keeps CLI output and Postgres lines out of the store). Needs no other stage; may run next to any stage.

Three steps. No code in `apps/server/src` except one test.

## Step 1 — Two log drivers and the `cli` service

**Goal.** Only `server` writes `json-file` logs; every other service writes `local` logs; one-off commands run in a `cli` service (D12, D13).

**Files.** `deploy/compose.yaml`, `deploy/compose.dev.yaml`.

**Interfaces** (`deploy/compose.yaml`):

```yaml
# Docker log rotation (deploy/README.md § Logs; deploy/check-logging.sh checks it).
# Only `server` writes json-file: the log store collector reads only *-json.log files (ADR 0024 point 4).
# Every other service writes `local` (Postgres and CLI lines never reach the store).
x-logging-collected: &logging-collected
  driver: json-file
  options:
    max-size: 10m
    max-file: "5"
x-logging-local: &logging-local
  driver: local
  options:
    max-size: 10m
    max-file: "5"
```

- `db`: `logging: *logging-local`. `server`: `logging: *logging-collected`.
- New service after `server`:

  ```yaml
  # One-off commands: `$C run --rm cli bun run <script> …` (deploy/README.md). Its output stays in the terminal and in a local log, never in the store.
  cli:
    extends:
      service: server
    profiles: [cli]
    logging: *logging-local
    restart: "no"
    healthcheck:
      disable: true
    environment:
      LOG_FORMAT: text
  ```

- `deploy/compose.dev.yaml`: every service (`db`, `greenmail`) gets the `local` block (repeat the anchor in that file, or write the block out; a YAML anchor does not cross files).
- `compose run` does not publish the inherited ports without `--service-ports` (D13), so no `!reset`.

**Decisions.** D12, D13. V6, V8.

**Test.** `APP_PASSWORD=x MIGRATOR_PASSWORD=x POSTGRES_PASSWORD=x docker compose -f deploy/compose.yaml --profile cli config --no-env-resolution --format json | jq '.services.cli.logging, .services.cli.environment.LOG_FORMAT, .services.server.logging.driver, .services.db.logging.driver'` prints the `local` block, `"text"`, `"json-file"`, `"local"`. Use `--no-env-resolution` (the `.env` file is not read) but not `--no-interpolate`: with `--no-interpolate`, `config` ignores the profiles and writes the environment of an extended service as an array (V11). The three dummy values satisfy the `${…:?}` interpolations of `compose.yaml`; if `config` names another missing variable, add it the same way. No Docker daemon is needed (V8).

**Check.** The command above.

**Done when.** The values are as listed.

## Step 2 — `deploy/check-logging.sh` checks the drivers and the CLI lines; a test for it

**Goal.** CI fails when a service has the wrong driver or a document runs a one-off command in `server` (D12, D13).

**Files.** `deploy/check-logging.sh`, `apps/server/src/deploy-logging.test.ts` (new).

**Interfaces.**

- `check-logging.sh`: two wanted objects, `collected='{"driver":"json-file","options":{"max-size":"10m","max-file":"5"}}'` and `local='{"driver":"local","options":{"max-size":"10m","max-file":"5"}}'`. The service `server` must have `collected`; every other service must have `local`. One message per fault: `logging: <service> must be json-file 10m 5` or `logging: <service> must be local 10m 5`. Keep the rest of the script (file list, no config print). The document check runs in both modes (with and without compose arguments).
- A second check in the same script: ``grep -nE '(^|[[:space:]])run[[:space:]]([^`]*[[:space:]])?server[[:space:]]+bun([[:space:]]|$)'`` over the documents. The document list is `deploy/*.md deploy/*.sh docs/*.md docs/decisions/*.md docs/capabilities/*.md` (not `docs/product/`), or the files in the env variable `CHECK_LOGGING_DOCS` (space-separated) when it is set, so the test can run the script on a temp file. A match prints `` check-logging: <file>:<line>: a one-off command runs in server; use `run --rm cli` `` (the line number, not the line text) and exits 1. The pattern matched the 32 lines of `deploy/README.md` at `0a5c2ee` and `$C run -e KEY=val server bun run x`, and not `$C run --rm cli bun run x`, `$C exec server bun run x`, `the server runs` (V13).
- The success line becomes `logging ok: server json-file; local: <other services>`.
- `deploy-logging.test.ts` runs `bash deploy/check-logging.sh <file>` with `Bun.spawnSync` on compose files that it writes to a temp folder (`mkdtempSync(join(tmpdir(), "f103-logging-"))`, removed in `afterAll`). It needs the `docker compose` CLI (CI has it; V8: no daemon needed).

**Test** (`deploy-logging.test.ts`).

1. `bash deploy/check-logging.sh` without arguments exits 0 at this commit.
2. A compose file with `server` on `local` → exit 1, stderr holds `server must be json-file`.
3. A compose file with `db` on `json-file` → exit 1, stderr holds `db must be local`.
4. A compose file with a service without `logging` → exit 1.
5. With `CHECK_LOGGING_DOCS=<temp file>` and a compose argument that passes: a temp file with the line `$C run -e KEY=val server bun run x` → exit 1, stderr holds `<temp file>:1:` and not `KEY=val`; a temp file with `$C run --rm cli bun run x` and `$C exec server bun run x` → exit 0. (The script runs the document check also when compose files are given as arguments.)

**Check.** `bun test apps/server/src/deploy-logging.test.ts`; `bash deploy/check-logging.sh`.

**Done when.** The five cases pass and the script passes on the repo (after step 3).

## Step 3 — README lines and ADR point 4

**Files.** `deploy/README.md`, `docs/decisions/0024-structured-logs-and-operator-alerts.md`, `docs/known-alerts.md` (only if an entry holds a `run … server` line).

- Every one-off line `$C run [options] server …` becomes `$C run [options] cli …` (32 lines at `0a5c2ee`: lines 35, 37, 39, 51, 83, 95, 97, 99, 100, 259–261, 295, 296, 301, 335, 388–391, 426–434, 470, 477, 480). `--build` stays where it is: `cli` extends `server`, so it builds the same image. `$C exec server …` lines stay.
- § Logs: the sentence "A CLI prints the text form with `$C exec -e LOG_FORMAT=text server bun run <script> …`" becomes "One-off commands run in the `cli` service (`$C run --rm cli bun run <script> …`): it prints readable text, and its output never reaches the log store. `$C exec server …` prints to your terminal only."
- The rotation check (§ "Check the log rotation", step 4): `server` must end with `json-file 10m 5`, every other line with `local 10m 5`. A recreated `db` after the first deploy with the new block: a short DB restart (as in F096).
- ADR 0024 point 4: "**Rotation.** Every Compose service rotates its log at 10 MB × 5 files. Only `server` uses `json-file`, the format the log store collector reads; every other service (Postgres, the `cli` one-off service, the store itself) uses `local`, so their lines never reach the store." Add the reason line to "Progress": "F103 stage 17 split the drivers (Postgres error lines can hold row values; CLI output holds what the operator asked for)."

**Check.** `bash deploy/check-logging.sh` passes; `grep -c "run .*cli bun run" deploy/README.md` is 32 or more; `bunx prettier --check deploy/README.md docs/decisions/0024-structured-logs-and-operator-alerts.md`.

**Shared dev runtime.** The new `local` block in `deploy/compose.dev.yaml` recreates the shared dev `db` and `greenmail` containers at their next `up` (`CLAUDE.md`, shared runtime). Do not run `up` on the shared dev stack; the coordinator tells the owner (plan § How to run).

**Done when.** The Proof of `plan.md` for stages 17–18 (`/tmp/f103-s17`) prints `PROOF_OK`.

**Out of scope.** The store services (stage 18). The VPS (stage 19).
