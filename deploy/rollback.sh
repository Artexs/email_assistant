#!/usr/bin/env bash
# Goes back to the last good release with no rebuild: deploy/rollback.sh. Runbook: deploy/README.md.
# Target: `current` when a release is pending (it broke), else `previous`. The schema stays: no migration step (F114 P5).
# Exit 2: refused, nothing changed. Exit 1: a step failed, the state file stays as it was.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=deploy/release-lib.sh
source deploy/release-lib.sh

step=""

on_exit() {
  local code=$?
  trap - EXIT
  if ((code != 0)) && [[ -n "$step" ]]; then
    echo "rollback failed at $step; the state file is unchanged" >&2
    exit 1
  fi
  exit "$code"
}
trap on_exit EXIT

refuse() {
  echo "rollback refused: $1" >&2
  exit 2
}

# From a function for the same reason as in release.sh: git checkout rewrites the scripts.
main() {
  [[ -f "$STATE_FILE" ]] || refuse "no release state ($STATE_FILE)"
  state_load || exit 2
  local target target_commit
  if [[ -n "$pending" ]]; then
    target="$current"
    target_commit="$current_commit"
  else
    target="$previous"
    target_commit="$previous_commit"
  fi
  [[ -n "$target" && -n "$target_commit" ]] || refuse "no target release in the state"
  docker image inspect "$IMAGE:$target" >/dev/null 2>&1 || refuse "image $IMAGE:$target is missing"

  step=tag-image
  docker tag "$IMAGE:$target" "$IMAGE:latest"

  step=checkout
  git checkout --detach "$target_commit"

  step=up
  # A `pre-*` image has no stamp: the build arg stays at its default.
  local release="$target"
  [[ "$target" == pre-* ]] && release=dev
  EA_RELEASE="$release" "${COMPOSE_CMD[@]}" up -d --no-build --wait

  step=verify
  verify_release "$target"

  step=state
  if [[ -n "$pending" ]]; then
    pending=""
  else
    local swap="$current" swap_commit="$current_commit"
    current="$previous"
    current_commit="$previous_commit"
    previous="$swap"
    previous_commit="$swap_commit"
  fi
  state_write

  step=""
  echo "rollback ok $target"
}

main "$@"; exit $?
