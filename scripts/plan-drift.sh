#!/usr/bin/env bash
# Shows how far the code moved since a plan was written.
# Usage: scripts/plan-drift.sh <ticket-folder> <plan-base-sha>
# Reads the repo paths named in plan.md and stages/*.md of the ticket folder.
# Prints the commits on HEAD after the base that touch those paths, and the
# named paths that existed at the base but are gone now.
# Exit 0: no drift. Exit 1: drift found (the plan needs a refresh). Exit 2: bad input.
set -euo pipefail

folder="${1:-}"
base="${2:-}"
if [[ -z "$folder" || -z "$base" || ! -f "$folder/plan.md" ]]; then
  echo "usage: scripts/plan-drift.sh <ticket-folder> <plan-base-sha>" >&2
  exit 2
fi
git rev-parse --verify --quiet "$base^{commit}" >/dev/null || { echo "unknown commit: $base" >&2; exit 2; }

mapfile -t named < <(cat "$folder/plan.md" "$folder"/stages/*.md 2>/dev/null \
  | grep -oE '(apps|packages|db|deploy|scripts|tools|evals)/[A-Za-z0-9_./-]+\.[A-Za-z]+' \
  | sort -u)

changed=()
gone=()
for path in "${named[@]}"; do
  if [[ -e "$path" ]]; then
    git diff --quiet "$base" HEAD -- "$path" || changed+=("$path")
  elif git cat-file -e "$base:$path" 2>/dev/null; then
    gone+=("$path")
  fi
done

echo "plan base: $(git log -1 --format='%h %ad' --date=format:'%Y-%m-%d %H:%M' "$base")"
echo "HEAD:      $(git log -1 --format='%h %ad' --date=format:'%Y-%m-%d %H:%M' HEAD)"
echo "named paths: ${#named[@]}; changed since base: ${#changed[@]}; gone: ${#gone[@]}"

if (( ${#changed[@]} == 0 && ${#gone[@]} == 0 )); then
  echo "no drift"
  exit 0
fi

for path in "${gone[@]}"; do echo "gone: $path"; done
for path in "${changed[@]}"; do echo "changed: $path"; done
echo "commits after the base that touch the named paths:"
git log --no-merges --format='  %h %ad %s' --date=format:'%m-%d %H:%M' "$base"..HEAD -- "${changed[@]}" "${gone[@]}"
exit 1
