#!/usr/bin/env bash
# Limen `--prepare` hook: makes a job worktree runnable. Limen runs it in the job worktree.
# 1. Copy `.env` from the main checkout. 2. `bun install`. 3. Create an own DB for the job
# (`bun run db:worktree`) and point `DATABASE_URL` / `MIGRATOR_DATABASE_URL` in `./.env` at it.
# Limen writes the output of this script to the job log, so it never prints `.env` lines or DB URLs.
# Drop the job DB by hand after the job (`limen prune` does not): from the main checkout,
# `bun run db:worktree <name> --drop`, with the name printed below.
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
trap 'rm -f .env.base-db' EXIT
grep -vE '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' "$root/.env" > .env
# The DB URLs of the main checkout are needed once, to create the job DB.
grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' "$root/.env" > .env.base-db
echo "limen-prepare: .env copied from the main checkout"

bun install --frozen-lockfile

urls="$(set -a && . ./.env.base-db && set +a && bun run db:worktree "$name")"
rm -f .env.base-db
printf '%s\n' "$urls" | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' >> .env
[[ "$(grep -cE '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' .env)" == 2 ]] || {
  echo "limen-prepare: db:worktree did not print the two DB URLs" >&2
  exit 1
}
echo "limen-prepare: own DB ready (db:worktree name: $name)"
