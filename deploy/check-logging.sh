#!/usr/bin/env bash
# Checks that every service of the Compose files in deploy/ rotates its Docker log (json-file, 10m, 5 files).
# Usage: bash deploy/check-logging.sh [compose file ...]. No arguments: deploy/compose.yaml and deploy/compose.dev.yaml, merged,
# then deploy/compose.sim.yaml on its own (the sim stack shares nothing with the production pair, so it is never merged with it).
# A new Compose file in deploy/ must be added to one of the two lists below: without arguments the script fails until then.
# It never prints the Compose config, because the config can hold secrets. CI runs it (job `image`).
set -euo pipefail

want='{"driver":"json-file","options":{"max-size":"10m","max-file":"5"}}'
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
  bad="$(printf '%s' "$config" | jq -r --argjson want "$want" '.services | to_entries | map(select(.value.logging != $want) | .key) | sort | join(" ")')"
  if [ -n "$bad" ]; then
    echo "logging missing or different: $bad" >&2
    exit 1
  fi

  echo "logging ok: $(printf '%s' "$config" | jq -r '.services | keys | sort | join(" ")')"
}

if [ "$#" -gt 0 ]; then
  check_set "$@"
  exit 0
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
