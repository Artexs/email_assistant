#!/usr/bin/env bash
# Prints the server log as text lines, filtered by run, request, event or level. It needs no log store (deploy/README.md § Logs).
# Usage (from the repo root): bash deploy/logs.sh [--since <duration, default 1h>] [--run <id>] [--request <id>] [--event <code>]
#   [--level <debug|info|warn|error>] [--follow]
# Each line reads: <time> <level> [<module>] <event> key=value ...
# The hidden option --stdin reads JSON lines from stdin instead of `docker compose logs` (the test uses it).
set -euo pipefail

# Run from the repo root whatever the caller's directory is (the Compose paths below are relative to it).
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=deploy/compose-lib.sh
source deploy/compose-lib.sh

usage() {
  echo "usage: bash deploy/logs.sh [--since <duration>] [--run <id>] [--request <id>] [--event <code>] [--level <debug|info|warn|error>] [--follow]" >&2
  exit 2
}

since="1h"
run=""
request=""
event=""
level=""
follow=0
use_stdin=0

# A value option needs a non-empty value: otherwise it would silently filter nothing.
need_value() {
  [ "$1" -ge 2 ] && [ -n "$2" ] || usage
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --since) need_value "$#" "${2-}"; since="$2"; shift 2 ;;
    --run) need_value "$#" "${2-}"; run="$2"; shift 2 ;;
    --request) need_value "$#" "${2-}"; request="$2"; shift 2 ;;
    --event) need_value "$#" "${2-}"; event="$2"; shift 2 ;;
    --level) need_value "$#" "${2-}"; level="$2"; shift 2 ;;
    --follow) follow=1; shift ;;
    --stdin) use_stdin=1; shift ;;
    *) usage ;;
  esac
done

case "$level" in
  "" | debug | info | warn | error) ;;
  *) usage ;;
esac

# --follow needs jq to print each line at once, not in blocks.
jq_flags=()
if [ "$follow" -eq 1 ]; then
  jq_flags=(--unbuffered)
fi

# The filters hold values only through --arg. An empty value means no filter.
render() {
  jq -rR ${jq_flags[@]+"${jq_flags[@]}"} --arg run "$run" --arg request "$request" --arg event "$event" --arg level "$level" '
    # A level that is not one of the four (a number, say) ranks as the highest: it is shown, not hidden.
    def rank: {debug: 0, info: 1, warn: 2, error: 3}[tostring] // 99;
    fromjson?
    | select(type == "object")
    | select($run == "" or .run_id == $run)
    | select($request == "" or .request_id == $request)
    | select($event == "" or .event == $event)
    | select($level == "" or ((.level // "info") | rank) >= ($level | rank))
    | [.time, (.level | tostring), "[\(.module)]", .event, (del(.time, .level, .module, .event, .msg) | to_entries | map("\(.key)=\(.value)") | join(" "))]
    | map(select(. != "")) | join(" ")'
}

if [ "$use_stdin" -eq 1 ]; then
  render
else
  follow_args=()
  if [ "$follow" -eq 1 ]; then
    follow_args=(--follow)
  fi
  ea_compose_init || exit 2
  C=("${EA_COMPOSE[@]}")
  "${C[@]}" logs --no-log-prefix --since "$since" ${follow_args[@]+"${follow_args[@]}"} server | render
fi
