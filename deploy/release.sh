#!/usr/bin/env bash
# Deploys one tagged release on the VPS: deploy/release.sh v0.1.0. Runbook: deploy/README.md. Undo it with deploy/rollback.sh.
# Exit 2: refused, nothing changed. Exit 1: a step failed (after the `pending` mark: roll back). Never rolls back by itself (F114 D12).
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=deploy/release-lib.sh
source deploy/release-lib.sh

step=""
pending_written=0

on_exit() {
  local code=$?
  trap - EXIT
  if ((code != 0)) && [[ -n "$step" ]]; then
    if ((pending_written)); then
      echo "release failed at $step; roll back with deploy/rollback.sh" >&2
    else
      # Nothing changed yet. A rollback now would move to the previous release, so the message does not name it.
      echo "release failed at $step; nothing changed, no rollback needed" >&2
    fi
    exit 1
  fi
  exit "$code"
}
trap on_exit EXIT

refuse() {
  echo "release refused: $1" >&2
  exit 2
}

# The steps run from a function: git checkout rewrites the scripts of the new tag while bash still reads this file.
main() {
  # First: a host that is not split has the database keys in `.env`, so the server would start with them.
  local split_state
  split_state="$(ea_env_split_state)"
  [[ "$split_state" == split ]] || refuse "run deploy/env-split.sh first (state $split_state)"
  local tag="${1:-}"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || refuse "the tag must look like v<major>.<minor>.<patch>"
  local dirty
  dirty="$(git status --porcelain)"
  [[ -z "$dirty" ]] || refuse "the working tree is not clean"
  git fetch --tags
  local tag_commit
  tag_commit="$(git rev-parse -q --verify "refs/tags/$tag^{commit}" || true)"
  [[ -n "$tag_commit" ]] || refuse "tag $tag does not exist"
  git merge-base --is-ancestor "$tag_commit" origin/master || refuse "tag $tag is not on origin/master"
  local version
  version="$(git show "$tag:package.json" | sed -n 's/^  "version": "\(.*\)",$/\1/p' | head -n 1)"
  [[ "$version" == "${tag#v}" ]] || refuse "package.json at $tag says version '$version', not '${tag#v}'"
  state_load || exit 2
  [[ -z "$pending" ]] || refuse "release $pending is pending: run deploy/rollback.sh first"
  [[ "$tag" != "$current" ]] || refuse "$tag is the current release"

  step=backup
  local backup_out backup_last
  # stdout only: the last line is `backup ok ...`; a failed ping prints on stderr after it.
  backup_out="$(deploy/backup.sh)"
  echo "$backup_out"
  backup_last="$(printf '%s\n' "$backup_out" | tail -n 1)"
  [[ "$backup_last" == "backup ok"* ]]

  step=disk
  local min_free=$((3 * 1024 * 1024 * 1024))
  # A failed df or a non-number must stop the release: inside `if ((...))` an arithmetic error would only read as false.
  local free
  free="$(free_bytes)"
  [[ "$free" =~ ^[0-9]+$ ]]
  if ((free < min_free)); then
    docker builder prune -f
    free="$(free_bytes)"
    [[ "$free" =~ ^[0-9]+$ ]]
    ((free >= min_free))
  fi

  step=pending
  if [[ -z "$current" ]]; then
    # The first release: the running image becomes `pre-<tag>`, so a rollback has a target from here on.
    current="pre-$tag"
    current_commit="$(git rev-parse HEAD)"
  fi
  pending="$tag"
  state_write
  pending_written=1

  step=keep-image
  docker tag "$IMAGE:latest" "$IMAGE:$current"

  step=checkout
  git checkout --detach "$tag"

  # The only build. A later `--build` would stamp `dev`.
  step=build
  EA_RELEASE="$tag" "${COMPOSE_CMD[@]}" build server
  docker tag "$IMAGE:latest" "$IMAGE:$tag"

  # Forward only: there is no db:rollback (F114 P5). `compose run` has no --no-build flag; it builds only when the image is
  # missing, and step 6 has just made it.
  step=migrate
  EA_RELEASE="$tag" "${COMPOSE_CMD[@]}" run --rm -T migrate

  step=up
  EA_RELEASE="$tag" "${COMPOSE_CMD[@]}" up -d --no-build --wait

  step=verify
  EA_RELEASE="$tag" verify_release "$tag"
  # The running server must hold none of the database keys. Exit 1 (a key) and exit 2 (no env read) both fail the release.
  bash deploy/check-server-env.sh

  step=state
  previous="$current"
  previous_commit="$current_commit"
  current="$tag"
  current_commit="$tag_commit"
  pending=""
  state_write

  step=""
  prune_images
  echo "release ok $tag previous $previous"
}

free_bytes() {
  df -B1 --output=avail / | tail -n 1 | tr -d ' '
}

# Keeps the tags of `current` and `previous`. A failed removal only warns: the release is done.
prune_images() {
  local tag
  while read -r tag; do
    case "$tag" in v* | pre-*) ;; *) continue ;; esac
    if [[ "$tag" == "$current" || "$tag" == "$previous" ]]; then continue; fi
    docker rmi "$IMAGE:$tag" || echo "prune: could not remove $IMAGE:$tag" >&2
  done < <(docker images "$IMAGE" --format '{{.Tag}}')
}

# One line: bash parses it whole before git checkout can rewrite this file.
main "$@"; exit $?
