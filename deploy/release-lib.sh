#!/usr/bin/env bash
# Shared by deploy/release.sh and deploy/rollback.sh (F114 stage 05). Source it from the repo root; it runs nothing by itself.
# State file: deploy/release-state/state, `key=value` lines. Every write goes through a temp file and `mv`.
# Tests set RELEASE_HEALTH_TIMEOUT and RELEASE_HEALTH_INTERVAL (seconds); production uses the defaults 120 and 2.

STATE_DIR=deploy/release-state
STATE_FILE="$STATE_DIR/state"
IMAGE=ea-server
HEALTH_URL=http://127.0.0.1:8080/health
# shellcheck source=deploy/compose-lib.sh
source deploy/compose-lib.sh
ea_compose_init || exit 2
COMPOSE_CMD=("${EA_COMPOSE[@]}")

# rclone for backup.sh lives in ~/bin on the VPS (deploy/README.md § Backups); cron puts it first, so do the same.
[[ -d "$HOME/bin" ]] && PATH="$HOME/bin:$PATH"

current=""
current_commit=""
previous=""
previous_commit=""
pending=""

# Reads the state file into the five variables. A value outside [A-Za-z0-9._-], or one that starts with `-`, is refused:
# it goes to docker and git later and must not read as an option.
state_load() {
  current="" current_commit="" previous="" previous_commit="" pending=""
  [[ -f "$STATE_FILE" ]] || return 0
  local key value
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    case "$key" in
      current | current_commit | previous | previous_commit | pending)
        if [[ ! "$value" =~ ^([A-Za-z0-9._][A-Za-z0-9._-]*)?$ ]]; then
          echo "$STATE_FILE: bad value for $key" >&2
          return 2
        fi
        printf -v "$key" '%s' "$value"
        ;;
    esac
  done <"$STATE_FILE"
}

state_write() {
  mkdir -p "$STATE_DIR"
  printf 'current=%s\ncurrent_commit=%s\nprevious=%s\nprevious_commit=%s\npending=%s\n' \
    "$current" "$current_commit" "$previous" "$previous_commit" "$pending" >"$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
}

# Waits for /health 200, then checks EA_RELEASE of the running server. $1 is the release the server must report.
# A `pre-*` image was built before the stamp existed: it reports `dev` or nothing.
verify_release() {
  local expected="$1" deadline reported
  deadline=$((SECONDS + ${RELEASE_HEALTH_TIMEOUT:-120}))
  until [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)" == 200 ]]; do
    if ((SECONDS >= deadline)); then
      echo "verify: $HEALTH_URL is not 200" >&2
      return 1
    fi
    sleep "${RELEASE_HEALTH_INTERVAL:-2}"
  done
  reported="$("${COMPOSE_CMD[@]}" exec -T server printenv EA_RELEASE || true)"
  reported="${reported//[$'\r\n']/}"
  if [[ "$expected" == pre-* ]]; then
    [[ -z "$reported" || "$reported" == dev ]] && return 0
  elif [[ "$reported" == "$expected" ]]; then
    return 0
  fi
  echo "verify: the server reports release '$reported', expected '$expected'" >&2
  return 1
}
