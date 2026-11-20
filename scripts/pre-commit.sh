#!/usr/bin/env bash
# Git pre-commit check (owner, 2026-11-20, notes/2026-11-20-test-cpu-load.md): fast, only what this commit touches.
#
#   1. ESLint (with Prettier) on the staged code files, with the cache of scripts/lint.sh.
#   2. Typecheck: server and core (incremental tsc); web (astro check) only when web files or core/src/web are staged, docs only for docs files.
#   3. Unit tests that import a file changed since HEAD (`bun test --changed=HEAD`).
#
# A commit with no staged code file (docs, spec, notes) and a merge commit skip the check.
# Integration tests, the full suites and the merge with master run once, at the end of the job: `bun run check:job`.
# Installed by scripts/install-hooks.sh into the shared .git/hooks, so every worktree runs it.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

git_dir=$(git rev-parse --git-dir)
[ -f "$git_dir/MERGE_HEAD" ] && exit 0

mapfile -t staged < <(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx|mts|js|mjs|astro)$' || true)
[ "${#staged[@]}" -eq 0 ] && exit 0

echo "pre-commit: lint ${#staged[@]} staged file(s)"
bun run lint --files "${staged[@]}"

echo "pre-commit: typecheck"
bun run --filter @ea/core --filter @ea/server typecheck
if printf '%s\n' "${staged[@]}" | grep -qE '^(apps/web/|packages/core/src/web/)'; then
  bun run --filter @ea/web typecheck
fi
if printf '%s\n' "${staged[@]}" | grep -qE '^apps/docs/'; then
  bun run --filter @ea/docs typecheck
fi

echo "pre-commit: unit tests that import a changed file"
bash scripts/test-unit-changed.sh HEAD
