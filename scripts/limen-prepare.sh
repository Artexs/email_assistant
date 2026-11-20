#!/usr/bin/env bash
# Limen `--prepare` hook: makes a job worktree runnable. Limen runs it in the job worktree.
# 1. Copy `.env` from the main checkout. 2. `bun install`. 3. Create an own DB for the job (`bun run db:worktree <name>`)
# and an own e2e DB for the Playwright suites (`db:worktree <name>-e2e`). 4. Pick a free block of three e2e ports and the
# mail tag of the job (`apps/server/src/scripts/e2e-job-env.ts`), under `flock /tmp/email-assistant-e2e-ports.lock`.
# The copy of the main `.env` drops eight keys, and the script writes them again for the job: `DATABASE_URL`,
# `MIGRATOR_DATABASE_URL`, `E2E_DATABASE_URL`, `E2E_MIGRATOR_DATABASE_URL`, `E2E_PORT`, `E2E_TELEGRAM_PORT`, `DOCS_TEST_PORT`
# and `E2E_MAIL_TAG`. So `bun run test:e2e`, `docs:test` and `docs:shots` run in a job next to other jobs, with no shared lock.
# Limen writes the output of this script to the job log, so it never prints `.env` lines or DB URLs.
# Run again in the same worktree (for example by `limen continue`): both DBs are reused; the port block may change and the
# old one becomes free. A failure exits 1, drops a DB that this run created, and leaves `./.env` as it was before the run
# (the new `.env` replaces it only at the end, under the port lock, so that no other prepare sees half of it).
# Drop the job DBs by hand after the job (`limen prune` does not): from the main checkout,
# `bun run db:worktree <name> --drop`, with the name printed below. It drops the job DB and its `-e2e` DB.
set -euo pipefail

root="${LIMEN_CONTEXT_ROOT:-$(git worktree list --porcelain | awk 'NR==1{print $2}')}"
job="${LIMEN_JOB_ID:?LIMEN_JOB_ID is not set}"

if [[ "$(pwd -P)" == "$(cd "$root" && pwd -P)" ]]; then
  echo "limen-prepare: refusing to run in the main checkout ($root)" >&2
  exit 1
fi

