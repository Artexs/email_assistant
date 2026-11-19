# Coordinator handoff (2026-11-19)

For a new Limen coordinator of the `email_assistant` repo. Read this, then `spec/build.md`, `docs/owner-decisions.md` (the coordinator is the only writer; end each reply with `Owner decisions: N new` from `grep -c ' · new$' docs/owner-decisions.md`) and run `bash scripts/coord-scan.sh`.

## First steps
1. `export PATH=/home/artek/.local/share/mise/installs/node/26.13.0/bin:$PATH`, work in `/home/artek/Documents/repos/email_assistant`.
2. `limen status` and `limen jobs --running`. Subscribe to the running jobs so their finish pings reach you: `limen watch --running` (not tested by the previous coordinator; if a finished job does not wake you, poll `limen jobs --running` every few minutes).
3. `bash scripts/coord-scan.sh`: start every OPEN stage whose "Needs" are met (not only the next stage of the ticket that just finished). PARKED tickets (F129, F136, ...) are never planned or built until the owner moves them.

## Owner orders in force
- No cap on parallel builders; planner cap is three. Only one migration in build at a time (timestamp later than the newest in `db/migrations`).
- Owner checkpoints and steps in a plan are NOT a stop: use plan defaults. VPS, ssh and deploy are pre-approved (backup first, name the rollback target, verify after). Stop only for an API key or secret, real money beyond approved, deletion of real data, outside publication.
- Real LLM spend of the lab: cap $1 per run, only where a plan allows it. Tests use fakes.
- The VPS (`ssh -o BatchMode=yes home_vm`, 192.168.1.198) was unreachable ("No route to host"). Blocks: release v0.2.1 deploy, F110 s26, F107 s07, F102 s20, F113 and F114 s09, F119 s15.
- F118: stages after 05 build before checkpoint A (real phone test) because of the owner rule; the flag `web_push` stays off and no F118 code deploys before checkpoint A passes (`spec/features/active/F118-*/checkpoint-a.md`).
- Reply style: first line is the answer, never a feature number; plain technical English (ASD-STE100), short sentences; end with an overview (finished, running with job ids, waiting on the owner); on a job-wake turn say which job it was and what it did.

## Worker routes
- Builder: `limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge --prepare 'bash scripts/limen-prepare.sh' --label "Fnnn-sNN name · Fnnn" "$(cat /tmp/coord/<brief>.txt)"`. Write long briefs with a quoted heredoc. Old briefs are in `/tmp/coord/s-*.txt`; reuse their tail (rules list).
- Opus reviewer for risky stages: `--model claude-opus-5-5 --review --detached --branch <B> --label "review sNN · Fnnn (...)"`; briefs in `/tmp/coord/*review*.txt`. Planners: `--role planner --model claude-opus-5-5 --thinking medium --timeout 3h`, no `--prepare`. `limen continue <id>` needs provider flags, takes no `--prepare`.
- Never `limen wait`; no tool call over 120 s; never kill processes by name; never print `.env`; commit by explicit paths; do not touch the owner's untracked files (`notes/decision-docs/`, `notes/2026-11-14-*`).

## Land protocol (every finished job)
1. Read the final message. Scout and plan-review wakes ("The subscribed coordinator is busy"): no action, the planner handles them. Scouts are leads, not facts.
2. Decide each open check yourself (many are detector artifacts: "no proof that X ran" when the worker named the log).
3. Risky stages (migrations, privacy, send path, security, money): Opus review before landing. FAIL: write `review-N.md` in the ticket folder with the final fix decisions, `limen continue` the repair, land after landcheck without a second review if the fix is mechanical, else a narrow re-review. PASS with gaps: land, and put the gaps in the next stage file as "First commit of this stage".
4. `df -i /tmp` (inode quota; if above 85% delete finished `/tmp/*-rev` scratch and `/tmp/coord/wt-*`), `git worktree prune`, then `nohup bash /tmp/coord/landcheck.sh <branch> > /tmp/coord/lc-x.out 2>&1 &`, sleep, read: `typecheck=0 unit=0` means land. CONFLICT: resolve in a temporary worktree (`git worktree add /tmp/coord/wt-x <branch>`), keep both sides of added blocks, typecheck, commit, remove the worktree, rerun.
5. `limen land <job-id> --yes --keep-open` for every job whose label names a ticket that has more stages (a missing `--keep-open` closed tickets by accident before). Single-job tickets land without `--keep-open`.
6. Drop the job DBs: `bun run db:worktree <YYYY-MM-DD-<hash>> --drop`. After a migration lands run `bun run db:migrate` on the dev DB.
7. A legal text or registry change needs a `TERMS_VERSION` bump: workers do not bump; they write the one-line `TERMS_HISTORY` entry in a question file and the coordinator adds it (done for 2026-11-18 and 2026-11-18-2). Log it in `docs/owner-decisions.md`.

