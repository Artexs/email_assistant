# Limen SDLC review, 2026-11-11 to 2026-11-13

Input for F071 stage 2 ("adapt what real use shows"). Written 2026-11-13 by an audit session, not by a coordinator.

## Sources read

- `.limen/jobs/*` (69 job records: task, state, result, open-checks, log, session usage).
- Coordinator sessions: `~/.pi/agent/sessions/--home-artek-Documents-repos-email_assistant--/2026-11-12T01-41-29-509Z_01a1cd6a…` (F077 coordinator) and `2026-11-12T11-24-04-105Z_01a1cf80…` (F082 coordinator, still open).
- Other sessions of 11-11 to 11-13 in the same folder (planning, discovery, architecture).
- `git log` since 11-10, `gh run list` (CI), `spec/build.md`, F071/F077/F082 tickets and plans.
- Limen package: `~/Documents/repos/limen/templates/{agents,worker,reviewer}.md`, `docs/groups.md`.
- Session summaries made by the audit: `/tmp/limen-audit/coord-f077.txt`, `/tmp/limen-audit/coord-f082.txt` (temporary).

## What ran

| Item | Count / value |
| --- | --- |
| Job records | 69: 51 worker, 17 reviewer, 1 scout |
| Failed or stopped jobs | 6 (3 reviewer, 2 worker, 1 stopped on purpose) |
| Finished jobs "with open checks" | 39 of 66 |
| Features landed 11-12 to 11-13 | F041, F044, F045, F049, F059, F069, F070, F077 (17 stages), F079, F080, F083, F084, F082 stages 1–14 |
| Worker duration | 5–8 min per stage typical, 15–20 min max |
| Worker context | 30–120 K tokens (max 167 K) |
| F077, 17 stages, strictly sequential | 10:18 → 12:35 (2 h 17 min) on 11-12 |
| Longest waits | owner gates: 8 h (F077 deploy), 9.5 h (F082 checkpoint A, overnight) |
| F082 coordinator context | grew about 15 K tokens per stage; 368 K before the first compaction (11-13 09:33) |
| Reviews with a real blocker | 4: F079 B1, F082 s04 (test gap), F082 s05 (enumeration gap, passed with fixes), F082 checkpoint A B1 |
| CI on master | red since 2026-11-08 (last green run 11-08 00:58); 160+ red runs since |

## How the flow works now (observed)

1. **Thread start.** The owner opens a pi session per purpose and pastes "Read handoff X and follow Start here". Planning, discovery, architecture and coordination are separate sessions. The coordinator is a pi session with `LIMEN_COORDINATOR=1` (`pil` alias).
2. **Plan or build.** No explicit triage step. Small tickets go from `planned/` to a worker with a short task. Epics (S6a, S6b) go through `plan-task` in a separate Opus session: ticket + `plan.md` + 15–18 stage files + cold review (scout job) + owner OK. Then the owner tells the coordinator "Build FNNN".
3. **Build loop.** One worker job per stage, mostly in sequence (F082 ran 2 at a time where the plan allowed it). The worker runs the plan's Proof chain and writes logs to `/tmp/<feature>-sNN/`.
4. **Verification.** Three modes were used, chosen ad hoc:
   - No review: all F077 stages, all small tickets. The coordinator read the diff and either re-ran the full suite itself (F077 s1–s5, about 3 min each) or read the worker's `/tmp` logs.
   - Per-stage Opus review for `[risky]` stages (F082 plan § Review: 1, 3–9, 13).
   - Checkpoint/group review: F077 group review (PASS, 4 minors → F083), F082 checkpoint A (FAIL B1), F082 checkpoint B (PASS, 2026-11-13).
5. **Repair.** `limen continue <job>` with the findings, then a second review. Max 2 rounds was kept.
6. **Land.** `limen land --keep-open` per stage, `git push` by the local post-commit hook. Job DBs dropped by hand.

## What works well

- **Workers are cheap and fast.** Detailed stage files make a stage a 5–8 minute, 50–100 K token job. Workers did not tour the repo.
- **Risk-based review pays off.** Every real blocker came from a review: 4 of 11 reviews on risky code found one. Checkpoint A found a cross-stage defect (B1) that the per-stage reviews of stages 3 and 5 did not see. Keep both layers for risky epics.
- **Repair through `limen continue`** keeps the worker's context. Fix jobs were 5–7 min.
- **Durable state.** When the owner closed the F077 coordinator, the second coordinator continued from the ticket's "Progress and how to continue" section without loss.
- **Coordinator on Sonnet medium** was enough for the routine wake → inspect → land → spawn cycle. Opus for reviews was the right split.
- **The coordinator stopped at real gates** (deploy, VPS, `.env`) and asked once.

