#!/usr/bin/env bash
# Proves that the running server container holds none of the database keys (EA_D5_KEYS in deploy/compose-lib.sh).
# Usage (from the repo root): bash deploy/check-server-env.sh
# It reads the key names of `docker compose exec -T server env` and prints names only, never a value.
#   server env ok keys=<n>               exit 0
#   server env bad: <names>   (stderr)   exit 1; names sorted, comma list
#   Compose or exec failure, or no key   exit 2
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=deploy/compose-lib.sh
source deploy/compose-lib.sh

ea_compose_init || exit 2
listing="$("${EA_COMPOSE[@]}" exec -T server env)" || {
  echo "server env check failed: could not read the server env" >&2
  exit 2
}

# Names only: a line that starts with NAME= (a multi-line value has other lines; they do not count).
names="$(printf '%s\n' "$listing" | grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' | sed 's/=$//' || true)"
keys=0
[[ -n "$names" ]] && keys="$(printf '%s\n' "$names" | grep -c '')"
if ((keys == 0)); then
  echo "server env check failed: the server env has no keys" >&2
  exit 2
fi

bad=()
for key in "${EA_D5_KEYS[@]}"; do
  printf '%s\n' "$names" | grep -qx -- "$key" && bad+=("$key")
done
if ((${#bad[@]} > 0)); then
  echo "server env bad: $(printf '%s\n' "${bad[@]}" | sort | paste -sd, -)" >&2
  exit 1
fi
echo "server env ok keys=$keys"
