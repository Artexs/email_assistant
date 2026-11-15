# Harness review after the 2026-11-14 change (2026-11-15, 00:40 CET)

Read-only check. It compares the Limen harness before and after the owner change of 2026-11-14 15:10 CET (commit `7d6d14ef`, rule `harness-2026-11-14`).
Baseline: `/tmp/harness-study/report.md` (study of Nov 12–14).
New data: `/tmp/harness-study-2/` (`jobs.csv`, `ci.json`, `scripts/compare.py`). `/tmp` is lost at reboot; copy it if you need it later.
Cut-off: job start 2026-11-14T14:10Z. "Before" = 435 jobs over ~52 h. "After" = 129 jobs over 9.5 h (8 still run, so their cost is partial).
Cost = API list-price proxy, as in the baseline study (Opus $5/$25, Sonnet $3/$15, cache read 0.1x, cache write 1.25x). Ratios matter, not dollars.

## 1. The three changes: did they work?

| Change | Followed? | Effect |
|---|---|---|
| (1) Review model by risk | Yes in form: each review label names a reason. | 30 of 30 reviews after the change ran on Opus. 0 ran on Sonnet. |
| (2) Land check before `limen land` | Yes: 74 checks for 77 lands (`/tmp/coord/landcheck.sh`, results `/tmp/coord/lc-*.out`). | It caught 2 merge conflicts and 0 typecheck or unit failures. CI on master: 107 of 107 green after; 7 red of 93 in the hours before. |
| (3) Lean plans | Yes: every new or refreshed `plan.md` is 1,478–1,499 words (cap 1,500); stage files ≤ 700 (one 986 in F106). Before: 5,400–10,000 words. | Plan reviews now find design gaps, not detail drift. Plan job cost fell only a little. |

### 1a. Review by risk
- The work after the change was mostly security and privacy tickets: F105 (2FA), F106 (data delete, DSR), F119 (SSO). So most Opus choices are correct under the TRACK list.
- Some reasons stretch the list: "F097 s20 corpus becomes gate evidence", "F101 s02 Astro 7 move, CSP, lockfile, CI Node 24", "F085 s04 background job changes a mailbox status".
- The list is wide. "New user-facing Polish text" and "new dependency" make most UI or library stages risky.
- Low-risk stages mostly get no review at all (the plan lists which stages to review). So the Sonnet review case almost never happens. The change gave no saving yet.
- The study's A/B test (next 4 plan reviews on Opus and Sonnet both) did not run.
- Stage review median cost went up: $1.89 → $2.83 (riskier, larger stages).

### 1b. Land check
- Cheap: a script, about 1 min per land, few tokens.
- 0 test failures caught in 74 runs. The green CI is mostly from the flaky-test fixes F123 and F126. The check is still good insurance against the two semantic merge breaks of Nov 14.
- Risk: the script lives in `/tmp/coord/`. A reboot deletes it, and the owner rule depends on it.

### 1c. Lean plans
| | before | after |
|---|---|---|
| `plan.md` words (new plans) | 5,400–10,000 | 1,478–1,499 |
| all stage files, words | 9,000–21,000 | 5,300–11,800 |
| first plan job, median proxy $ | 13.3 | 12.3 |
| plan jobs that failed (quota) | 13 of 29 | 0 of 10 |
| plan continues | 17 | 0 |
| context per turn, plan job | ~200–270k | ~160–230k |
| turns per plan job | 120–190 | 120–175 |
| plan reviews FAIL | 13 of 21 | 4 of 5 |

- Plan reviews after the change find design gaps: erased data stays in Telegram outbox rows (F106 B1), the legal text guard lets text change without a new `TERMS_VERSION` (F107), SSO discovery refuses Entra and Google in production (F119 B1), the DSR report misses sent mail (F104 N1). This is the wanted effect.
- The cost of a plan job did not fall much. The cost is in reading (cache reads of ~200k context for ~170 turns), not in the words written. The "Read less" rule did not change the reading.
- Planning per ticket is still high: F104 $70, F103 $62, F119 $47 before any build. Refresh jobs are a new large item: 3 refreshes at 22:52 cost $45.
- The drift check before the F101 and F103 refreshes failed with a usage error (`/tmp/coord/drift-F101*.out`: `usage: scripts/plan-drift.sh <ticket-folder> <plan-base-sha>`). Those refreshes ran without drift data.

## 2. Other changes, before vs after

| | before (Nov 13 – Nov 14 14:10Z) | after (9.5 h) |
|---|---|---|
| hours with no job running | 26.3 of 38.2 | 0.2 of 9.5 |
| quota failures | 24 | 0 |
| lands per hour | ~4.7 | ~8.1 |
| proxy $ per land (jobs + coordinator) | ~6.1 | ~5.4 |
| Opus share of job cost | 73 % | 68 % |
| worker continues per worker job | 51 / 208 (25 %) | 27 / 62 (44 %) |

