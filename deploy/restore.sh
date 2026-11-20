#!/usr/bin/env bash
# The one restore path (ticket spec/features/active/F114-e8b-alerts-and-releases-incl-the-restore-drill): a restore drill and a rebuild of a lost host. Runbook: deploy/README.md § Backups.
#   deploy/restore.sh --target drill --init-env <live .env>        make deploy/drill.env (new passwords, the credentials key)
#   deploy/restore.sh --target drill|new-host --stdin              the plain dump (pg_restore -Fc) arrives on stdin
#   deploy/restore.sh --target drill|new-host <file.dump.age> <identity file>
#   deploy/restore.sh --target drill --down                        remove the drill stack, its volume and its image
# Exit 2: refused, nothing changed. Exit 1: a step failed (the stack stays up for a look; `--down` removes a drill).
# `drill` uses only the project `ea-drill`, the volume and the network of that project, and the image `ea-drill-server`
# (deploy/compose.drill.yaml). It never touches the live DB, the live volumes or a real mailbox.
# The plain dump travels in a pipe and never touches the disk. The age identity stays on the machine that runs `age`.
# Only the `pg_restore` call reads stdin: a `compose exec` forwards stdin, so every other docker call gets </dev/null.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=deploy/compose-lib.sh
source deploy/compose-lib.sh

# A caller variable must not change which stack the script talks to.
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES

DRILL_ENV=deploy/drill.env
DRILL_PROJECT=ea-drill
LIVE_PROJECT=email-assistant
DRILL_IMAGE=ea-drill-server
MIGRATOR_ROLE=migrator

target=""
mode=restore
live_env=""
use_stdin=0
dump_file=""
identity_file=""
step=""
started=$SECONDS

refuse() {
  step=""
  echo "restore refused: $1" >&2
  exit 2
}

on_exit() {
  local code=$?
  trap - EXIT
  if ((code != 0)) && [[ -n "$step" ]]; then
    echo "restore failed at $step" >&2
    if [[ "$target" == drill ]]; then
      echo "the drill stack stays up for a look; remove it with deploy/restore.sh --target drill --down" >&2
    fi
    exit 1
  fi
  exit "$code"
}
trap on_exit EXIT

