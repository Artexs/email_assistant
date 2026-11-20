#!/usr/bin/env bash
# Checks that every service of the Compose files in deploy/ rotates its Docker log (10m, 5 files), and which driver it uses:
# `server` writes json-file (the files the log store reads); every other service writes `local`, so its lines never reach the store.
# It also fails when a document tells the reader to run a one-off command in `server` (`run ... server bun ...`): the `cli` service runs it.
# CHECK_LOGGING_DOCS (space-separated files) replaces the document list; the test uses it.
# Usage: bash deploy/check-logging.sh [compose file ...]. No arguments: deploy/compose.yaml and deploy/compose.dev.yaml, merged,
# then deploy/compose.sim.yaml on its own (the sim stack shares nothing with the production pair, so it is never merged with it).
# The restore drill (deploy/restore.sh) runs compose.yaml with compose.drill.yaml, with no profile but `cli`. That set is checked on
# its own and it follows other rules: `server` writes `local` too (the log store reads only json-file, so no drill line reaches it),
# and every service but db, server, cli and migrate sits behind a profile (the log store is in `ops`; the drill never starts it).
# `--drill <compose file ...>` checks the files as the drill set.
# A new Compose file in deploy/ must be added to one of the three lists below: without arguments the script fails until then.
# It never prints the Compose config, because the config can hold secrets. CI runs it (job `image`).
set -euo pipefail

want_collected='{"driver":"json-file","options":{"max-size":"10m","max-file":"5"}}'
want_local='{"driver":"local","options":{"max-size":"10m","max-file":"5"}}'
default_files=(compose.yaml compose.dev.yaml)
alone_files=(compose.sim.yaml)
drill_files=(compose.yaml compose.drill.yaml)
drill_mode=0

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
  bad="$(printf '%s' "$config" | jq -r --argjson collected "$want_collected" --argjson local "$want_local" --argjson drill "$drill_mode" '
    .services | to_entries | sort_by(.key)[]
    | if .key == "server" and $drill == 0 then select(.value.logging != $collected) | "logging: \(.key) must be json-file 10m 5"
      else select(.value.logging != $local) | "logging: \(.key) must be local 10m 5" end')"
  if [ -n "$bad" ]; then
    echo "$bad" >&2
    exit 1
  fi

  # `drill_extra`: the drill runs db and server, and cli on request (profile `cli`), nothing else. Every other service must sit
  # behind a profile that restore.sh never passes: a store service in the drill would collect or ship logs of the host.
  # (`config --no-interpolate` lists the services of every profile, so the profiles are read here.)
  if [ "$drill_mode" -eq 1 ]; then
    local drill_extra
    drill_extra="$(printf '%s' "$config" | jq -r '.services | to_entries[] | select(.key != "db" and .key != "server" and .key != "cli" and .key != "migrate") | select((.value.profiles // []) == [] or ((.value.profiles // []) | index("cli")) != null) | "check-logging: the drill must not run \(.key)"')"
    if [ -n "$drill_extra" ]; then
      echo "$drill_extra" >&2
      exit 1
    fi
  fi

  # `migrate` is a one-off too: behind the profile `cli`, so a plain `up` never starts a second copy of the server image.
  local migrate_bad
  migrate_bad="$(printf '%s' "$config" | jq -r '
    .services.migrate // empty
    | select((.profiles // []) != ["cli"])
    | "check-logging: migrate must have profiles [cli]"')"
  if [ -n "$migrate_bad" ]; then
    echo "$migrate_bad" >&2
    exit 1
  fi

  # The one-off service must stay behind its profile (a plain `up` would start a second server) and must have no healthcheck.
  local cli_bad
  cli_bad="$(printf '%s' "$config" | jq -r '
    .services.cli // empty
    | (if (.profiles // []) != ["cli"] then "check-logging: cli must have profiles [cli]" else empty end),
      (if (.healthcheck.disable // false) != true then "check-logging: cli healthcheck must be disabled" else empty end)')"
  if [ -n "$cli_bad" ]; then
    echo "$cli_bad" >&2
    exit 1
  fi

  # The log store services keep every log on the host (ADR 0024 point 5): they get no Docker socket, no host network,
  # no network but the default one, and vlagent sends only to victorialogs. One message per fault.
  local store_bad
  store_bad="$(printf '%s' "$config" | jq -r '
    (.services.victorialogs // empty | select(.network_mode != null)
      | "check-logging: victorialogs must not set network_mode"),
    (.services.vlagent // empty | select(.network_mode != null)
      | "check-logging: vlagent must not set network_mode"),
    (.services.victorialogs // empty | select(((.networks // {}) | keys) != ["default"] and ((.networks // {}) | keys) != [])
      | "check-logging: victorialogs must use the default network only"),
    (.services.vlagent // empty | select(((.networks // {}) | keys) != ["default"] and ((.networks // {}) | keys) != [])
      | "check-logging: vlagent must use the default network only"),
    (.services.vlagent // empty
      | select(([.volumes[]? | select(.target == "/var/lib/docker/containers") | select(.read_only == true and .source == "/var/lib/docker/containers")] | length) != 1
          or ([.volumes[]? | select(.target != "/var/lib/docker/containers" and .type != "volume")] | length) != 0
          or ([.volumes[]? | select(.target != "/var/lib/docker/containers")] | length) != 1)
      | "check-logging: vlagent volumes must be the read-only container-log mount and one named volume, nothing else"),
    (.services.vlagent // empty
      | select(([.command[]? | select(startswith("-remoteWrite.url=http://victorialogs:9428/"))] | length) != 1
          or ([.command[]? | select(startswith("-remoteWrite.url="))] | length) != 1)
      | "check-logging: vlagent must send only to http://victorialogs:9428/")')"
  if [ -n "$store_bad" ]; then
    echo "$store_bad" >&2
    exit 1
  fi

  local others
  if [ "$drill_mode" -eq 1 ]; then
    others="$(printf '%s' "$config" | jq -r '.services | keys | join(" ")')"
    echo "logging ok (drill): every service local; services: $others"
    return 0
  fi
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
    # A command that continues after a backslash counts as one line; the number is the first line of it.
    while IFS= read -r n; do
      [ -n "$n" ] || continue
      echo "check-logging: $f:$n: a one-off command runs in server; use \`run --rm cli\`" >&2
      found=1
    done < <(awk '
      { line = $0; if (start == 0) start = NR }
      /\\[ \t]*$/ { sub(/\\[ \t]*$/, " ", line); acc = acc line; next }
      { acc = acc line
        if (acc ~ /(^|[ \t])run[ \t]([^`]*[ \t])?(server[ \t]+([^`]*[ \t])?bun|bun[ \t]+server)([ \t]|$)/) print start
        acc = ""; start = 0 }
    ' "$path")
  done
  if [ "$found" -ne 0 ]; then
    exit 1
  fi
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" = "--drill" ]; then
  shift
  drill_mode=1
  [ "$#" -gt 0 ] || { echo "check-logging: --drill needs compose files" >&2; exit 1; }
fi

if [ "$#" -gt 0 ]; then
  check_set "$@"
  check_docs "$root"
  exit 0
fi

shopt -s nullglob
for path in "$root"/deploy/compose*.yaml "$root"/deploy/compose*.yml; do
  name="$(basename "$path")"
  known=0
  for d in "${default_files[@]}" "${alone_files[@]}" "${drill_files[@]}"; do
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
drill_mode=1
drilled=()
for d in "${drill_files[@]}"; do
  drilled+=("$root/deploy/$d")
done
check_set "${drilled[@]}"
drill_mode=0
check_docs "$root"
