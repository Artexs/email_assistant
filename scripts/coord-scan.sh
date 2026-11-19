#!/usr/bin/env bash
# Coordinator board scan: for each active ticket, list its stages as LANDED, RUNNING or OPEN with the
# "Needs" line of each OPEN stage. Run at every wake; start every OPEN stage whose needs are met.
# LANDED = a commit subject on master says "F<n> stage <nn>" or "F<n>-s<nn>"; RUNNING = a running job label
# holds "F<n>-s<nn>" or "F<n> stage <nn>". It reads only git and `limen jobs`; it changes nothing.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
subjects=$(git log master --format=%s -n 4000 | grep -vi "carry-over")
running=$(limen jobs --running 2>/dev/null | grep RUNNING || true)
for dir in spec/features/active/F*/; do
  ticket=$(basename "$dir" | cut -d- -f1)
  [ -d "$dir/stages" ] || continue
  printf '== %s %s\n' "$ticket" "$(basename "$dir" | cut -c1-60)"
  for f in "$dir"stages/stage-*.md; do
    n=$(basename "$f" | sed -E 's/^stage-([0-9]+[a-z]?)-.*/\1/')
    low=$(printf '%s' "$ticket" | tr 'F' 'f')
    state=OPEN
    if printf '%s\n' "$subjects" | grep -qiE "(^|[^0-9])${ticket}( stage |-s| s)0*${n}([^0-9a-z]|$)"; then state=LANDED; fi
    if printf '%s\n' "$running" | grep -qiE "${ticket}[- ]s(tage )?0*${n}([^0-9a-z]|$)"; then state=RUNNING; fi
    if [ "$state" = OPEN ]; then
      needs=$(sed -n '3,4p' "$f" | tr '\n' ' ' | grep -oE 'Needs[^.]*\.|Build this stage only[^.]*\.' | head -n 1)
      printf '  %-5s %-8s %s\n' "$n" "$state" "${needs:-}"
    else
      printf '  %-5s %s\n' "$n" "$state"
    fi
  done
done
# PARKED = the ticket id is in `## PARKED` of spec/build.md: never plan or build it until the owner moves it to NEXT.
parked=$(sed -n '/^## PARKED/,/^## /p' spec/build.md | grep -oE 'F[0-9]+' | sort -u)
echo "== planned tickets without a plan folder:"
for d in spec/features/planned/F*/; do
  [ -f "$d/plan.md" ] && continue
  id=$(basename "$d" | cut -d- -f1)
  mark=""
  printf '%s\n' "$parked" | grep -qx "$id" && mark=" PARKED (do not plan)"
  printf '  %s%s\n' "$(basename "$d" | cut -c1-70)" "$mark"
done
