#!/usr/bin/env bash
# Checks that every service of the Compose files in deploy/ rotates its Docker log (json-file, 10m, 5 files).
# Usage: bash deploy/check-logging.sh [compose file ...]. No arguments: deploy/compose.yaml and deploy/compose.dev.yaml, merged.
# A new Compose file in deploy/ must be added to the default list below: without arguments the script fails until then.
# It never prints the Compose config, because the config can hold secrets. CI runs it (job `image`).
set -euo pipefail

want='{"driver":"json-file","options":{"max-size":"10m","max-file":"5"}}'
default_files=(compose.yaml compose.dev.yaml)

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  shopt -s nullglob
  for path in "$root"/deploy/compose*.yaml "$root"/deploy/compose*.yml; do
    name="$(basename "$path")"
    known=0
    for d in "${default_files[@]}"; do
      if [ "$d" = "$name" ]; then known=1; fi
    done
    if [ "$known" -eq 0 ]; then
      echo "check-logging: deploy/$name is not in the file list of deploy/check-logging.sh" >&2
      exit 1
    fi
  done
  files=()
  for d in "${default_files[@]}"; do
    files+=("$root/deploy/$d")
  done
fi

args=()
for f in "${files[@]}"; do
  args+=(-f "$f")
done

if ! config="$(docker compose "${args[@]}" --profile '*' config --no-env-resolution --no-interpolate --format json)"; then
  echo "check-logging: docker compose config failed" >&2
  exit 1
fi

bad="$(printf '%s' "$config" | jq -r --argjson want "$want" '.services | to_entries | map(select(.value.logging != $want) | .key) | sort | join(" ")')"
if [ -n "$bad" ]; then
  echo "logging missing or different: $bad" >&2
  exit 1
fi

echo "logging ok: $(printf '%s' "$config" | jq -r '.services | keys | sort | join(" ")')"
