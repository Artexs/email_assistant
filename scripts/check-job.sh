#!/usr/bin/env bash
# The one test run of a job (owner, 2026-11-20, notes/2026-11-20-test-cpu-load.md). Run it as the last step: `bun run check:job`.
#
#   1. Merge master into this branch (stops on a conflict: resolve, commit, run again).
#   2. ESLint (cached) on the code files this branch changed.
#   3. Typecheck of every workspace.
#   4. Unit and integration tests that import a file this branch changed (`bun test --changed=master`), four processes each.
#      Four processes, each with its own clean database (`EA_TEST_WORKER_DB=1`, `apps/server/test/worker-db.ts`).
#      A server file pulls in most integration files, because they import the whole app.
#      A change to a migration, package.json, bun.lock, bunfig.toml, a tsconfig or the test preload runs the full suite.
#      Bun follows imports only, so a change to a docs page, a legal file or a docs source runs every test that reads the docs
#      (`docs_tests` below): such a test reads the file at run time and the import graph does not show it.
#      A change under apps/web/src, packages/core/src or apps/server/src also runs the docs text check (apps/docs/src/panel-keys.test.ts):
#      it reads the panel files at run time and the import graph does not show it.
#   5. The bare-code scan (apps/server/src/bare-codes.test.ts), on every run: a code can come from the merge with master.
#
# The pre-commit hook (scripts/pre-commit.sh) checked each commit; GitHub CI runs every suite on master after the land.
# The last line names the master SHA and the tip: copy it into the final message.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "check:job: commit or stash your changes first" >&2
  exit 1
fi

master=$(git rev-parse master)
if ! git merge-base --is-ancestor "$master" HEAD; then
  echo "check:job: merge master $(git rev-parse --short=10 master)"
  git merge --no-edit master || {
    echo "check:job: merge conflict. Resolve it, commit, and run check:job again." >&2
    exit 1
  }
fi

mapfile -t changed < <(git diff --name-only --diff-filter=ACMR "$master" HEAD)
mapfile -t code < <(printf '%s\n' "${changed[@]}" | grep -E '\.(ts|tsx|mts|js|mjs|astro)$' || true)
full_re='^(db/migrations/|package\.json$|bun\.lock$|bunfig\.toml$|.*tsconfig[^/]*\.json$|apps/server/test/(preload|worker-db|db-script)\.ts$)'
full=0
printf '%s\n' "${changed[@]}" | grep -E "$full_re" >/dev/null && full=1

# A change under docs/ or apps/docs/ runs every test file that reads those folders at run time (found by its text).
docs_changed=0
printf '%s\n' "${changed[@]}" | grep -E '^(docs/|apps/docs/)' >/dev/null && docs_changed=1

echo "check:job: lint ${#code[@]} changed code file(s)"
bun run lint --files "${code[@]}"

echo "check:job: typecheck"
bun run typecheck

if [ "$full" = 1 ]; then
  echo "check:job: a migration, package or test setup file changed: full unit and integration suites"
  bun run test:unit:ci
  bun run test:int:ci
else
  echo "check:job: unit tests that import a changed file"
  bash scripts/ci-bun.sh test --parallel=4 --timeout=30000 --changed="$master" deploy/test apps/web/e2e/lib packages/core apps/server/src \
    tools/fake-telegram/src tools/llm-replay/src tools/mail-oauth-spike apps/web/src/lib apps/web/src/i18n apps/web/integrations apps/docs/src apps/docs/integrations apps/docs/scripts
  echo "check:job: integration tests that import a changed file"
  EA_TEST_WORKER_DB=1 bash scripts/ci-bun.sh test --parallel=4 --timeout=30000 --changed="$master" apps/server/test tools/fake-telegram/test
fi

panel_changed=0
printf '%s\n' "${changed[@]}" | grep -E '^(apps/web/src/|packages/core/src/|apps/server/src/)' >/dev/null && panel_changed=1

if [ "$panel_changed" = 1 ] && [ "$full" = 0 ]; then
  echo "check:job: panel changed: panel-keys.test.ts"
  bash scripts/ci-bun.sh test apps/docs/src/panel-keys.test.ts
fi

if [ "$docs_changed" = 1 ] && [ "$full" = 0 ]; then
  mapfile -t docs_tests < <(grep -rlE 'docs/|content/docs' --include='*.test.ts' apps/docs apps/server/src apps/web/src/lib | sort)
  echo "check:job: docs changed: ${#docs_tests[@]} test file(s) that read the docs folders"
  bash scripts/ci-bun.sh test --parallel=4 --timeout=30000 "${docs_tests[@]}"
fi

echo "check:job: bare-code scan"
bash scripts/ci-bun.sh test apps/server/src/bare-codes.test.ts

echo "check:job PASS master=$(git rev-parse --short=10 "$master") tip=$(git rev-parse --short=10 HEAD) full=$full"
