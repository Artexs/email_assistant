#!/usr/bin/env bash
# Parallel Playwright check: N job worktrees run `bun run test:e2e` at the same time, M of them run `bun run docs:test` at the
# same time, no lock, and every run must pass. Run it again after a Playwright or Chromium upgrade.
#
# Usage: bash scripts/e2e-parallel-check.sh --e2e-runs N --docs-runs M --rounds R --out DIR
#   N, M: 0-4 (not both 0). R: 1-5. DIR: where the run logs go (`<suite>-round-<r>-run-<n>.log`, `prepare-<n>.log`).
#
# It makes max(N, M) temp worktrees at HEAD once, prepares each (`limen-prepare.sh`: own DB, own e2e DB, own ports, own mail
# tag), builds once per worktree, then runs the R e2e rounds, then the R docs rounds (the two suites never overlap: memory).
# Each run's peak RSS is the sum over its process tree, sampled every 0.5 s.
# It CREATES AND DROPS DATABASES on the dev Postgres (`db:worktree`, two per worktree) and makes and removes git worktrees.
# A trap cleans up on any exit and lists a drop that failed. It prints no `.env` line and no URL.
# Output: one line per run (`<suite> round r run n exit c start end peak_mb`, start and end in epoch seconds), the peak
# memory per suite, and `PARALLEL_OK` when every run exited 0 and the runs of every round overlap in time.
set -uo pipefail

usage() {
  cat >&2 <<'EOF'
usage: bash scripts/e2e-parallel-check.sh --e2e-runs N --docs-runs M --rounds R --out DIR
  N, M: 0-4 (not both 0)   R: 1-5   DIR: log folder
EOF
  exit 2
}

e2e_runs="" docs_runs="" rounds="" out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --e2e-runs) e2e_runs="${2:-}"; shift 2 || usage ;;
    --docs-runs) docs_runs="${2:-}"; shift 2 || usage ;;
    --rounds) rounds="${2:-}"; shift 2 || usage ;;
    --out) out="${2:-}"; shift 2 || usage ;;
    *) usage ;;
  esac
done
[[ "$e2e_runs" =~ ^[0-4]$ && "$docs_runs" =~ ^[0-4]$ && "$rounds" =~ ^[1-5]$ && -n "$out" ]] || usage
[[ "$e2e_runs" != 0 || "$docs_runs" != 0 ]] || usage

caller="$(git rev-parse --show-toplevel)" || { echo "e2e-parallel-check: not in a git checkout" >&2; exit 1; }
root="${LIMEN_CONTEXT_ROOT:-$(git worktree list --porcelain | awk 'NR==1{print $2}')}"
if [[ "$(pwd -P)" == "$(cd "$root" && pwd -P)" ]]; then
  echo "e2e-parallel-check: refusing to run in the main checkout ($root)" >&2
  exit 1
fi
cd "$caller"
mkdir -p "$out"
out="$(cd "$out" && pwd -P)"

count=$(( e2e_runs > docs_runs ? e2e_runs : docs_runs ))
tmp="$(mktemp -d)"
today="$(date +%F)"
declare -a wt_dirs=() db_names=() wrappers=()

kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  local code=$? pid wt name failed=()
  trap - EXIT INT TERM
  for pid in "${wrappers[@]:-}"; do [[ -n "$pid" ]] && kill_tree "$pid"; done
  for wt in "${wt_dirs[@]:-}"; do
    [[ -n "$wt" ]] && git worktree remove --force "$wt" > /dev/null 2>&1
  done
  rm -rf "$tmp"
  git worktree prune
  for name in "${db_names[@]:-}"; do
    [[ -n "$name" ]] || continue
    bun run db:worktree "$name" --drop > "$out/drop-$name.log" 2>&1 || failed+=("$name")
  done
  if [[ ${#failed[@]} -gt 0 ]]; then
    echo "e2e-parallel-check: DB drop failed for: ${failed[*]} (run bun run db:worktree <name> --drop; see $out/drop-*.log)" >&2
    [[ $code -eq 0 ]] && code=1
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

export LIMEN_CONTEXT_ROOT="$root"
echo "== before round 1 =="
free -m
uptime
echo "HEAD $(git rev-parse HEAD)"

for ((i = 1; i <= count; i++)); do
  hex="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
  job="$today-parallel-$hex"
  wt="$tmp/wt-$i"
  git worktree add --detach "$wt" HEAD > "$out/prepare-$i.log" 2>&1 || { echo "e2e-parallel-check: git worktree add failed (see $out/prepare-$i.log)" >&2; exit 1; }
  wt_dirs+=("$wt")
  db_names+=("$today-$hex")
  # The worktree has no .env or node_modules yet; prepare makes both. Its output is names and ports only.
  if ! (cd "$wt" && LIMEN_JOB_ID="$job" bash scripts/limen-prepare.sh) >> "$out/prepare-$i.log" 2>&1; then
    echo "e2e-parallel-check: prepare failed for worktree $i (see $out/prepare-$i.log)" >&2
    exit 1
  fi
  if [[ $i -le $e2e_runs ]] && ! (cd "$wt" && bun run web:build) > "$out/build-web-$i.log" 2>&1; then
    echo "e2e-parallel-check: web:build failed for worktree $i (see $out/build-web-$i.log)" >&2
    exit 1
  fi
  if [[ $i -le $docs_runs ]] && ! (cd "$wt" && bun run docs:build) > "$out/build-docs-$i.log" 2>&1; then
    echo "e2e-parallel-check: docs:build failed for worktree $i (see $out/build-docs-$i.log)" >&2
    exit 1
  fi
  echo "worktree $i ready ($job)"
done

# Sum of the RSS (MB) of a process and all its descendants.
tree_rss_mb() {
  ps -eo pid=,ppid=,rss= | awk -v root="$1" '
    { ppid[$1] = $2; rss[$1] = $3; pids[NR] = $1 }
    END {
      keep[root] = 1
      do { grew = 0; for (k in pids) { p = pids[k]; if (!(p in keep) && (ppid[p] in keep)) { keep[p] = 1; grew = 1 } } } while (grew)
      for (p in keep) sum += rss[p]
      printf "%d\n", sum / 1024
    }'
}

# One run: the suite in a worktree, with no lock and a clean port and DB env, so that the worktree `.env` decides.
# Writes `<exit> <start> <end> <peak_mb>` to the result file.
run_one() {
  local wt="$1" script="$2" log="$3" result="$4" start end peak=0 now pid code
  start="$(date +%s.%N)"
  (cd "$wt" && exec env -u E2E_PORT -u E2E_TELEGRAM_PORT -u DOCS_TEST_PORT -u E2E_MAIL_TAG -u E2E_DATABASE_URL \
    -u E2E_MIGRATOR_DATABASE_URL -u DATABASE_URL -u MIGRATOR_DATABASE_URL bun run "$script") > "$log" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    now="$(tree_rss_mb "$pid")"
    [[ "$now" -gt "$peak" ]] && peak="$now"
    sleep 0.5
  done
  wait "$pid"; code=$?
  end="$(date +%s.%N)"
  printf '%s %s %s %s\n' "$code" "$start" "$end" "$peak" > "$result"
}

all_ok=1
declare -A peaks=()

# `<suite>` is e2e or docs; `<runs>` the number of worktrees used; `<script>` the package script.
run_rounds() {
  local suite="$1" runs="$2" script="$3" r n code start end peak min_end max_start
  for ((r = 1; r <= rounds; r++)); do
    wrappers=()
    for ((n = 1; n <= runs; n++)); do
      run_one "${wt_dirs[n-1]}" "$script" "$out/$suite-round-$r-run-$n.log" "$out/$suite-round-$r-run-$n.result" &
      wrappers+=("$!")
    done
    wait "${wrappers[@]}"
    wrappers=()
    min_end=""; max_start=""
    for ((n = 1; n <= runs; n++)); do
      read -r code start end peak < "$out/$suite-round-$r-run-$n.result" || { code=99; start=0; end=0; peak=0; }
      echo "$suite round $r run $n exit $code start $start end $end peak_mb $peak"
      [[ "$code" == 0 ]] || all_ok=0
      peaks[$suite]+="$peak "
      if [[ -z "$min_end" ]] || awk -v a="$end" -v b="$min_end" 'BEGIN{exit !(a<b)}'; then min_end="$end"; fi
      if [[ -z "$max_start" ]] || awk -v a="$start" -v b="$max_start" 'BEGIN{exit !(a>b)}'; then max_start="$start"; fi
    done
    if ! awk -v s="$max_start" -v e="$min_end" 'BEGIN{exit !(s<e)}'; then
      echo "$suite round $r: the runs did not overlap in time"
      all_ok=0
    fi
  done
}

[[ $e2e_runs -gt 0 ]] && run_rounds e2e "$e2e_runs" test:e2e
[[ $docs_runs -gt 0 ]] && run_rounds docs "$docs_runs" docs:test

for suite in e2e docs; do
  [[ -n "${peaks[$suite]:-}" ]] || continue
  # shellcheck disable=SC2086
  printf '%s\n' ${peaks[$suite]} | sort -n | awk -v s="$suite" '
    { v[NR] = $1 }
    END { med = (NR % 2) ? v[(NR + 1) / 2] : (v[NR / 2] + v[NR / 2 + 1]) / 2; printf "peak %s max_mb %d median_mb %d runs %d\n", s, v[NR], med, NR }'
done

if [[ $all_ok == 1 ]]; then
  echo PARALLEL_OK
else
  echo "PARALLEL_FAILED (see the run logs in $out)"
  exit 1
fi
