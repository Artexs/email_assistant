# Progress overview, 2026-11-14 (coordinator)

## 1. Stage 2 roadmap (28 rows of `docs/product/stage-2/05-execution-plan.md` §2.1)
Summary: 2 closed, 5 in build, 3 planned (plan landed, not built), 18 not planned.

| # | Epic (ticket) | State |
|---|---|---|
| 1 | E1 Close the MVP (F095) | 9 of 10 stages landed. Stage 09 (pilot-week result) waits for 22:40Z. Closes after it. |
| 2 | E8-LR Log rotation (F096) | Closed. |
| 3 | E2a Offline lab (F097) | 13 of 22 landed (01-12, 17). 13 is landing. 14-16 next. Corpus: 591 of 2663 texts written, 400 labelled, all 400 agree. 20-22 later. |
| 4 | E7-T1 Polish UI (F098) | 11 of 13 landed. 12 (switch Polish on) in review. 13 (docs) next. |
| 5 | E7-T2 Platform controls (F099) | Closed and deployed on the VPS. |
| 6 | E3a Measure (F100) | 13 of 19 landed. 07, 15 in review. 16 (migration), 18 (panel page) in build. 17, 19 left. |
| 7 | Panel to Astro 7 (F101) | Plan landed. Needs a plan refresh. Starts after F095. |
| 8 | E4-A Act from the panel (F102) | Not planned. Needs F098 and F101. |
| 9 | E8a Logs (F103) | Plan landed (19 stages). Starts after F095. |
| 10 | E5a Read Sent (F104) | Plan landed (12 stages). Starts after F095. |
| 11 | E7-T6 Identity A, TOTP (F105) | 3 of 15 landed (01, 02, 04). 03 in fix. 05-15 later. |
| 12-14 | E7-T3 Account data (F106), E7-T4 Papers (F107), E7-T5 Production (F108) | Not planned. F106 waits for F098. |
| 15-28 | F109-F122 (E3b, E4-B, E11b, E10a, E2b, E8b, E6a, E5b, E9a, E9b, E7-T7, E11a, E10b, E6b) | Not planned. Each waits for the tickets it needs. |
| - | E12 Native mobile app | Deferred. |

## 2. Foundation group from the architecture review (F086-F093)
8 of 8 closed: module borders, feature flags, notices as facts, structured logs, LLM roles, repo split, RLS safety net, CI green.
On the VPS: F092 (RLS) runs with the F099 deploy (commit 65164fd).

## 3. Everything else
- Closed in recent days: F030, F034, F049, F056, F059, F069, F070, F077, F078, F079, F080, F082, F083, F084, F123, F126.
- Active: F094 (Bun 1.4.4; 24 h VPS check at 01:10 CET on 15 Nov, then close), F071 (Limen transition; no work now).
- Old planned tickets after the 13 Nov sweep:
  - folded: F037 and F047 into F095; F060 into F110.
  - parked: F023, F055, F063, F072, F076.
  - plan now: F085 and F029 with F064 (planners running). F032, F062, F068 have plans, build later.
- Yours: F124, F125 (test suite tickets). I do not touch them.
- Test flakes fixed: F123, F126, sim-files test 5.
- VPS: runs commit 65164fd (F099, F092, F098 stages 01-09). Not deployed yet: F097 /review, F100, F105, F098 stages 10-12.
  The deploy waits for F105 stage 11, because operator access now needs TOTP (see handoff note rollout rule).
- Waiting on you: nothing now. Later: your audit of 50 cases after F097 stage 20; decision on F081.
