#!/usr/bin/env bash
# Coverage run of the test audit: lcov of the unit suite and of the int suite, serial.
# Usage: bash scripts/test-audit/coverage.sh <out dir>   (writes <out dir>/unit/lcov.info and int/lcov.info)
# Same paths as run-suites.sh. Prints no env value.
set -euo pipefail

out="${1:?usage: coverage.sh <out dir>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$root"
mkdir -p "$out"

paths_of() {
  bun -e '
    import { suitePaths } from "./scripts/test-audit/junit";
    const pkg = await Bun.file("package.json").json();
    console.log(suitePaths(pkg.scripts[process.argv[1]]).join(" "));
  ' "$1"
}

read -r -a unit_paths <<<"$(paths_of test:unit)"
read -r -a int_paths <<<"$(paths_of test:int)"

bun test "${unit_paths[@]}" --coverage --coverage-reporter=lcov --coverage-dir="$out/unit"
bun test "${int_paths[@]}" --coverage --coverage-reporter=lcov --coverage-dir="$out/int"
