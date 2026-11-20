#!/usr/bin/env bash
# Unit tests for the files this branch changed (owner, 2026-11-20, notes/2026-11-20-worker-time-and-cpu.md).
#
#   scripts/test-unit-changed.sh [base] [bun test args]
#
# Runs `test:unit` with `bun test --changed=<base>`: only the unit test files that import a changed
# file, directly or through other files. Changed = committed on this branch since <base>, plus
# staged, unstaged and untracked files. Default base: the merge base of HEAD and master.
# Limit: Bun follows imports only. It does not see a changed shell script that a test starts or a
# data file read at run time. Run the full `bun run test:unit:ci` once before the final commit.
set -euo pipefail
cd "$(dirname "$0")/.."
base="${1:-}"
if [ -n "$base" ] && [ "${base#-}" = "$base" ]; then
  shift
else
  base=$(git merge-base HEAD master)
fi
exec bash scripts/ci-bun.sh run test:unit --changed="$base" "$@"
