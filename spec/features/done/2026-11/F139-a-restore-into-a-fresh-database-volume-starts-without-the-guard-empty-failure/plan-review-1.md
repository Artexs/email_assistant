PASS 076a673b1e89b0042a382652a7e2353ba8ffcb35

No blocking findings. A live container run confirms the core decision (D1, TCP readiness inside the container). The stub test design fails on the old script and passes on the new one. The notes below are gaps the coordinator can close before the worker starts. None of them breaks a ticket acceptance bullet.

HEAD check: `git rev-parse HEAD` = 076a673b1e89b0042a382652a7e2353ba8ffcb35, which matches the candidate. Clean tree.

## Unverified

- Stage 02 on the VPS: not run. It is a coordinator step.
- I did not prototype the stage 01 stub test, so its effect on the existing suite is checked by reading the code only (see N2).

## Pre-mortem: which stage would let a bug through

- **A restore on a fresh volume still fails.** D1 rules this out. The temporary init server never answers on TCP, and the final server does; my container run below proved it. The only remaining exposure is the 60-probe bound (N5). A real slow init would show `restore failed at db-ready` and would not restore over data. Stage 01 tests 1 and 3 cover both paths.
- **A restore goes over data.** `guard-empty` still runs after the wait (plan.md:17 D5, stage-01:9). A volume that holds data answers TCP at once, and the guard refuses with exit 2 (stage-01 test 4, plan.md:24). Even a query that reached the init server would read 0 tables on a fresh volume (my run: `q=0` during the init), so it is not an over-data risk.
- **The drill touches the live stack.** Stage 01 adds only `"${C[@]}" exec` calls, and test 5 asserts `-p ea-drill` and `stdin=0`. Stage 02 has the one weak point: a leftover drill volume in a fresh clone (N1). The documented cleanup refuses there, so the coordinator would improvise a cleanup by hand near the live volumes.

## Notes

**N1: plausible gap. Stage 02 step 2 cannot run as written in a fresh clone.** stage-02-vps-drill-rerun.md:12 says: "In a fresh clone at the release tag: if a `deploy/drill.env` or an `ea-drill` volume is left from earlier, run `deploy/restore.sh --target drill --down` first."
- A fresh clone has no `deploy/drill.env`.
- `--down` calls `set_compose`, which refuses without that file (`deploy/restore.sh:105`). The existing test "--down without deploy/drill.env exits 2" (`deploy/test/restore.test.ts:443`) shows this.
- So a leftover `ea-drill_db-data` volume cannot be removed by the stated command. The step also gives no way to detect the volume.
- A coordinator would guess. One option is `--init-env`, then `--down`, then `--init-env` again. The other is a raw `docker volume rm` or `docker compose -p … down -v` typed by hand next to the live volumes.
- Fix: name the detect command (`docker volume ls --filter name=ea-drill_`) and the exact cleanup sequence. Better still, put the check in step 3 (`--init-env`) and stop if the volume exists.

**N2: plausible ambiguity. "Existing tests pass" conflicts with "call lists gain the probe" (stage-01-tcp-wait.md:24).**
- `deploy/test/restore.test.ts:487-490` (test 4b, new-host) asserts the docker call kinds equal exactly `["up", "exec"]`. With the probe, the list becomes `["up", "exec", "exec"]`, so 4b fails unless it is edited.
- plan.md:47 says "A gap or a deviation from a decision is a question in the final message, not a choice". A strict Sonnet worker may stop instead of editing 4b.
- Fix: state that test 4b's call list gets the probe `exec`. The drill order list in test 3 (`restore.test.ts:246-259`) needs no edit, because the probe is not in it.

**N3: plausible conflict between two rules across tickets.**
- plan.md:34 and F108 `stage-05-contract.md:40` say the F139 readiness test "passes unchanged" after F108 stage 05.
- F108 `stage-05-contract.md:39` adds: "`restore.sh --target new-host` with state `old` → exit 2 before any `docker` call".
- The new-host fixture in the shared `beforeEach` writes `.env` with `POSTGRES_PASSWORD=live-pg` and makes no `deploy/db.env` (`restore.test.ts:63`). That is not state `split`.
- F139 stage-01 test 2 (`--target new-host`, stage-01:29) will therefore exit 2 after F108 stage 05, unless F108 changes the shared fixture.
- Fix: in one of the two plans, say that F108 stage 05 may change the shared new-host fixture to a split host but not the bodies of the F139 tests.

**N4: fact without a source. It contradicts D1, and it leads to an unbounded runbook loop.**
- plan.md:15 (D3) says README § First install "step 5 (`db:migrate` over TCP) has the same race on a fresh volume".
- `db:migrate` is `dbmate … --wait migrate` (`package.json:100`), and it connects over TCP. By D1's own premise, and by my container run, the init server never answers on TCP. So dbmate retries until the final server is up, and step 5 has no race.
- stage-01:40 still adds `until $C exec -T db pg_isready … -h 127.0.0.1 …; do sleep 1; done` to `deploy/README.md` step 4. That loop is harmless, but it has no bound: if the database never starts, it spins forever.
- Fix: drop the line, or bound it, and correct the reason in D3.
- Ticket scope bullet 2 ("every other script that starts `db` on a fresh volume") is then met by stating that no other deploy script needs the wait. `release.sh` and `rollback.sh` run on a live volume. `package.json` `db:up` and `dev:up` are dev only.

