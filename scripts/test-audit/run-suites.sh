#!/usr/bin/env bash
# Timing run of the test audit: the unit and the int suite, serial, one JUnit file each.
# Usage: bash scripts/test-audit/run-suites.sh <out dir>   (writes <out dir>/unit.xml and int.xml)
# Reads the paths of `test:unit` and `test:int` from package.json. Prints no env value.
set -euo pipefail

out="${1:?usage: run-suites.sh <out dir>}"
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

bun test "${unit_paths[@]}" --reporter=junit --reporter-outfile="$out/unit.xml"
bun test "${int_paths[@]}" --reporter=junit --reporter-outfile="$out/int.xml"