# DB name: the date and the hash part of the job id (`2026-11-12-<label>-c87b722b` → `2026-11-12-c87b722b`),
# so the name stays below the Postgres limit for any label.
name="$(printf '%s' "$job" | tr '[:upper:]' '[:lower:]' | sed -E 's/^([0-9]{4}-[0-9]{2}-[0-9]{2}).*-([0-9a-f]+)$/\1-\2/')"
if [[ ! "$name" =~ ^[a-z0-9][a-z0-9_-]*$ || ${#name} -gt 40 ]]; then
  echo "limen-prepare: cannot make a DB name from job id '$job'" >&2
  exit 1
fi

[[ -f "$root/.env" ]] || { echo "limen-prepare: no .env in $root" >&2; exit 1; }
umask 077

created_job=0
created_e2e=0
ports_lock=/tmp/email-assistant-e2e-ports.lock

# A DB that this run created is dropped when the run fails: `db:worktree <name> --drop` drops the job DB and its e2e DB,
# `db:worktree <name>-e2e --drop` only the e2e DB. A DB that existed before this run stays. The drop prints names only.
rollback_db() {
  local target="$1"
  if (set -a && . ./.env.base-db && set +a && bun run db:worktree "$target" --drop) > /dev/null 2>&1; then
    echo "limen-prepare: dropped the DB that this run created ($target)" >&2
  else
    echo "limen-prepare: could not drop the DB that this run created ($target): run bun run db:worktree $target --drop" >&2
  fi
}

on_exit() {
  local code=$?
  trap - EXIT
  if [[ $code -ne 0 && -f .env.base-db ]]; then
    if [[ $created_job == 1 ]]; then
      rollback_db "$name"
    elif [[ $created_e2e == 1 ]]; then
      rollback_db "$name-e2e"
    fi
  fi
  rm -f .env.base-db .env.new
  exit "$code"
}
trap on_exit EXIT

fail() {
  echo "limen-prepare: $1" >&2
  exit 1
}

# The new `.env` is built in `.env.new`. The LLM lines of the main .env (a real provider, a stopgap endpoint) make config tests
# fail in a job: a job never calls a real provider, so it gets none. The eight job keys come from this script, not from the main .env.
grep -vE '^(DATABASE_URL|MIGRATOR_DATABASE_URL|E2E_DATABASE_URL|E2E_MIGRATOR_DATABASE_URL|E2E_PORT|E2E_TELEGRAM_PORT|DOCS_TEST_PORT|E2E_MAIL_TAG|LLM_[A-Z_]*|OPENAI_[A-Z_]*|GEMINI_[A-Z_]*|DEEPSEEK_[A-Z_]*)=' "$root/.env" > .env.new || true
# The DB URLs and the Postgres password of the main checkout are needed to create (and, on a failure, to drop) the job DBs.
grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL|POSTGRES_PASSWORD)=' "$root/.env" > .env.base-db || true
echo "limen-prepare: .env copied from the main checkout"

bun install --frozen-lockfile
bash scripts/install-hooks.sh

# `db:worktree <db-name>` with the base URLs: sets the global `db_urls` (two lines) and the `created_*` flag of the run.
make_db() {
  local db_name="$1" flag="$2" output status=0
  output="$(set -a && . ./.env.base-db && set +a && bun run db:worktree "$db_name")" || status=$?
  if grep -q '^\[db-worktree\] created ' <<< "$output"; then
    printf -v "$flag" '%s' 1
  fi
  [[ $status == 0 ]] || fail "db:worktree $db_name failed (exit $status)"
  db_urls="$(grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' <<< "$output" || true)"
  [[ "$(grep -c . <<< "$db_urls")" == 2 ]] || fail "db:worktree $db_name did not print the two DB URLs"
}

db_urls=""
make_db "$name" created_job
printf '%s\n' "$db_urls" >> .env.new
make_db "$name-e2e" created_e2e
printf '%s\n' "$db_urls" | sed 's/^/E2E_/' >> .env.new

# The port block and the `.env` write run under one lock: another prepare reads this `.env` to see the claimed blocks, so the
# claim must be in place before the lock goes. This lock is not a test lock.
exec 9> "$ports_lock"
flock -w 120 9 || fail "could not lock $ports_lock (waited up to 120 s)"
job_env="$(bun apps/server/src/scripts/e2e-job-env.ts --job-name "$name")" || fail "no e2e port block (e2e-job-env failed)"
printf '%s\n' "$job_env" | grep -E '^(E2E_PORT|E2E_TELEGRAM_PORT|DOCS_TEST_PORT|E2E_MAIL_TAG)=' >> .env.new || true
for key in DATABASE_URL MIGRATOR_DATABASE_URL E2E_DATABASE_URL E2E_MIGRATOR_DATABASE_URL E2E_PORT E2E_TELEGRAM_PORT DOCS_TEST_PORT E2E_MAIL_TAG; do
  [[ "$(grep -cE "^$key=" .env.new || true)" == 1 ]] || fail "the new .env must hold $key exactly once"
done
mv -f .env.new .env
flock -u 9

echo "limen-prepare: own DB ready (db:worktree name: $name; e2e: $name-e2e)"
echo "limen-prepare: e2e ports $(sed -n 's/^E2E_PORT=//p' <<< "$job_env")/$(sed -n 's/^E2E_TELEGRAM_PORT=//p' <<< "$job_env")/$(sed -n 's/^DOCS_TEST_PORT=//p' <<< "$job_env"), mail tag $(sed -n 's/^E2E_MAIL_TAG=//p' <<< "$job_env")"