**N5: plausible. The bound is counted in probes, not seconds.**
- D2 (plan.md:14) uses 60 probes, `sleep 1` between them, and the message `did not answer on TCP in 60 s`.
- Each probe is a `docker compose exec`, which costs about 0.3–1 s on a host. The real bound is therefore about 80–120 s, and the message can state a wrong time.
- This is cosmetic. Either word the message as "after 60 probes", or measure elapsed `SECONDS`.

**N6: plausible. README edits may conflict on land with F108 stage 03.**
- stage-01:3 plans a land conflict only for `deploy/restore.sh`, with F108 stage 01.
- F139 stage 01 also edits `deploy/README.md` § First install, § New host step 6 and § VPS lost. F108 stage 03 rewrites § New host step 3 and the `C=` line (`stage-03-adr-docs.md:29`), and the board lets F108 stage 03 run in parallel (`spec/build.md:30`).
- The same "merge master, keep both, re-prove" rule should name the README too.

**N7: note. In practice, D7 makes stage 02 a follow-up almost every time.**
- stage-02:3 and plan.md:19 say: "if no such release exists when stage 01 lands, file a follow-up ticket".
- A release that carries stage 01 is by definition cut after stage 01 lands, so the condition is nearly always true at land time.
- This matches the ticket's owner rule (ticket.md:26), so it is not a conflict. The coordinator should expect the follow-up, and known-alerts will stay at "drill rerun pending" until then.

## Facts confirmed

- **postgres:17 entrypoint.** `docker run --rm --entrypoint sh postgres:17 -c '…'` printed:
  - `postgres (PostgreSQL) 17.11`
  - line 297 `-c listen_addresses=''`
  - line 370 `init process complete`
  - line 384 `exec "$@"`
  - `postgresql.conf.sample:60 listen_addresses = '*'`

  This matches plan.md:31.
- **The race and the fix, reproduced live.** I ran postgres:17 with `--network none` and a 4 s init script, and probed with `docker exec … pg_isready` on the socket and with `-h 127.0.0.1`, every 0.3 s.
  - Probes 4–12: `sock=0 tcp=2`, and the `pg_tables` query returned `0` (the init server).
  - Probe 13: `tcp=0`.
  - All five `select 1` calls after that returned `1`.
  - The log showed the temporary server "listening on Unix socket" only, then "shutting down", then "PostgreSQL init process complete", then the final server "listening on IPv4 address 0.0.0.0".

  This proves D1. It also proves that the rejected option (a) in D1 (two queries with a pause) would hit the init server.
- **Code checks.**
  - `deploy/restore.sh:177-183` matches plan.md:33.
  - `deploy/compose.yaml:31-34` health check is socket-only, with interval 2 s and retries 15.
  - `deploy/compose.drill.yaml:46-47` overrides only `restart` for `db`.
- **The before-change check (stage-01:34) separates old from new.** In the old script, the stub's `pg_tables` exits 2, and `set -e` on the assignment at `restore.sh:183` makes `on_exit` print `restore failed at guard-empty` and exit 1, as planned.
- **The `sleep` stub works.** `bash -c 'type -t sleep'` printed `file`, so a stub on `PATH` takes the place of `sleep`.
- **F108 consistency.** F108 `stage-05-contract.md:3,31` keeps the wait after `up -d --wait db` and puts the new-host guard before it. This is consistent with D5 apart from N3.
- **Size.** `wc -w` gives plan.md 1179 (limit 1500), stage-01 683 (limit 700) and stage-02 439. All are within `.agents/limen/planner.md:47`. Each stage fits one job.

## Checks run

- `git rev-parse HEAD`: the candidate sha. Saved to `.limen/jobs/2026-11-19-f139-plan-review-b04ca2be/head.log`.
- The postgres:17 entrypoint grep (above).
- The live race reproduction (above). I removed the container and the temp directory afterwards.
- `bash -c 'type -t sleep'`: `file`.
- No `bun` test suite run. The plan's code does not exist yet, so a green run of the existing suite would prove nothing about this plan.

## Note check

- Verdict line and HEAD equals candidate: proven. `git rev-parse HEAD > /home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-19-f139-plan-review-b04ca2be/head.log && cat …/head.log` exited 0 and printed 076a673b1e89b0042a382652a7e2353ba8ffcb35.
- Each finding quotes file and line, has a label, and decisions are checked against restore.sh, restore.test.ts, compose.yaml, the postgres:17 entrypoint and the F108 stages: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-19-f139-plan-review-b04ca2be/review-draft.md` (N1–N7 with paths and lines).
- Pre-mortem answered: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-19-f139-plan-review-b04ca2be/review-draft.md` (Pre-mortem line) and the § Pre-mortem section above.
- Easy-to-miss rule ("Missing code detail … is not a finding; a missing decision, edge case, test or interface is"): followed. In `review-draft.md`, each of N1–N7 names a missing decision, edge case, test or interface (cleanup path, test 4b contract, cross-ticket fixture interface, unsourced fact, bound semantics, land-conflict rule, follow-up timing). None names only line numbers, edit text or file lists.
