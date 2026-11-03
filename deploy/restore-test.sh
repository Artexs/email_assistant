#!/usr/bin/env bash
# Restores one backup into a throwaway Postgres container and prints row counts.
# Runs on a machine that has the age private key (never the VPS). Runbook: deploy/README.md § Backups.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: deploy/restore-test.sh <backup file .dump.age> <age identity file>" >&2
  exit 1
fi
backup="$1"
identity="$2"
for file in "$backup" "$identity"; do
  [[ -f "$file" ]] || { echo "restore-test: $file not found" >&2; exit 1; }
done
for tool in age docker openssl; do
  command -v "$tool" >/dev/null || { echo "restore-test: $tool is not installed" >&2; exit 1; }
done

container=ea-restore-test
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$container" --network none \
  -e POSTGRES_PASSWORD="$(openssl rand -hex 24)" -e POSTGRES_DB=email_assistant \
  postgres:17 >/dev/null

# The image's init server listens on the socket only, so wait for TCP: the real server
ready=0
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -q -h 127.0.0.1 -U postgres -d email_assistant; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "restore-test: postgres did not start in 60 s" >&2
  exit 1
fi

# The plain dump goes through a pipe and never touches the disk
age -d -i "$identity" "$backup" |
  docker exec -i "$container" pg_restore -U postgres --no-owner --no-privileges --exit-on-error -d email_assistant

docker exec "$container" psql -U postgres -d email_assistant -At -F ' ' -v ON_ERROR_STOP=1 -c "
  select 'organizations', count(*) from organizations
  union all select 'users', count(*) from users
  union all select 'mailboxes', count(*) from mailboxes
  union all select 'emails', count(*) from emails"
