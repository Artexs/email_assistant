#!/usr/bin/env bash
# ESLint with a cache (owner, 2026-11-20, notes/2026-11-20-worker-time-and-cpu.md).
#
#   scripts/lint.sh [eslint args]          cached: lints only files whose content changed since the last run
#   scripts/lint.sh --full [eslint args]   no cache: lints every file (CI and the land check)
#
# The cache lives in node_modules/.cache/eslint/ of this checkout (each worktree has its own).
# Its name is a hash of every input of the lint config: eslint.config.js, the local rules,
# the JSON files the config reads, the module folder list, the tsconfig files, package.json
# and bun.lock. A change to any of them starts a new cache.
# Limit: type-aware rules see other files' types. A type change in file A does not re-lint
# an unchanged file B, so a cached run can miss an error in B. `--full` (CI) finds it.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--full" ]; then
  shift
  exec eslint "$@" .
fi

dir=node_modules/.cache/eslint
key=$(
  {
    cat eslint.config.js package.json bun.lock \
      apps/server/src/modules/layers.json apps/server/src/scripts/cli-pending.json
    find tools/eslint-rules -type f -not -path '*/node_modules/*' | sort | xargs cat
    find . -name 'tsconfig*.json' -not -path '*/node_modules/*' -not -path './.git/*' | sort | xargs cat
    ls apps/server/src/modules
  } | sha1sum | cut -c1-16
)
mkdir -p "$dir"
find "$dir" -type f -not -name "$key" -delete
exec eslint --cache --cache-strategy content --cache-location "$dir/$key" "$@" .
