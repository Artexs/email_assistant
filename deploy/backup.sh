#!/usr/bin/env bash
# Nightly encrypted pg_dump, copied off the host. Runbook: deploy/README.md § Backups.
# Settings: deploy/backup.env (see deploy/backup.env.example). Run from cron.
set -euo pipefail

cd "$(dirname "$0")/.."

# Status of the last run, for the server check (F114 stage 04, deploy/README.md § Backups). The path comes from the script
# folder, not from backup.env, so a bad backup.env still leaves a `failed` status. The server container reads it read-only.
STATUS_DIR=deploy/backup-status
STATUS_FILE="$STATUS_DIR/status.json"
BACKUP_PING_URL=""
part=""
ok_name=""
ok_bytes=""

# The one exit trap. A non-zero exit after this point writes `failed`; a good run writes `ok`. Then it pings, if a URL is set.
on_exit() {
  local code=$?
  trap - EXIT
  set +e
  [[ -n "$part" ]] && rm -f "$part"
  local at result name bytes last_ok
  at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # The old last_ok_at, read with plain tools (the host has no jq). Only a plain time value is kept.
  last_ok=""
  if [[ -r "$STATUS_FILE" ]]; then
    last_ok="$(sed -n 's/.*"last_ok_at":"\([0-9TZ:.-]*\)".*/\1/p' "$STATUS_FILE" | head -n 1)"
  fi
  if ((code == 0)) && [[ -n "$ok_name" ]]; then
    result=ok
    name="\"$ok_name\""
    bytes="$ok_bytes"
    last_ok="$at"
  else
    result=failed
    name=null
    bytes=null
    ((code == 0)) && code=1
  fi
  if [[ -n "$last_ok" ]]; then last_ok="\"$last_ok\""; else last_ok=null; fi
  # Write beside the target and rename: a reader never sees half a file. The umask of the script would hide the file
  # from the container user, so the folder and the file are made readable for all.
  if (
    umask 022
    mkdir -p "$STATUS_DIR" &&
      printf '{"result":"%s","at":"%s","name":%s,"bytes":%s,"last_ok_at":%s}\n' \
        "$result" "$at" "$name" "$bytes" "$last_ok" >"$STATUS_FILE.tmp" &&
      chmod 644 "$STATUS_FILE.tmp" &&
      mv "$STATUS_FILE.tmp" "$STATUS_FILE"
  ); then
    :
  else
    rm -f "$STATUS_FILE.tmp"
    echo "backup: cannot write $STATUS_FILE" >&2
  fi
  # The ping never changes the exit code and never prints the URL (the URL is a secret). curl stderr is dropped for the same reason.
  if [[ -n "$BACKUP_PING_URL" ]]; then
    local url="$BACKUP_PING_URL"
    [[ "$result" == ok ]] || url="${BACKUP_PING_URL%/}/fail"
    curl -fsS -m 10 --retry 3 -o /dev/null "$url" 2>/dev/null || echo "backup ping failed" >&2
  fi
  exit "$code"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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
# On any failure the exit trap removes the unfinished file, so no .dump.age is left behind

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
rclone copyto --no-check-dest "$part" "$BACKUP_REMOTE/$name"
mv "$part" "$final"

# Local retention only. Remote retention is a lifecycle rule on the bucket.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ea-*.dump.age*' -mtime +"$KEEP_DAYS" -delete

ok_bytes="$(wc -c <"$final" | tr -d ' ')"
ok_name="$name"
echo "backup ok $ok_name $ok_bytes"