- The quota calm is the largest gain. But it is not from a gate: there is no Opus limit. At 00:37 six Opus jobs run at once (3 planners: F032, F102, F117; 3 reviews: F101, F103, F119). The baseline pattern (Opus burst → quota stop → 3–5 h idle) can come back.
- Worker continues rose. Of the 27: about 19 are "review PASSED, fix before land" (mostly test gaps that the reviewer found with mutations), 5 are merge conflicts, 2 are SIGTERM kills. Nearly every reviewed stage gets a second worker run.
- Merge conflicts: docs pages (`docs/architecture.md`, `docs/capabilities/*.md`) and now a module barrel (`apps/server/src/modules/privacy/index.ts`, F106 s05 and s06 in parallel). Study recommendation 5 (docs in the last stage only) is not applied.

## 3. Coordinator
- One session since 2026-11-12 12:46 (~61 h): 2,329 turns, 9 compactions, average context 263k, max 754k.
- After the change: 606 turns in 9.5 h, proxy $58 = 16 % of job cost ($5.8 per hour). Study recommendation 7 (rotate the session each day) is not applied.
- The coordinator works well on mechanics: it wrote the land-check script and runs it in the background, it names a model reason on each review, it drops job DBs, it checks CI after each land.

## 4. Gaps from the 2026-11-14 audit that still exist
- Stage reviews are not filed as `review-<n>.md`. Only plan reviews are filed. Verdicts live in `.limen/jobs/`, which `limen prune --retire` deletes.
- 24 owner decisions have status `new` in `docs/owner-decisions.md`.
- Limen status shows one old failed job: "plan · F102 E4-A" (`2026-11-14-f102-plan-e4-a-db8911dd`). A new F102 plan job runs now.

## 5. Proposals, by expected gain

1. **Opus gate (protects the largest gain).** At most 2 Opus jobs at once; no Opus planner start in the last 90 min of a 5-hour window. Now: a `limen rule`. Later: a quota reading in the Limen start queue next to CPU and memory. Plan F032, F102, F117 one at a time; they do not block a build now.
2. **Plan just in time.** Plan a ticket only when its build can start within about one day. Plans made far ahead drift and need a refresh ($6–23 each, plus a plan review).
3. **Cheaper refresh.** Run the drift script first (fix the call). No changed path → no refresh job. Else run the refresh on Sonnet: a lean plan has few code facts to update. Keep Opus for the plan review only when the ticket is risky.
4. **Planner reads less, for real.** The word cap did not cut the reading. Options: a 30 min timeout on planner jobs; a context packet from the coordinator (capability page, file list, epic page); or `--thinking medium` for the planner and `high` only for its decisions. Measure with `scripts/compare.py` (context per turn × turns).
5. **One job for review fixes.** For test-gap findings (most "PASS, fix before land"), the reviewer adds the tests itself on the branch, or the worker's proof includes the reviewer's mutation step for `[risky]` stages. This removes one continue, one coordinator round and 10–15 min per stage.
6. **Narrow the Opus list, and test it.** Move "new Polish text" to Sonnet (or Haiku for a word list) and "new dependency" to Sonnet, except for auth libraries. Run the A/B of study recommendation 2 on the next 4 plan reviews.
7. **No parallel stages that share a barrel or a docs page.** Docs edits go to the ticket's last stage. Two stages of one ticket that both add exports to one `index.ts` do not run at once. The coordinator resolves "keep both" conflicts itself.
8. **Move `landcheck.sh` into the repo** (`scripts/land-check.sh`), and later into `limen land` (Limen repo). `/tmp` is not safe for an owner rule.
9. **Rotate the coordinator each day** from a handoff note. Expected: lower cost per turn and less board drift.
10. **File stage reviews** as `review-<n>.md` (a `limen keeper` job can do it), before any prune.

## 6. Limits
- 9.5 h of "after" data. The ticket mix changed (more security work), so model choice and review cost are not directly comparable.
- 8 jobs still ran at the cut, so their cost is partial.
- The quota calm can also come from the time of day and the ticket mix, not only from the change.

## 7. Follow-up (2026-11-15, 01:00 CET): where the tokens go

### Token types after the change (proxy $ share)
| job kind | n | $ | cache read | output | cache write | turns/job | cache read/job |
|---|---|---|---|---|---|---|---|
| plan | 10 | 135 | 69 % | 19 % | 11 % | 106 | 18.7M |
| worker | 62 | 90 | 50 % | 29 % | 21 % | 35 | 2.4M |
| review | 25 | 75 | 55 % | 25 % | 20 % | 52 | 3.3M |
| coordinator (Sonnet) | 1 | 59 | 82 % | 11 % | 7 % | 621 | 161M total |

