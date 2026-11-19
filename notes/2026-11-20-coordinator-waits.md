# Why the coordinator blocks, and how to stop it (2026-11-20)

Read-only study. No rule changed yet. The owner decides the proposal in § 4.

## 1. Cause

A Pi bash call is synchronous. While a command runs, the coordinator does nothing: no wake, no spawn, no reply.
Limen does not tell the coordinator to wait. The project rules and the coordinator's own habits do.

| Source | Rule | Effect |
|---|---|---|
| `spec/build.md` TRACK, "Land and review" | Before each `limen land`, in the job worktree: `git merge --no-edit master && bun run typecheck && bun run test:unit:ci` ("about 1 min"). | Now 130–190 s per land (worktree add, `bun install`, typecheck, unit). The coordinator waits for each one. |
| `spec/build.md` TRACK, same line | After each land: `gh run list --branch master --workflow CI --limit 3`. | The coordinator turned this into poll loops (`for i in $(seq 1 50); do gh run list …; sleep …`) up to 460 s. |
| `spec/build.md` NEXT, board scan | "A stage marked `VPS` is the coordinator's own run." | Releases and VPS checks run in the foreground, often with `sleep 240; ssh …`. |
| Coordinator habit | `sleep 290`, `timeout 2700 limen wait <job>` | Against the Limen manual. |

## 2. What the Limen author designed (`../limen/templates/agents.md`)

- Spawn is detached. Wakes tell the coordinator that a job finished. "Never poll with `sleep`."
- `limen wait` refuses under `LIMEN_COORDINATOR=1` "because it would block the conversation".
- Inline work only when "the native checks that cover it run in about a minute". Longer work is a job.
- `limen land` runs no tests. It checks only the ticket front matter and the `test/` line cap (`src/commands/land.ts`, `checkLandGates`).
- Limen F961 (`../limen/spec/features/planned/F961-…`, planned, not built) adds a land check inside `limen land`. Its design is synchronous too: the coordinator would still wait.

## 3. Measured cost (coordinator sessions 2026-11-14 to 2026-11-20)

Script: `/tmp/coordwait/scan.py` (time from the tool call to its result; approximate). 39 sessions, 1,602 tool calls, about 5.0 h of tool time.

| Kind | Calls | Time | Calls over 60 s |
|---|---|---|---|
| `sleep` and `limen wait` | 35 | 61 min | 28 |
| CI poll (`gh run list` loops) | 55 | 58 min | 22 |
| VPS deploy and checks | 93 | 44 min | 18 |
| Land check | 33 | 32 min | 17 |
| `limen land` itself | 54 | 4 min | 0 |

The land check is only the fourth cause. `sleep` and CI polling cost more.
Value of the land check (`notes/2026-11-15-harness-review.md`): 74 runs found 2 merge conflicts and 0 typecheck or unit failures. `limen land` also finds a merge conflict by itself. The check is insurance against the semantic merge break of 2026-11-14 (two branches green alone, master red together).

## 4. Proposal

The owner's idea is correct: the worker owns the tests, the coordinator only merges. One gap: master moves between the end of the worker and the land. The rules below close that gap without a foreground wait.

1. **The worker tests the merge.** The last step of each worker, repair and continue task: `git merge --no-edit master`, then `bun run typecheck && bun run test:unit:ci` and the stage lane, then commit. The final message names the master SHA it merged. Put it in a project worker preamble (`.agents/limen/worker.md`) so no task must repeat it.
2. **Fast path.** If `git merge-base --is-ancestor master <branch>` passes, the branch already holds the current master. The code that lands is the code the worker tested. The coordinator runs `limen land` at once, with no check.
3. **Master moved.** The coordinator starts `scripts/land-check.sh <job>` in the background (`nohup … &`) and goes on. The script merges master in the job worktree, runs the check, and writes `.limen/land-checks/<job>.out` with the tested master SHA and PASS or FAIL. `coord-scan.sh` lists the finished results. At the next turn the coordinator lands each PASS whose tested SHA is still master (else it runs the fast path or the script again). A FAIL becomes `limen continue <job>` with the log tail. The script lives in the repo, not in `/tmp/coord/`.
4. **CI.** No poll loops. `coord-scan.sh` prints the last three CI runs on master (one `gh run list` call, a few seconds). A red run → quarantine rule as today.
5. **VPS.** A release runs as `nohup deploy/release.sh <tag> > .limen/vps/<tag>.log 2>&1 &`; the next turn reads the log. Owner choice: keep that in the coordinator, or give it to a detached VPS job (Opus, as for other deploy work).
6. **No sleep.** A coordinator rule line: never `sleep`, never `limen wait`, never a loop that waits for CI or a job. The next wake or turn reads the state.
7. **Upstream.** Comment on Limen F961: a land check must not block the coordinator. A land queue that runs the check in the background and wakes the coordinator like a job would fit the Limen design.

Simpler variant: steps 1, 2, 4, 6 only. When master moved, land anyway and let CI on master catch a break, then revert. The data (0 failures in 74 checks) supports it, but it loses the insurance against a semantic merge break.

## 5. Changes this needs

- `spec/build.md` TRACK "Land and review": replace the land check sentence and the CI sentence (owner choice, so the owner approves).
- New `scripts/land-check.sh`; `scripts/coord-scan.sh` reads `.limen/land-checks/` and prints CI status.
- New `.agents/limen/worker.md` (copy of `../limen/templates/worker.md` plus the merge-and-test step).
