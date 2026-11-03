#!/usr/bin/env bash
# Nightly encrypted pg_dump, copied off the host. Runbook: deploy/README.md § Backups.
# Settings: deploy/backup.env (see deploy/backup.env.example). Run from cron.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=deploy/backup.env
if [[ ! -f "$ENV_FILE" ]]; then
  echo "backup: $ENV_FILE not found (copy deploy/backup.env.example)" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$ENV_FILE"

: "${BACKUP_DIR:?BACKUP_DIR is not set}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT is not set}"
: "${BACKUP_REMOTE:?BACKUP_REMOTE is not set}"
KEEP_DAYS="${KEEP_DAYS:-7}"
COMPOSE="${COMPOSE:-docker compose}"

if [[ "$BACKUP_DIR" != /* ]]; then
  echo "backup: BACKUP_DIR must be an absolute path (start with /)" >&2
  exit 1
fi
if [[ "$AGE_RECIPIENT" != age1* ]]; then
  echo "backup: AGE_RECIPIENT must be an age public key (age1...)" >&2
  exit 1
fi
if [[ ! "$KEEP_DAYS" =~ ^[0-9]+$ ]]; then
  echo "backup: KEEP_DAYS must be a whole number" >&2
  exit 1
fi
for tool in age rclone; do
  command -v "$tool" >/dev/null || { echo "backup: $tool is not installed" >&2; exit 1; }
done

read -ra compose_cmd <<<"$COMPOSE"
umask 077
mkdir -p "$BACKUP_DIR"

name="ea-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
part="$BACKUP_DIR/$name.part"
final="$BACKUP_DIR/$name"
# On any failure, remove the unfinished file so no .dump.age is left behind
trap 'rm -f "$part"' EXIT

"${compose_cmd[@]}" -f deploy/compose.yaml --env-file .env exec -T db \
  pg_dump -U postgres -d email_assistant -Fc |
  {
    # age writes ~200 bytes for empty input, so check the dump magic before encryption
    magic="$(dd bs=1 count=5 2>/dev/null)"
    if [[ "$magic" != PGDMP ]]; then
      echo "backup: pg_dump output is empty or not a custom-format dump" >&2
      exit 1
    fi
    printf '%s' "$magic"
    cat
  } |
  age -r "$AGE_RECIPIENT" -o "$part"

if [[ ! -s "$part" ]]; then
  echo "backup: $part is empty" >&2
  exit 1
fi

# Copy before the rename: a failed copy leaves no local .dump.age either
rclone copyto "$part" "$BACKUP_REMOTE/$name"
mv "$part" "$final"

# Local retention only. Remote retention is a lifecycle rule on the bucket.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ea-*.dump.age*' -mtime +"$KEEP_DAYS" -delete

echo "backup ok $name $(wc -c <"$final" | tr -d ' ')"
