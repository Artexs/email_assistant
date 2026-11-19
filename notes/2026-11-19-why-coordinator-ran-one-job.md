# Why the coordinator ran one job at a time (2026-11-19)

Question from the owner: 12 tickets are active, but the coordinator ran about one job at a time. What blocked it?

## Evidence

- Job start and end times in `.limen/jobs/2026-11-19-*` (`started-at`, `finished-at`). Jobs running at the same time, UTC:
  - 00:20–01:20: 4–10. 01:40–05:00: 2–3. 05:20–08:00: 1. 10:00–13:00: 4–6.
  - 13:20–17:36: 0 or 1 (only F137 stage 04 and its review).
  - 18:48: 6, after the owner forced a parallel start (owner rule at the end of `spec/build.md`).
- `limen rule`: no active rules. `limen queue`: start gate open (CPU and memory gates not hit). Limen has no worker cap.
- `bash scripts/coord-scan.sh` at 18:50 and the coordinator session
  `~/.pi/agent/sessions/--home-artek-Documents-repos-email_assistant--/2026-11-19T12-53-59-838Z_01a1f3de-fd9d-7463-8fe1-6e72ee70e722.jsonl`
  (replies at 14:53 and 15:05 UTC).

## Finding 1: Limen did not block anything

Limen only holds a job when CPU idle < 25 % or free memory < 20 %. That gate was open. No seat rule was active.
The limit came from the coordinator rules in `spec/build.md` and from the plans.

## Finding 2: each ticket is a chain, and all 12 were at the end of their chain

Each stage file has a `Needs` line. Most say "stages 01–NN landed and the master CI run of the last land green".
So one ticket gives at most one job at a time. At 13:00 UTC the 12 active tickets had 1–2 stages left:

| Ticket | Open stage | What holds it |
|---|---|---|
| F029 / F064 | 05 | 24-hour watch on the VPS after a deploy (due after 09:48 UTC 2026-11-20) |
| F102 | 20 | stages 01–19 + green master CI |
| F104 | 13 | turns on `sent_sync`; marked "waits for the owner's word" |
| F107 | 07, 08 | 07 is a VPS deploy; 08 needs 07 |
| F110 | 26 | stages 01–25 + green master CI |
| F113 | (all landed) | live lab day run on the VPS; real time, ends 2026-11-20 ~22:00 UTC |
| F114 | 09 | restore drill on the VPS; needs the age key path |
| F115 | 02 rerun, 17, 18 | Gemini judge daily quota (429); 17 needs 01–16, 18 needs 17 |
| F116 | 25 | gate G1 (owner second pass) |
| F119 | 15, 16 | 15 needs 01–14 + green CI; 16 needs an Entra test tenant (owner) |
| F120 | 13 | VPS pilot; needs F104 and F110 in `done/` |

Most last stages are VPS runs, pilots, or owner gates, not code jobs.

## Finding 3: rules in `spec/build.md` that slow the end phase

- One VPS deploy at a time; one migration in build at a time.
- Green master CI before the final stage of many tickets. A red CI run (2026-11-19, test timeout) blocked them.
- Cross-ticket waits (`## Sequenced`, "build after FNNN in done/"), for example F120 after F104 and F110; F121 after five epics; F108 after E7-T1…T4.
- Order rule: plan a ticket only after the tickets it needs have landed.
- Owner gates (G1 second passes, owner steps U1/O1, "waits for the owner's word").
- Planner cap: three at once.

## Finding 4: the coordinator did not see the ready planned tickets

- `scripts/coord-scan.sh` lists only (a) stages of ACTIVE tickets and (b) planned tickets WITHOUT `plan.md`.
- It does not list planned tickets that have a landed plan. Board scan rule (2) in `spec/build.md` says to start them, but the script hides them.
- F124 and F125 ("sequenced after none, gate —"), F062 and F068 ("keep: plan now") were ready all day. The coordinator started them only after the forced parallel run.

## Finding 5: the coordinator chose to wait for the owner

- 14:52 UTC: it said "a job only starts when someone spawns it" and did not start ready stages, "because you did not ask me to".
- 15:05 UTC: it started one job and wrote "I would rather ask than deploy by myself", although `spec/build.md` pre-approves VPS deploys.
- So the board-scan rule ("at every wake, start all work that can start") was not followed after the PC crashes killed jobs and a new coordinator session started.

## Suggested fixes (not done)

1. Extend `scripts/coord-scan.sh` to list planned tickets with a landed plan and their `## Sequenced` / gate line.
2. Move the 2026-11-19 owner rule ("do not wait, run in parallel") into TRACK, and remove the conflicting old texts ("I would rather ask").
3. Mark VPS-run and owner-gate stages in the scan output, so "OPEN" does not look like "ready".
