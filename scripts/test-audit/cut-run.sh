#!/usr/bin/env bash
# Cut run of the test audit: runs the given test files once, serial, with JUnit and lcov, per lane.
# Usage: bash scripts/test-audit/cut-run.sh <out dir> <test file>…
# Writes <out>/unit.xml and <out>/unit/lcov.info for the unit lane, <out>/int.xml and <out>/int/lcov.info for the
# int lane; a lane with no file writes nothing. A file in neither lane: exit 2 with its path, nothing runs.
# A failed lane does not stop the other lane; the script then exits 1 (as coverage.sh). The int lane needs the
# job DB (scripts/limen-prepare.sh). Prints no env value.
set -euo pipefail

out="${1:?usage: cut-run.sh <out dir> <test file>…}"
shift
[ "$#" -gt 0 ] || { echo "usage: cut-run.sh <out dir> <test file>…" >&2; exit 2; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$root"
mkdir -p "$out"

lanes="$(bun scripts/test-audit/cut-run.ts "$@")" || exit $?
read -r -a unit_files <<<"$(sed -n 's/^unit *//p' <<<"$lanes")"
read -r -a int_files <<<"$(sed -n 's/^int *//p' <<<"$lanes")"

status=0
if [ "${#unit_files[@]}" -gt 0 ]; then
  bun test "${unit_files[@]}" --timeout=30000 --reporter=junit --reporter-outfile="$out/unit.xml" \
    --coverage --coverage-reporter=lcov --coverage-dir="$out/unit" || status=1
fi
if [ "${#int_files[@]}" -gt 0 ]; then
  EA_TEST_WORKER_DB=1 bun test "${int_files[@]}" --timeout=30000 --reporter=junit --reporter-outfile="$out/int.xml" \
    --coverage --coverage-reporter=lcov --coverage-dir="$out/int" || status=1
fi
exit "$status"
