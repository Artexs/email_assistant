#!/usr/bin/env bash
# Land check that never blocks the coordinator (owner rule 2026-11-20, notes/2026-11-20-coordinator-waits.md).
#
#   scripts/land-check.sh <job-id|unique suffix>   returns in seconds:
#       "land now"  the branch already holds the current master; the worker tested that merge
#       "started"   master moved; the check runs in the background; coord-scan.sh shows the result
#   scripts/land-check.sh --status                 one line per check of a branch that is not landed yet
#
# The background check merges master into the job branch in its worktree, then runs
# `bun run typecheck` only (owner, 2026-11-20, notes/2026-11-20-test-cpu-load.md): the worker ran `bun run check:job`
# and GitHub CI runs every suite on master. The result goes to .limen/land-checks/<job>.out:
#   PASS <job> master=<sha> tip=<sha> <time>      land it while master is still <sha>
#   FAIL <job> master=<sha> <reason> log=<path>   continue the job with the log tail
set -u
root=$(git rev-parse --show-toplevel) || exit 2
dir="$root/.limen/land-checks"
mkdir -p "$dir"

short() { git -C "$root" rev-parse --short=10 "$1"; }

resolve_job() {
  local want="$1" hits
  if [ -d "$root/.limen/jobs/$want" ]; then printf '%s' "$want"; return 0; fi
  hits=$(cd "$root/.limen/jobs" && ls -d -- *"$want" 2>/dev/null)
  if [ "$(printf '%s\n' "$hits" | grep -c .)" -ne 1 ]; then
    echo "land-check: no single job matches '$want'" >&2
    return 1
  fi
  printf '%s' "$hits"
}

status() {
  local master f line job branch tested
  master=$(short master)
  for f in "$dir"/*.out; do
    [ -f "$f" ] || continue
    job=$(basename "$f" .out)
    branch=$(cat "$root/.limen/jobs/$job/branch" 2>/dev/null) || continue
    git -C "$root" rev-parse --verify -q "refs/heads/$branch" >/dev/null || continue
    line=$(head -n 1 "$f")
    case $line in
      PASS*)
        tested=$(printf '%s' "$line" | grep -oE 'master=[0-9a-f]+' | cut -d= -f2)
        if [ "$tested" = "$master" ]; then echo "  $line · master unchanged: land now"
        else echo "  $line · master moved: run scripts/land-check.sh $job again"; fi ;;
      *) echo "  $line" ;;
    esac
  done
}

run_check() {
  local job="$1" out="$dir/$1.out" log="$dir/$1.log" wt branch master temp="" reason="" tip
  exec 9>"$dir/$job.lock"
  flock -n 9 || exit 0
  branch=$(cat "$root/.limen/jobs/$job/branch")
  wt=$(cat "$root/.limen/jobs/$job/worktree" 2>/dev/null)
  master=$(short master)
  : >"$log"
  printf 'RUNNING %s master=%s since %s\n' "$job" "$master" "$(date -u +%H:%MZ)" >"$out"
  if [ -z "$wt" ] || [ ! -d "$wt" ]; then
    # The job worktree is gone (pruned): check in a temporary one and remove it after.
    wt="$dir/wt/$job"
    temp=1
    git -C "$root" worktree prune
    git -C "$root" worktree add -q "$wt" "$branch" >>"$log" 2>&1 || reason="worktree add failed"
  fi
  if [ -z "$reason" ] && [ -n "$(git -C "$wt" status --porcelain --untracked-files=no)" ]; then
    reason="the worktree has uncommitted changes"
  fi
  if [ -z "$reason" ] && ! git -C "$wt" merge --no-edit master >>"$log" 2>&1; then
    git -C "$wt" merge --abort >/dev/null 2>&1
    reason="merge conflict with master"
  fi
  if [ -z "$reason" ]; then
    (cd "$wt" && bun install --frozen-lockfile >>"$log" 2>&1) || reason="bun install failed"
  fi
  if [ -z "$reason" ]; then
    (cd "$wt" && bun run typecheck >>"$log" 2>&1) || reason="typecheck failed"
  fi
  tip=$(git -C "$wt" rev-parse --short=10 HEAD 2>/dev/null)
  if [ -z "$reason" ]; then
    printf 'PASS %s master=%s tip=%s %s\n' "$job" "$master" "$tip" "$(date -u +%H:%MZ)" >"$out"
  else
    printf 'FAIL %s master=%s %s log=%s\n' "$job" "$master" "$reason" "$log" >"$out"
  fi
  [ -n "$temp" ] && git -C "$root" worktree remove --force "$wt" >/dev/null 2>&1
  exit 0
}

case "${1:-}" in
  "") sed -n '2,13p' "$0"; exit 2 ;;
  --status) status; exit 0 ;;
  --run) run_check "$2" ;;
esac

job=$(resolve_job "$1") || exit 2
state=$(cat "$root/.limen/jobs/$job/state" 2>/dev/null)
case $state in
  done*) ;;
  *) echo "land-check: job $job is '$state', not done"; exit 2 ;;
esac
branch=$(cat "$root/.limen/jobs/$job/branch")
if git -C "$root" merge-base --is-ancestor master "$branch"; then
  echo "land now: $branch already holds master $(short master); the worker tested that merge"
  exit 0
fi
if ! flock -n "$dir/$job.lock" true; then
  echo "running: a check for $job runs already; coord-scan.sh shows its result"
  exit 0
fi
setsid nohup bash "$root/scripts/land-check.sh" --run "$job" >/dev/null 2>&1 </dev/null &
echo "started: master moved; the check runs in the background; result in $dir/$job.out"
