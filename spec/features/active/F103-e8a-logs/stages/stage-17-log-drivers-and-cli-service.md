# F103 stage 17 — Log drivers and the `cli` service

Part of [`../plan.md`](../plan.md). Review job before the land (the driver split keeps CLI and Postgres lines out of the store). Needs no other stage. Three steps; in `apps/server/src` only one test.

## Step 1 — Two log drivers and the `cli` service

**Goal.** D12 and D13.

**Interfaces** (`deploy/compose.yaml`; the one `x-logging` anchor of today splits in two):

```yaml
# Only `server` writes json-file, the files the log store reads (ADR 0024 point 4); every other service `local`.
x-logging-collected: &logging-collected
  driver: json-file
  options: { max-size: 10m, max-file: "5" }
x-logging-local: &logging-local
  driver: local
  options: { max-size: 10m, max-file: "5" }
```

- `db`: `*logging-local`. `server`: `*logging-collected`.
- New service after `server`:

  ```yaml
  # One-off commands: `$C run --rm cli bun run <script> …`; output never reaches the store.
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

- `deploy/compose.dev.yaml`: `db` and `greenmail` get the `local` block (anchors do not cross files).
- No `!reset` of ports: `compose run` publishes none without `--service-ports`.

**Test.** `APP_PASSWORD=x MIGRATOR_PASSWORD=x POSTGRES_PASSWORD=x docker compose -f deploy/compose.yaml --profile cli config --no-env-resolution --format json` gives `cli` the `local` block and `LOG_FORMAT` `text`, `server` `json-file`, `db` `local`. Not `--no-interpolate` (it ignores profiles, V11). Another missing `${…:?}` variable gets a dummy value too. No daemon needed (V8).

**Done when.** The values are as listed.

## Step 2 — `check-logging.sh` checks drivers and CLI lines; a test

**Goal.** CI fails on a wrong driver or a one-off command in `server`.

**Interfaces** (`deploy/check-logging.sh`):

- Wanted: `server` = `json-file` with `max-size` `10m`, `max-file` `"5"`; every other service the same with `local`. One message per fault: `logging: <service> must be json-file 10m 5` or `logging: <service> must be local 10m 5`. Success line: `logging ok: server json-file; local: <other services>`. The rest of the script stays.
- Document check, in both modes (with and without compose arguments): ``grep -nE '(^|[[:space:]])run[[:space:]]([^`]*[[:space:]])?server[[:space:]]+bun([[:space:]]|$)'`` over `deploy/*.md deploy/*.sh docs/*.md docs/decisions/*.md docs/capabilities/*.md` (not `docs/product/`), or over the files in `CHECK_LOGGING_DOCS` (space-separated) when set. A match prints `` check-logging: <file>:<line>: a one-off command runs in server; use `run --rm cli` `` (line number, not text) and exits 1 (pattern: V13).

**Test** (`apps/server/src/deploy-logging.test.ts`, new; `Bun.spawnSync` of `bash deploy/check-logging.sh <file>` on compose files in a `mkdtempSync` folder, removed in `afterAll`; needs the `docker compose` CLI, no daemon).

1. Without arguments: exit 0 at this commit.
2. `server` on `local` → exit 1, stderr holds `server must be json-file`.
3. `db` on `json-file` → exit 1, stderr holds `db must be local`.
4. A service without `logging` → exit 1.
5. A passing compose file and `CHECK_LOGGING_DOCS=<temp file>`: the line `$C run -e KEY=val server bun run x` → exit 1, stderr holds `<temp file>:1:` and not `KEY=val`; a file with `$C run --rm cli bun run x` and `$C exec server bun run x` → exit 0.

**Done when.** The five cases pass.

## Step 3 — Document lines and ADR point 4

- Every one-off line `$C run [options] server bun …` becomes `$C run [options] cli bun …`: 46 lines in `deploy/README.md` and 1 in `docs/known-alerts.md` at `560e74e7` (the cron line of § 48-hour test and the `--user` export lines too). `--build` stays (`cli` builds the same image). `$C exec server …` lines stay.
- `deploy/README.md` § Logs: the `exec -e LOG_FORMAT=text server` sentence becomes "One-off commands run in the `cli` service (`$C run --rm cli bun run <script> …`): readable text, never in the log store. `$C exec server …` prints to your terminal only."
- § Update step 4: `server` ends with `json-file 10m 5`, others with `local 10m 5`; the first deploy recreates `db`.
- ADR 0024 point 4 states D12 (all services rotate 10 MB × 5; only `server` `json-file`; Postgres, `cli` and the store `local`, so their lines never reach the store); "Progress" names stage 17 and the reason.

**Shared dev runtime.** Do not run `up` on the shared dev stack (the new block recreates dev `db` and `greenmail`); the coordinator tells the owner.

**Done when.** `check-logging.sh` and `prettier --check` pass; the Proof (`/tmp/f103-s17`) prints `PROOF_OK`.

**Out of scope.** The store (18), the VPS (19).