## Problems, by cost

### P1. No automatic gate: CI has been red for 5 days (high)

- Every landing since 11-08 went to master with red CI. A new failure is invisible in a red pipeline.
- Proof: F049 (STARTTLS) landed after its review job failed twice ("process group gone", then "No API key found for openai-codex"). The coordinator landed it on the worker's logs. Its tests `apps/server/src/modules/mail/imap/smtp-starttls.test.ts` now fail in CI with 5 s timeouts (run 43401630040).
- Older CI failures: `runSend > 3: a lost response is repeated…`, `AgentMail fake > holdResponseNext…` (5 s timeouts).
- **Fix:** do F093 (CI green, quarantine rule) before more feature work. Then make "CI green on the candidate branch" the land gate, and stop the coordinator's own full-suite re-runs.

### P2. Proof is not tied to a commit (high)

- Workers write proof logs to shared `/tmp/<name>/`. Reviewers were told "Do not run test:int or test:e2e" (shared GreenMail and e2e ports), so 5 reviews reported "I cannot tie the worker's int.log to this tree".
- So no independent party ran the integration tests at the candidate SHA, except the coordinator's ad hoc runs.
- **Fix:** one script `scripts/proof.sh <out-dir>` that writes `git rev-parse HEAD` and `git status --porcelain` first, then the chain, into the job folder (not `/tmp`). Reviewers check the SHA line. Better: CI on the `limen/*` branch is the proof.

### P3. Shared test infrastructure forces a lock (high)

- `test:int` and `test:e2e` share GreenMail and ports 8081/8092, so every plan adds `flock /tmp/email-assistant-shared-tests.lock`.
- Effects: reviewers cannot run integration tests; F082 s13 was killed by Limen's 180 s idle watchdog while it waited on the lock (job `2026-11-13-f082-s6b-s13-28cbe67e`); parallel jobs queue behind one lock.
- **Finding, 2026-11-13 (later the same day):** the `test:int` lock is a leftover of the shared-DB time. GreenMail tests use random addresses. Proof: 3 full `bun run test:int` runs at the same time, each on its own DB from `db:worktree`: each 1501 pass, 0 fail, about 174 s (a single run takes about 170 s). Only `test:e2e` shares something real: the fixed ports 8081 and 8092.
- **Done:** `CLAUDE.md` § Rules now allows parallel `test:int` with an own DB and keeps the lock for `test:e2e` only. The `plan-task` skill (`references/plan-shape.md` § Proof) says the same and adds: workers run only related tests while they work; the full chain runs once as the Proof; reviewers may run `test:int`.
- **Open:** give each job its own e2e ports in `scripts/limen-prepare.sh` to remove the last lock. `docs/product/stage-2/05-execution-plan.md` line 170 still has the old rule (another session has that file open with changes; update it after they commit). The F082 plan keeps its lock rule (only stage 15 is left).

### P4. Open checks are mostly noise (medium)

- 39 of 66 jobs ended "with open checks". 48 of 87 open-check lines are Limen's parser messages ("names no command or file in backticks", "no proof that … ran"). It also flags reviewers' `PASS <sha>` lines.
- Workers broke the "one `&&` call, no pipe, no `;`" proof rule again and again (F077 s1–s5).
- The coordinator then spends a turn on each, or re-runs suites.
- **Fix:** `scripts/proof.sh` (P2) gives one command to name; put the note format and the proof rule in `.agents/limen/reminders.md` once. That file was planned in F071 stage 2 and does not exist; today each `plan.md` repeats the rules.

### P5. The coordinator grows too large and does work it should not (medium)

- One coordinator session ran for 22 h, with 87 user turns and 258 model calls, and reached 368 K context. Each wake re-reads all of it.
- It ran full test chains itself with `sleep 100`/`sleep 240` polls (Limen manual: "Never poll with sleep").
- It committed a code fix on master without review: `a27d8d4` (`apps/server/src/scripts/org-plan.ts`).
- **Fix:** one coordinator session per epic; at each checkpoint, write state to the ticket and start a fresh session. The coordinator does not run suites (CI does) and does not edit product code; a fix is a job.

### P6. Review policy lives in four places that disagree (medium)

- F071 decision D5: review every candidate. `spec/build.md`: reviewer = Sonnet high. F082 `plan.md`: Opus review for risky stages only. Limen default: review when the blast radius is expensive. Practice: F077 had no per-stage review; F082 used Opus.
- **Fix:** one "Review policy" bullet in `spec/build.md` TRACK (proposal below). Delete the others.