- Cost = turns × context per turn. Each turn sends the whole session again (as a cache read). The planner does not pay for "the repo"; it pays for what it has read so far, again on each of ~106 turns.
- Planning per ticket, first plan + reviews + refresh: before (F098, F099, F100, F105, F085) median ~$49; after (F106 $32, F107 $18, F119 $47) median ~$32. About −25–35 %, on n = 3. The gain is mostly "no quota continues", not smaller reading.

### Coordinator
- Context per turn after the change: 65k right after a compaction, then up to 400–550k within 3–6 h. Average 250k.
- Pi auto-compaction starts only at `contextWindow - compaction.reserveTokens` (default 16,384), so near the full window. The 3 compactions after the change came at 552k, 398k, 515k tokens.
- Wakes after the change: 137 job-finished wakes → 501 model turns, $45.8 (77 %); 55 start notices ("No action is needed") → 58 turns, $5.9 (10 %); 10 owner messages → 62 turns, $7.5 (13 %).
- The start notice comes from `limen/src/runtime/start-queue.ts` `started()`: any job that waited in the queue (also a 16 s settle wait) writes it, and it wakes the coordinator.

### Why planners started early
- `spec/build.md` "Board scan" (owner, permanent): every turn, start "plans of tickets whose needs have landed (planner cap three)". The order rule checks only "needs landed". No rule asks "can the build start soon?".
- F117: needs F082 and F099 (both done), so it is inside the rules. But its gate is an owner step (Microsoft 365 seat), so its build cannot start soon.
- F102: the coordinator wrote "I took 'proceed with all next steps' as a yes to planning ahead" (00:33). Its NEXT line says sequenced after F101, which is in build.
- F032: NEXT says "plan after F029"; F029 is still active. The start followed the owner message at 00:25 ("you have quite low amount of them").

### Proposals (detail for sections 5.1, 5.2, 5.4, 5.5, 5.9)
1. Coordinator compaction: project `.pi/settings.json` → `compaction.modelOverrides["claude-bridge/claude-sonnet-5-5"].reserveTokens` = context window − 200,000. Check that the override hits only the coordinator, or accept it for Sonnet workers (they average 72k, so rarely reach it).
2. Limen: no coordinator wake for a start notice when the wait is short (for example < 5 min); fold it into the finish wake.
3. Coordinator: one turn per finished job. One script does land check + land + DB drop + CI check (now ~3.7 model turns per finished-job wake).
4. Planner: a Sonnet scout job (`limen/templates/scout.md`) collects the code facts first; the Opus planner reads the packet and the capability pages, not the code. `--thinking medium` for the planner except for the decision pass.
5. Plan just in time: add to the order rule "and its build can start within about one day: needs in `done/` or in their last stage, and its gate is open". An owner message "start more" means builds first.
6. Review fixes: reviewer result in three groups — BLOCKING (code), TEST GAP (tests only, exact cases), NOTE. NOTE → file in `review-<n>.md`, land, ticket line if needed. TEST GAP → one Sonnet continue, `--thinking medium`, no re-review, land check runs the lane of the new test. BLOCKING → as now. Worker task for reviewed stages: run the mutation list for each guard the stage adds, and list the results.

## 8. Applied 2026-11-15 (owner)
- Planner and refresh jobs: `--thinking medium` (commit 0499dd1c). Cold plan review stays `high`.
- Planners start 2–4 Sonnet scouts (`--role scout`, `--thinking medium`) before they read code, and file the packets in `scouts.md` (`.agents/limen/planner.md`). Refresh jobs start none. Measure on the next plans: cache read per plan job (was 18.7M) and $ per plan job (was ~$12–25), with `/tmp/harness-study-2/scripts/compare.py`.
- Review findings in three groups (BLOCKING, TEST GAP, NOTE) and the guard-removal check for workers: `spec/build.md` TRACK "Review findings". Measure: continues per reviewed stage (was ~80 %).
- Coordinator compaction: `~/.pi/agent/extensions/coordinator-compact.ts` (outside this repo). On `agent_settled`, when `<cwd>/.limen/coordinators/<session id>/` exists without `shutdown` and the context is above 200k tokens (`LIMEN_COORDINATOR_COMPACT_TOKENS`), it calls `ctx.compact()` with coordinator summary rules. Other pi sessions are not touched. A running coordinator loads it after `/reload`; a new one loads it at start. The first try, a project `.pi/settings.json` compaction override, was removed: it also hit the owner's own pi chats in the main checkout.
