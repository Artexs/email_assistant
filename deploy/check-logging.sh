#!/usr/bin/env bash
# Checks that every service of the Compose files in deploy/ rotates its Docker log (10m, 5 files), and which driver it uses:
# `server` writes json-file (the files the log store reads); every other service writes `local`, so its lines never reach the store.
# It also fails when a document tells the reader to run a one-off command in `server` (`run ... server bun ...`): the `cli` service runs it.
# CHECK_LOGGING_DOCS (space-separated files) replaces the document list; the test uses it.
# Usage: bash deploy/check-logging.sh [compose file ...]. No arguments: deploy/compose.yaml and deploy/compose.dev.yaml, merged,
# then deploy/compose.sim.yaml on its own (the sim stack shares nothing with the production pair, so it is never merged with it).
# A new Compose file in deploy/ must be added to one of the two lists below: without arguments the script fails until then.
# It never prints the Compose config, because the config can hold secrets. CI runs it (job `image`).
set -euo pipefail

want_collected='{"driver":"json-file","options":{"max-size":"10m","max-file":"5"}}'
want_local='{"driver":"local","options":{"max-size":"10m","max-file":"5"}}'
default_files=(compose.yaml compose.dev.yaml)
alone_files=(compose.sim.yaml)

# One check of one set of Compose files, merged. It never prints the config.
check_set() {
  local args=()
  local f
  for f in "$@"; do
    args+=(-f "$f")
  done

  local config
  if ! config="$(docker compose "${args[@]}" --profile '*' config --no-env-resolution --no-interpolate --format json)"; then
    echo "check-logging: docker compose config failed" >&2
    exit 1
  fi

  local bad
  bad="$(printf '%s' "$config" | jq -r --argjson collected "$want_collected" --argjson local "$want_local" '
    .services | to_entries | sort_by(.key)[]
    | if .key == "server" then select(.value.logging != $collected) | "logging: \(.key) must be json-file 10m 5"
      else select(.value.logging != $local) | "logging: \(.key) must be local 10m 5" end')"
  if [ -n "$bad" ]; then
    echo "$bad" >&2
    exit 1
  fi

  local others
  others="$(printf '%s' "$config" | jq -r '.services | keys | map(select(. != "server")) | join(" ")')"
  echo "logging ok: server json-file; local: $others"
}

# Fails when a document line runs a one-off command in `server`. It prints the file and the line number, never the line.
check_docs() {
  local root="$1"
  local files=()
  local f
  if [ -n "${CHECK_LOGGING_DOCS:-}" ]; then
    read -r -a files <<<"$CHECK_LOGGING_DOCS"
  else
    shopt -s nullglob
    for f in "$root"/deploy/*.md "$root"/deploy/*.sh "$root"/docs/*.md "$root"/docs/decisions/*.md "$root"/docs/capabilities/*.md; do
      files+=("${f#"$root"/}")
    done
  fi

  local found=0
  local n
  for f in "${files[@]}"; do
    local path="$f"
    if [ ! -e "$path" ]; then path="$root/$f"; fi
    while IFS= read -r n; do
      [ -n "$n" ] || continue
      echo "check-logging: $f:$n: a one-off command runs in server; use \`run --rm cli\`" >&2
      found=1
    done < <(grep -nE '(^|[[:space:]])run[[:space:]]([^`]*[[:space:]])?server[[:space:]]+bun([[:space:]]|$)' "$path" | cut -d: -f1 || true)
  done
  if [ "$found" -ne 0 ]; then
    exit 1
  fi
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$#" -gt 0 ]; then
  check_set "$@"
  check_docs "$root"
  exit 0
fi

shopt -s nullglob
for path in "$root"/deploy/compose*.yaml "$root"/deploy/compose*.yml; do
  name="$(basename "$path")"
  known=0
  for d in "${default_files[@]}" "${alone_files[@]}"; do
    if [ "$d" = "$name" ]; then known=1; fi
  done
  if [ "$known" -eq 0 ]; then
    echo "check-logging: deploy/$name is not in the file list of deploy/check-logging.sh" >&2
    exit 1
  fi
done

merged=()
for d in "${default_files[@]}"; do
  merged+=("$root/deploy/$d")
done
check_set "${merged[@]}"
for d in "${alone_files[@]}"; do
  check_set "$root/deploy/$d"
done
check_docs "$root"
