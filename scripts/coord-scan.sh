#!/usr/bin/env bash
# Coordinator board scan. For each active ticket, and for each planned ticket with a landed plan, list its
# stages as LANDED, RUNNING or OPEN with the "Needs" line of each OPEN stage. An OPEN stage carries a mark
# when the coordinator runs it (VPS), when it waits for an owner step (OWNER) or when it is [risky]; a bare
# OPEN is a stage a worker can start. Planned tickets show their Build after tickets (done or open) and the
# drift check against the plan base. Run at every wake; start every OPEN stage whose needs are met.
# LANDED = a commit subject on master says "F<n> stage <nn>" or "F<n>-s<nn>" before its colon (a subject that only
# mentions another ticket's stage does not count); RUNNING = a running job label
# holds "F<n>-s<nn>" or "F<n> stage <nn>". It reads only git, `limen jobs` and files; it changes nothing.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
subjects=$(git log master --format=%s -n 4000 | grep -vi "carry-over")
running=$(limen jobs --running 2>/dev/null | grep RUNNING || true)
# PARKED = the ticket id that starts a bullet of `## PARKED` in spec/build.md (not an id named inside a line).
parked=$(sed -n '/^## PARKED/,/^## /p' spec/build.md | grep -oE '^- `F[0-9]+' | grep -oE 'F[0-9]+' | sort -u)

stage_marks() {
  # Marks from the first 4 lines of a stage file.
  local head4
  head4=$(sed -n '1,4p' "$1")
  local marks=""
  printf '%s' "$head4" | grep -qiE 'coordinator run|on the VPS|VPS:|\bVPS\b' && marks="$marks VPS"
  printf '%s' "$head4" | grep -qiE 'owner step|Gate: owner|needs the owner' && marks="$marks OWNER"
  printf '%s' "$head4" | grep -v 'Not `\[risky\]`' | grep -qF '[risky]' && marks="$marks risky"
  printf '%s' "$marks"
}

list_stages() {
  local dir="$1" ticket="$2"
  for f in "$dir"stages/stage-*.md; do
    [ -f "$f" ] || continue
    n=$(basename "$f" | sed -E 's/^stage-([0-9]+[a-z]?)-.*/\1/')
    state=OPEN
    if printf '%s\n' "$subjects" | grep -qiE "^[^:]*${ticket}( stage |-s| s)0*${n}([^0-9a-z]|$)"; then state=LANDED; fi
    if printf '%s\n' "$running" | grep -qiE "${ticket}[- ]s(tage )?0*${n}([^0-9a-z]|$)"; then state=RUNNING; fi
    if [ "$state" = OPEN ]; then
      needs=$(sed -n '1,6p' "$f" | tr '\n' ' ' | perl -ne 'if (/((?:Needs|Build this stage only).*?\.)(?:\s|$)/) { print $1; exit }')
      printf '  %-5s %-8s%s %s\n' "$n" "$state" "$(stage_marks "$f")" "${needs:-}"
    else
      printf '  %-5s %s\n' "$n" "$state"
    fi
  done
}

sequenced_line() {
  # Build after tickets of ## Sequenced, each marked done or open.
  local dir="$1" line out=""
  # Only the first sentence: a later sentence often names a ticket that gates later stages, not the start.
  line=$(sed -n '/^## Sequenced/,/^## /p' "$dir/ticket.md" | grep -iE '^- \*?\*?Build after' | head -n 1 | perl -pe 's/^(.*?\.)(?:\s.*)?$/$1/')
  for id in $(printf '%s' "$line" | grep -oE 'F[0-9]+' | sort -u); do
    if ls -d spec/features/done/*/"$id"-* >/dev/null 2>&1; then out="$out $id:done"; else out="$out $id:open"; fi
  done
  printf '%s' "${out:- none}"
}

drift_state() {
  local dir="$1" base
  base=$(grep -oE 'Plan base:? *`?[0-9a-f]{7,}' "$dir/plan.md" 2>/dev/null | head -n 1 | grep -oE '[0-9a-f]{7,}$')
  [ -n "$base" ] || base=$(sed -n '/^## Sequenced/,/^## /p' "$dir/ticket.md" | grep -oE 'plan base [0-9a-f]{7,}' | head -n 1 | grep -oE '[0-9a-f]{7,}$')
  if [ -z "$base" ]; then printf 'drift: no base'; return; fi
  if ls "$dir"/plan-refresh-*.md >/dev/null 2>&1; then
    newbase=$(grep -oE 'Plan base:? *`?[0-9a-f]{7,}' "$dir/plan.md" | head -n 1 | grep -oE '[0-9a-f]{7,}$')
    [ -n "$newbase" ] && base="$newbase"
  fi
  bash scripts/plan-drift.sh "$dir" "$base" >/dev/null 2>&1
  case $? in
    0) printf 'drift: none (base %s)' "$base" ;;
    1) printf 'drift: NEEDS REFRESH (base %s)' "$base" ;;
    *) printf 'drift: unknown base %s' "$base" ;;
  esac
}

for dir in spec/features/active/F*/; do
  ticket=$(basename "$dir" | cut -d- -f1)
  [ -d "$dir/stages" ] || continue
  printf '== %s %s (active)\n' "$ticket" "$(basename "$dir" | cut -c1-60)"
  list_stages "$dir" "$ticket"
done

echo "== planned tickets with a landed plan (start them when Build after is all done and drift is none or the refresh landed):"
for dir in spec/features/planned/F*/; do
  [ -d "$dir/stages" ] || continue
  ticket=$(basename "$dir" | cut -d- -f1)
  mark=""
  printf '%s\n' "$parked" | grep -qx "$ticket" && mark=" PARKED"
  printf '== %s %s (planned%s) · build after:%s · %s\n' "$ticket" "$(basename "$dir" | cut -c1-50)" "$mark" "$(sequenced_line "$dir")" "$(drift_state "$dir")"
  list_stages "$dir" "$ticket"
done

echo "== land checks (scripts/land-check.sh; PASS with master unchanged → limen land; FAIL → continue the job):"
bash scripts/land-check.sh --status

echo "== CI on master, last 3 runs (read only; never wait for a run):"
timeout 20 gh run list --branch master --workflow CI --limit 3 \
  --json status,conclusion,headSha,createdAt \
  -q '.[] | "  \(.status) \(.conclusion // "-") \(.headSha[0:10]) \(.createdAt)"' 2>/dev/null || echo "  gh run list failed or took over 20 s"

echo "== planned tickets without stages (needs plan unless PARKED; 'plan after' from ## Sequenced):"
for d in spec/features/planned/F*/; do
  [ -d "$d/stages" ] && continue
  id=$(basename "$d" | cut -d- -f1)
  mark=""
  printf '%s\n' "$parked" | grep -qx "$id" && mark=" PARKED (do not plan)"
  after=$(sed -n '/^## Sequenced/,/^## /p' "$d/ticket.md" 2>/dev/null | grep -iE 'Plan after' | head -n 1 | sed -E 's/^- \*?\*?Plan after:?\*?\*? *//' | cut -c1-90)
  printf '  %s%s · plan after: %s\n' "$(basename "$d" | cut -c1-60)" "$mark" "${after:-?}"
done