### P7. Owner gates dominate wall-clock time (medium)

- F077 waited 8 h for the deploy OK; F082 waited 9.5 h for "go" after checkpoint A. The owner then said "yes for all".
- The deploy gate is necessary. The checkpoint-A gate was a review gate that also waited for the owner, and stages 10–12 (UI, not risky) could have run during the wait.
- **Fix:** in `plan-task`, an owner checkpoint only before real systems (VPS, real mailbox, real bot, `.env`) and irreversible steps. Other checkpoints are review gates: PASS → continue without the owner.

### P8. Launch hazards (low, but each cost a round trip)

- `limen continue` without the route flags fell back to `openai-codex/gpt-6-astra` and failed at once (twice). A short label (`F041`) matched two jobs.
- A stage was spawned before the stage before it landed (F077 s11 had the wrong base; stopped and respawned).
- `limen land` with the failed parent id instead of the continue id (F082 s13).
- **Fix:** a wrapper `scripts/limen-job.sh {spawn|continue|review}` that always adds the board's route and `--prepare`, or set `LIMEN_WORKER_MODEL`/`LIMEN_REVIEWER_MODEL` in the `pil` alias. Always use the full job id.

### P9. Many sessions write the same checkout (low)

- 8–11 discovery sessions and an architecture session committed to master while the coordinator landed. Two sessions created F085 at the same time (one was renamed to F093). The main checkout now holds untracked files of other sessions (`git status`: 8 untracked folders under `spec/features/planned/`, `docs/…`).
- Limen expects the coordinator's checkout to stay clean.
- **Fix:** research and discovery sessions work in their own worktree or as Limen researcher jobs; they commit through the coordinator.

### P10. Readiness and collisions are guessed (low)

- The F077 coordinator chose "ready" tickets by grepping for "blocked". F041 and F044 then conflicted in `actions/constants.ts` and `send.ts` (one extra merge job).
- Tickets do not use the `touches:` front matter that Limen supports. Stage 2 now adds `## Sequenced`.
- **Fix:** fill `touches:` in `plan-task` and when a ticket moves to active; start two tickets in parallel only when their `touches` differ.

### P11. Small gaps

- Per-stage review verdicts are not filed as `review-N.md` in the feature folder (only checkpoint/group reviews are). F079 has no review file. Limen's manual says to file each verdict.
- No quality pass ran (Limen: after ten landings; 47 landed). `spec/quality/` does not exist.
- Job DBs are dropped by hand, one command per job.
- The board's TRACK does not name the coordinator model.

## Proposed loop (one change set)

1. **Plan** (unchanged): `plan-task` for epics, short ticket for small work. Add `touches:`. Owner checkpoints only before real systems.
2. **Build:** one worker per stage. Up to 2–3 workers in parallel when `touches` differ, after P3.
3. **Proof:** `scripts/proof.sh` in the worker, output in the job folder with the SHA. CI runs on the `limen/*` branch.
4. **Review policy** (one bullet in `spec/build.md`):
   - No review job: docs, tests only, config, UI without auth, any diff under ~100 lines outside `[risky]` areas. Gate = CI green + coordinator reads the diff.
   - Per-slice review (Opus high): `[risky]` areas (auth, tenant isolation, sends, migrations, exactly-once, LLM prompts). Reviewer may run `test:int` after P3.
   - Epic checkpoint review (Opus high): after the schema/core stages and before the deploy. Review gate, not owner gate.
   - Max 2 rounds; a third FAIL goes to the owner.
5. **Land:** only with CI green on the candidate. File every verdict as `review-N.md`.
6. **Coordinator:** one session per epic; fresh session at each checkpoint; no product-code edits; no test runs with `sleep`.
7. **After each epic:** quality pass job; drop job DBs with one sweep command.

## Order of work (proposal)

1. F093 CI green + quarantine rule (P1). Pause new feature landings until it is green, or land only with a local full run tied to the SHA.
2. `scripts/proof.sh` + `.agents/limen/reminders.md` (P2, P4).
3. Per-job GreenMail and ports in `limen-prepare.sh`, remove the lock (P3).
4. `spec/build.md`: review policy, coordinator model, wrapper or env defaults (P6, P8).
5. `plan-task` skill: owner checkpoints only for real systems; `touches:` (P7, P10).

## Owner decisions needed

- D-a: Stop feature landings until CI is green (recommended), or continue in parallel with F093?
- D-b: Accept the review policy of "Proposed loop" step 4?
- D-c: Owner checkpoints only before real systems and irreversible steps?