parse_args() {
  local positional=()
  while (($# > 0)); do
    case "$1" in
      --target)
        (($# >= 2)) || refuse "--target needs drill or new-host"
        target="$2"
        shift 2
        ;;
      --init-env)
        (($# >= 2)) || refuse "--init-env needs the path of the live .env"
        mode=init-env
        live_env="$2"
        shift 2
        ;;
      --down)
        mode=down
        shift
        ;;
      --stdin)
        use_stdin=1
        shift
        ;;
      -*) refuse "unknown option $1" ;;
      *)
        positional+=("$1")
        shift
        ;;
    esac
  done
  [[ "$target" == drill || "$target" == new-host ]] || refuse "usage: --target drill|new-host (--stdin | <file.dump.age> <identity file>)"
  if [[ "$mode" == init-env || "$mode" == down ]]; then
    [[ "$target" == drill ]] || refuse "--init-env and --down work only with --target drill"
    ((use_stdin == 0 && ${#positional[@]} == 0)) || refuse "--init-env and --down take no dump"
    return 0
  fi
  if ((use_stdin)); then
    ((${#positional[@]} == 0)) || refuse "--stdin takes no file"
  else
    ((${#positional[@]} == 2)) || refuse "give --stdin, or a <file.dump.age> and an <identity file>"
    dump_file="${positional[0]}"
    identity_file="${positional[1]}"
    [[ -f "$dump_file" ]] || refuse "$dump_file not found"
    [[ -f "$identity_file" ]] || refuse "$identity_file not found"
    command -v age >/dev/null || refuse "age is not installed"
  fi
}

# `docker compose` of the target. The drill command is fixed here, never taken from the caller.
set_compose() {
  if [[ "$target" == drill ]]; then
    [[ -f "$DRILL_ENV" ]] || refuse "$DRILL_ENV does not exist; run deploy/restore.sh --target drill --init-env <live .env>"
    C=(docker compose -p "$DRILL_PROJECT" -f deploy/compose.yaml -f deploy/compose.drill.yaml --env-file "$DRILL_ENV")
  else
    [[ -f deploy/db.env || -f .env ]] || refuse ".env does not exist; make it first (deploy/README.md § First install)"
    # Before any docker call: a new host that is not split would start the server with the database keys in `.env`.
    local split_state
    split_state="$(ea_env_split_state)"
    [[ "$split_state" == split ]] || refuse "run deploy/env-split.sh first (state $split_state)"
    ea_compose_init || exit 2
    C=("${EA_COMPOSE[@]}")
  fi
}

# Reads the resolved drill config, never prints it (it holds the drill passwords). The drill must not run as the live project
# and must publish no port.
drill_guard() {
  local config name published
  config="$("${C[@]}" config --format json </dev/null)"
  name="$(printf '%s' "$config" | jq -r '.name')"
  [[ "$name" != "$LIVE_PROJECT" ]] || refuse "the drill would run as the live project $LIVE_PROJECT"
  published="$(printf '%s' "$config" | jq -r '[.services[] | select((.ports // []) | length > 0)] | length')"
  [[ "$published" == 0 ]] || refuse "a drill service publishes a port"
}

init_env() {
  [[ ! -e "$DRILL_ENV" ]] || refuse "$DRILL_ENV exists; remove the old drill first (--down) so the passwords match its volume"
  [[ -f "$live_env" ]] || refuse "$live_env not found"
  local key_line version_line
  # The live file is read as text, never sourced. `^CREDENTIALS_KEY=` does not match `CREDENTIALS_KEY_VERSION=`.
  key_line="$(grep -m 1 '^CREDENTIALS_KEY=' "$live_env" || true)"
  [[ -n "$key_line" ]] || refuse "$live_env has no CREDENTIALS_KEY line"
  version_line="$(grep -m 1 '^CREDENTIALS_KEY_VERSION=' "$live_env" || true)"
  local postgres migrator app
  postgres="$(openssl rand -hex 24)"
  migrator="$(openssl rand -hex 24)"
  app="$(openssl rand -hex 24)"
  # The subshell umask makes the file mode 600 from the first byte.
  (
    umask 077
    {
      printf 'POSTGRES_PASSWORD=%s\n' "$postgres"
      printf 'MIGRATOR_PASSWORD=%s\n' "$migrator"
      printf 'APP_PASSWORD=%s\n' "$app"
      printf '%s\n' "$key_line"
      [[ -z "$version_line" ]] || printf '%s\n' "$version_line"
      printf 'LOG_LEVEL=info\n'
    } >"$DRILL_ENV"
  )
  echo "wrote $DRILL_ENV (mode 600): three new database passwords and the credentials key of $live_env"
}

down() {
  step=down
  "${C[@]}" down -v </dev/null
  # Only the drill image. `--rmi all` would also remove postgres:17, which the live stack uses.
  step=image
  docker image rm "$DRILL_IMAGE" </dev/null || echo "down: image $DRILL_IMAGE was not there" >&2
  rm -f "$DRILL_ENV"
  step=""
  echo "drill down: project $DRILL_PROJECT, its volume and image $DRILL_IMAGE are gone"
}

psql_db() {
  "${C[@]}" exec -T db psql -U postgres -d email_assistant -v ON_ERROR_STOP=1 -At "$@" </dev/null
}

# The Postgres image starts a temporary server for its init (socket only, `listen_addresses=''`), stops it, then starts the final
# server (TCP). `up --wait db` and a socket probe pass during the init. A TCP answer proves the final server runs.
wait_db_tcp() {
  step=db-ready
  local probes=0 max=60
  while ((probes < max)); do
    probes=$((probes + 1))
    if "${C[@]}" exec -T db pg_isready -q -h 127.0.0.1 -U postgres -d email_assistant </dev/null; then
      echo "db ready probes=$probes"
      return 0
    fi
    ((probes < max)) && sleep 1
  done
  echo "restore: the database did not answer on TCP after $max probes" >&2
  exit 1
}

restore() {
  local tag
  tag="$(git describe --tags --exact-match HEAD 2>/dev/null || true)"
  # Every compose call below reads it: the build stamps it, and the other calls must not see another value.
  export EA_RELEASE="${tag:-dev}"

  if [[ "$target" == drill ]]; then
    step=guard
    drill_guard
  fi

  step=db
  "${C[@]}" up -d --wait db </dev/null
  wait_db_tcp

  # Never restore over data. A drill that ran before needs --down first.
  step=guard-empty
  local tables
  tables="$(psql_db -c "select count(*) from pg_tables where schemaname = 'public'")"
  [[ "$tables" =~ ^[0-9]+$ ]] || { echo "restore: could not read the table count" >&2; exit 1; }
  if ((tables > 0)); then
    if [[ "$target" == drill ]]; then
      refuse "the drill database has $tables tables; run deploy/restore.sh --target drill --down first"
    fi
    refuse "the database has $tables tables; a new-host restore never goes over data"
  fi

  # The only build, after the guard: a refused run must change nothing, and a build retags the server image.
  # The db service needs no server image. Every later call is --no-build (or exec).
  step=build
  "${C[@]}" build server </dev/null

  step=pg_restore
  if ((use_stdin)); then
    "${C[@]}" exec -T db pg_restore -U postgres -d email_assistant --no-owner --role="$MIGRATOR_ROLE" --exit-on-error
  else
    age -d -i "$identity_file" "$dump_file" |
      "${C[@]}" exec -T db pg_restore -U postgres -d email_assistant --no-owner --role="$MIGRATOR_ROLE" --exit-on-error
  fi

  step=counts
  local rows
  rows="$(psql_db -F ' ' -c "
    select 'organizations', count(*) from organizations
    union all select 'users', count(*) from users
    union all select 'mailboxes', count(*) from mailboxes
    union all select 'emails', count(*) from emails")"
  printf '%s\n' "$rows" | awk 'BEGIN { line = "count" } { line = line " " $1 "=" $2 } END { print line }'

  if [[ "$target" == drill ]]; then
    # The restored mailboxes hold real addresses. Paused mailboxes do not sync (no sync-off key exists). A restored open
    # alert row would hide the alert of the drill.
    step=pause-mailboxes
    psql_db -c "update mailboxes set status = 'paused'" >/dev/null
    step=clear-alerts
    psql_db -c "delete from ops_alerts" >/dev/null
  fi

  # The dump holds live session tokens (deploy/README.md § Backups).
  step=clear-sessions
  psql_db -c "delete from auth_sessions" >/dev/null

  step=migrate
  "${C[@]}" run --rm -T migrate </dev/null

  # The key of this host must open every stored mailbox secret before the server starts.
  step=credentials
  local creds failed
  creds="$("${C[@]}" run --rm -T cli bun run credentials:check </dev/null)"
  echo "$creds"
  # The result line is `[credentials-check] credentials ok=<n> failed=<m>` (createCliOutput adds the prefix; the script holds the
  # text in apps/server/src/scripts/lib/credentials-check-lines.ts). The bare line is accepted too.
  # Exactly one exact result line counts. Two lines (a fault, or output that a bad actor shaped) could hide a failure behind a good
  # line, so the script stops; the message never prints a line of the output.
  local results lines
  results="$(printf '%s\n' "$creds" | sed -n 's/^\(\[credentials-check\] \)\{0,1\}credentials ok=[0-9]\{1,\} failed=\([0-9]\{1,\}\)$/\2/p')"
  lines=0
  [[ -z "$results" ]] || lines="$(printf '%s\n' "$results" | wc -l)"
  if ((lines != 1)); then
    echo "restore: credentials:check printed $lines result lines, not exactly 1; the server stays down" >&2
    exit 1
  fi
  failed="$(printf '%s\n' "$results" | tail -n 1)"
  [[ "$failed" =~ ^[0-9]+$ ]] || { echo "restore: credentials:check printed no result line" >&2; exit 1; }
  if ((failed > 0)); then
    echo "restore: $failed mailbox secrets do not open with this CREDENTIALS_KEY; the server stays down" >&2
    exit 1
  fi

  step=up
  "${C[@]}" up -d --no-build --wait </dev/null

  step=""
  if [[ "$target" == new-host ]]; then
    echo "next: run again each \`deleted <org id>\` line of org:delete and each \`record: dsr erase\` line of org:dsr (deploy/README.md § Backups)"
  fi
  echo "restore ok target=$target seconds=$((SECONDS - started))"
}

parse_args "$@"
case "$mode" in
  init-env) init_env ;;
  down)
    set_compose
    down
    ;;
  *)
    set_compose
    restore
    ;;
esac