## State at handoff

### Running jobs
```
RUNNING F134 one-click needs DKIM coverage (risky: migration, Opus review after) · F134 · id 2026-11-18-f134-one-click-needs-dkim-covera-028c1344 · branch limen/2026-11-1
RUNNING F135 data-request match: one address rule · F135 · id 2026-11-18-f135-data-request-match-one-addr-bed9b10e · branch limen/2026-11-18-f135-data-request-match-one-a
RUNNING F120-s05 suggestions (risky: Opus review after) · F120 · id 2026-11-18-f120-s05-suggestions-risky-opus-be92887e · branch limen/2026-11-18-f120-s05-suggestions-ris
RUNNING F118-s06 notice routing · F118 · id 2026-11-18-f118-s06-notice-routing-e149d807 · branch limen/2026-11-18-f118-s06-notice-routing-e149d807 · elapsed 24m · silent 
RUNNING F111-s06 own-model guide (docs, Opus review before land) · F111 · id 2026-11-18-f111-s06-own-model-guide-docs-op-65ba0899 · branch limen/2026-11-18-f111-s06-own-m
RUNNING F117-s20 operator smoke tool · F117 · id 2026-11-18-f117-s20-operator-smoke-tool-a63a5612 · branch limen/2026-11-18-f117-s20-operator-smoke-tool-a63a5612 · elapse
RUNNING Plan F121 · F121 · id 2026-11-18-f121-plan-a1715c1c · branch limen/2026-11-18-f121-plan-a1715c1c · elapsed 25m · silent 7s · think · tools 105 · bash · pid 349034
RUNNING Plan F108 · F108 · id 2026-11-18-f108-plan-114a0b58 · branch limen/2026-11-18-f108-plan-114a0b58 · elapsed 25m · silent 3s · think · tools 103 · bash · pid 349004
RUNNING F120-s10 known domains (risky: Opus review after) · F120 · continue · id 2026-11-18-f120-s10-known-domains-risky-opu-7289c597 · branch limen/2026-11-18-f120-s10-k
RUNNING F115-s14 reply routes for the panel · F115 · id 2026-11-18-f115-s14-reply-routes-for-the-pa-b32d4733 · branch limen/2026-11-18-f115-s14-reply-routes-for-the-pa-b3
```

### Ticket state (live: `bash scripts/coord-scan.sh`)
- F120 (sender context): stages 01 to 04, 03b, 08, 09 landed; 05 running, 10 in repair (known domains: security fix, then a narrow Opus re-review), 06 and 07 after 05, 11 needs a model key, 12 docs, 13 last.
- F115 (reply drafts): through 13 landed, 14 running, 15 then 16 to 18; stage 02 (real model run) needs an API key; keep `reply_drafts` OFF until stage 17 carries the consent text and the batched legal bump.
- F118 (phone channel): 01 to 05 landed, 06 running, then 07, 08, 08b, 09, 10 (migration), 11 to 13.
- F117 stage 20 running; 14, 15, 17 to 19 wait for the spike (owner skipped); F111 stage 06 may be done (check); F134 running; F135 running; planners F108 and F121 running (their cold reviews fail or pass inside the planner job).
- Done this session: F112, F130, F131, F132, F133 and many stages of F110, F115, F116, F120.

### Open items for the owner
VPS machine; model API key (F115 s02, F120 s11); F118 checkpoint A (phone); F116 stage 25 pilot (gate G1); owner decision 42; sent_sync pilot word; F113 week run; F111 O1 and O2; F117 U1; F119 U1; F128 panel check; a Polish wording review of the F115 s12 and s13, F118 s04 and s05, F120 s08 and F133 texts.

## 2026-11-19 10:50 release v0.3.0 deployed
- VPS was v0.2.0; v0.2.1 never deployed. One release v0.3.0 (commit 105fb0c0, CI green) caught it up. Backup `ea-20261119T094238Z.dump.age`. Rollback target v0.2.0 (3e60a7f5): `deploy/rollback.sh`.
- `release ok v0.3.0 previous v0.2.0`; server healthy, EA_RELEASE=v0.3.0, 7 migrations ran. All new flags OFF. Watch window started 09:48Z (30 min).
- VPS checkout is on master (ff to 105fb0c0). Release log on VPS: /tmp/release-v0.3.0.log.
- Next: per-ticket VPS checks (F110 s26, F104 s13, F029 s05, F102 s20, F107 s07, F114 s09, F113) after the watch is clean.
