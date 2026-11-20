#!/usr/bin/env bash
# Mutation run of packages/core (Stryker) in a work folder outside the repo.
# Usage: bash scripts/test-audit/mutation.sh <out dir> [--mutate <glob>]... [--with-static]
# Default mutate: src/**/*.ts, not *.test.ts and not *.test-helper.ts (test support code). Copies mutation.json and mutation.log to <out dir>.
# Static mutants (module-level code, about 36 % of the core mutants at 2026-11-20) are ignored by default: each one
# runs the whole suite (about 19 CPU seconds), which is tens of CPU hours for core. --with-static tests them too.
# Installs only in the work folder (never bun add / bun install in the repo); an EXIT trap removes it.
# One run at a time: a lock file in /tmp (waits up to 2 hours, then exits 3).
# Prints no env value.
set -euo pipefail

usage() {
  echo "usage: mutation.sh <out dir> [--mutate <glob>]... [--with-static]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
out="$1"
shift

globs=()
ignore_static=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mutate)
      [[ $# -ge 2 ]] || usage
      globs+=("$2")
      shift 2
      ;;
    --with-static)
      ignore_static=false
      shift
      ;;
    *) usage ;;
  esac
done
if [[ ${#globs[@]} -eq 0 ]]; then
  globs=('src/**/*.ts' '!src/**/*.test.ts' '!src/**/*.test-helper.ts')
fi

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "$node_major" -lt 22 ]]; then
  echo "mutation.sh: Stryker needs Node 22 or higher; found $(node --version)" >&2
  exit 1
fi

# One Stryker run at a time (concurrency 8 fills the machine): the lock is held until this script exits, and
# it comes before the copy of the sources so that a run which waited still tests the current files.
lock=/tmp/email-assistant-mutation.lock
exec 9>"$lock"
if ! flock -n 9; then
  echo "mutation.sh: waiting for the mutation lock" >&2
  if ! flock -w 7200 9; then
    echo "mutation.sh: mutation lock busy for 2 hours" >&2
    exit 3
  fi
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
mkdir -p "$out"
out="$(cd "$out" && pwd -P)"

base="${XDG_CACHE_HOME:-$HOME/.cache}/ea-test-audit"
mkdir -p "$base"
work="$(mktemp -d "$base/mutation.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# Stryker runs the tests in $work/.stryker-tmp/sandbox-*: from there the relative paths of two core tests
# (CHANGELOG.md, evals/sim/lab-01) end in $work, so those files are copied to $work (no holdout data).
proj="$work"
mkdir -p "$work/evals/sim/lab-01"
cp -r "$root/packages/core/src" "$work/src"
cp "$root/packages/core/tsconfig.json" "$work/tsconfig.json"
cp "$root/tsconfig.base.json" "$work/tsconfig.base.json"
sed -i 's#"extends": *"[^"]*"#"extends": "./tsconfig.base.json"#' "$work/tsconfig.json"
cp "$root/CHANGELOG.md" "$work/CHANGELOG.md"
cp "$root/evals/sim/lab-01/scenario.json" "$root/evals/sim/lab-01/sent-plan-spec.json" "$work/evals/sim/lab-01/"

zod_range="$(cd "$root" && bun -e 'const p = await Bun.file("packages/core/package.json").json(); console.log(p.dependencies.zod);')"
cat >"$proj/package.json" <<EOF
{
  "name": "core-mutation",
  "private": true,
  "type": "module",
  "dependencies": { "zod": "$zod_range" },
  "devDependencies": {
    "@stryker-mutator/core": "10.1.1",
    "@hughescr/stryker-bun-runner": "1.6.0",
    "typescript": "5.9.3"
  }
}
EOF

globs_json="$(printf '%s\n' "${globs[@]}" | bun -e 'const t = await Bun.stdin.text(); console.log(JSON.stringify(t.split("\n").filter(Boolean)));')"
cat >"$proj/stryker.conf.mjs" <<EOF
export default {
  appendPlugins: ['@hughescr/stryker-bun-runner'],
  testRunner: 'bun',
  mutate: $globs_json,
  reporters: ['json', 'clear-text', 'progress-append-only'],
  concurrency: 8,
  disableBail: true,
  ignoreStatic: $ignore_static,
  timeoutMS: 20000,
  bun: { timeout: 300000 },
  tempDirName: '.stryker-tmp',
};
EOF

cd "$proj"
bun install >"$work/install.log" 2>&1 || {
  cat "$work/install.log" >&2
  exit 1
}

status=0
npx stryker run >"$work/mutation.log" 2>&1 || status=$?

if [[ -f "$proj/reports/mutation/mutation.json" ]]; then
  cp "$proj/reports/mutation/mutation.json" "$out/mutation.json"
fi
cp "$work/mutation.log" "$out/mutation.log"
if [[ "$status" -ne 0 ]]; then
  echo "mutation.sh: stryker exited $status; see $out/mutation.log" >&2
  exit "$status"
fi
echo "mutation.sh: wrote $out/mutation.json"
