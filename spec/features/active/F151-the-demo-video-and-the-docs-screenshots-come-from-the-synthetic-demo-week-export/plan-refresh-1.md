# F151 plan refresh 1 (2026-11-20)

Old base: `e8f6f2b1`. New base: `dc943d8dc` (HEAD). Task: keep the landed stages; let the remaining stages build and test before the end of demo day 5 on a trial export; mark what is final-only.

## Drift output (`scripts/plan-drift.sh <folder> e8f6f2b1`)

```
plan base: e8f6f2b1b 2026-11-20 12:32
HEAD:      dc943d8dc 2026-11-20 19:11
named paths: 8; changed since base: 5; gone: 0
changed: apps/web/e2e/lib/demo/encode.test.ts
changed: apps/web/e2e/lib/demo/encode.ts
changed: apps/web/e2e/lib/demo/run-plan.test.ts
changed: apps/web/e2e/lib/demo/run-plan.ts
changed: deploy/README.md
commits after the base that touch the named paths:
  39aa68e57 11-20 17:54 docs: the env split guards and the server env check in the release runbook
  d6c075d5a 11-20 17:47 Time literal rule covers test code outside the int folders
  1377e28f9 11-20 15:14 Demo command: replay server, gate copy, loopback-only server env and wait limits for the demo source
  d66055cd6 11-20 14:43 Demo run plan: pick the recording's mail from the seed and copy the gate file
  08ed7ce79 11-20 14:17 F151 stage 03: cut timeline and per-source steps
  1c61819f6 11-20 12:47 F129 stage 14: …
  8f06a68b1 11-20 12:46 F129 stage 12: …
  b26c64230 11-20 12:37 F129 stage 09: …
  234d298f0 11-20 12:28 F129 stage 08: …
```

Drift at the new base: `no drift` (exit 0).

## Finding: stages 02 and 04 already landed

The task asked that stages 02 and 04 can build without the demo export. They need no export, and both landed before this refresh: stage 02 in `d66055cd6` (merge `d4ff4ffee`), stage 04 in `1377e28f9` (merge `6297b143d`, review PASS in `review-stage-04-1.md`). The board scan (`scripts/coord-scan.sh`) shows stage 02 as OPEN because its commit subject has no "F151 stage 02" before the colon. The refresh commit for stage 02 carries that subject, so the scan shows it LANDED after this branch lands. Stages 01 (`0df5bec69`) and 03 (`08ed7ce79`) also landed.

## Changes

- plan.md status: plan base `dc943d8dc`, refreshed 2026-11-20; stages 01–04 marked landed with commits.
- plan.md D12 (new): trial seed. Stages 05–07 build and prove on any export of run day 1 or later; proofs take the newest `demo-seed-day*.json`; `demo_seed_day <n>`; day < 5 gives `not for upload: trial_seed`; pick rules never relax. Reason: the task (test 05–07 on partial data). Default, Q6.
- plan.md D13 (new): what is final-only (day-5 runs of the stage 06 and 07 proofs, G2 size line, G3 verdict). Stages 05–07 close on a trial seed.
- plan.md D10: the upload line also needs a day-5 seed.
- plan.md C1a (new): the coordinator's trial export from 2026-11-23T23:00Z (end of run day 1) with `demo-export --day <N>`; C1 stays the day-5 export; C3 (new): the final take, as a follow-up ticket (owner rule 2026-11-20: a data run that waits days is not a stage).
- plan.md Facts checked: facts used only by landed stages dropped (they stay in the file at `e8f6f2b1`); new facts on the run dates, `exportDemo` day cut, the import replace and the shadow days.
- plan.md: trimmed text of D2, D3, D4, D7, D9 and Input to stay at 1,500 words; no decision changed.
- Stage 05: Needs C1a (trial enough); new interface `readDemoPlan` (stage 04 review note: ISO dates) with test 6; `@setup` checks `open_loops` and `reply_drafts` off (review note: replay misses); job CLIs with model scope on get the demo env (review note); a trial refusal changes no pick rule, the coordinator continues on a later export; proof takes the newest export.
- Stage 06: Needs C1a; `DemoPrepared.seedDay`, `demo_seed_day <n>` line; `uploadVerdict` gets `seedDay` and the reason `trial_seed` (order `e2e_source`, `trial_seed`, `gate_provisional`, `replay_miss`, `not_live`); test 1 has two trial rows; test 2 expects `not for upload: trial_seed` on a trial seed; final-only marked; proof takes the newest export.
- Stage 07: Needs C1a; final-only marked; G2 line says "trial, day <n>" on a trial seed; G3 needs the day-5 export; release checklist names the day-5 export; proof takes the newest export.
- Stages 01–04: a `Landed: <sha>` line; stage 02 lost the stale "May run next to 03".
- questions.md: Q6 [minor].

## Facts checked, no change needed

- `record.spec.ts` still throws `demo_source_recording_not_built` for the demo source (stage 06 removes it).
- `demoServerEnv`, `assertLoopbackLlm`, `DEMO_WAIT_LIMITS_MS` in `apps/web/e2e/lib/demo/server-env.ts`; `prepareDemoRun` and `DemoPrepared` in `prepare.ts`; `closeReplay` in `record.ts`; `parseRecordArgs` in `record-args.ts` (stage 05 adds `--setup-only`).
- `planDemoRun` has no day rule; a day-1 seed runs through the same picks; `overdueDelegation` is null unless mailbox A is `assist` with `create_draft` on (days 1–3 are shadow).
- `exportDemo` accepts day 1–7 and cuts at 00:00 Warsaw after the day; it does not refuse a day that has not ended.
- `setupDemoOrg` (`demo-org-setup.ts`) imports with `replace: true`.
- `global-setup.ts` turns on `trust_ladder`, `approvals_page`, `delegation_pages` with `org-flag.ts`; `open_loops` and `reply_drafts` default off; the export has no feature table.
- Production classifier prompt `classifier-v2`; gate files `classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json` and v3, both provisional.
- `telegram:link`, `PATCH /api/me/notify`, `mail/seed.ts` exist.
- The `deploy/README.md` drift (env split, Telegram check) does not touch § Docs site or § Sim stack step 12 that the plan uses.
- The C1 run (`notes/2026-11-15-vps-deploy-queue.md` § Demo run for F151) uses `openai`, `gpt-6-luna`, `classifier-v2`, as C1 requires.

## Review 2 (2026-11-20): repair of refresh 1

Review: [plan-review-2.md](plan-review-2.md), FAIL on `57391e9fb` (one blocking finding, eight others). The coordinator starts the one re-review.

| Finding | Fix |
| --- | --- |
| B1 verdict not last | D14 (new): fixed output order; the verdict is the last log line of every run, also a failed or refused one. D10: the verdict reads the exit code and the model check; reason `run_failed` first, `llm_unchecked` new. The old line `demo_source e2e: not for upload` goes; `not for upload: e2e_source` replaces it. Stage 08 test 1 has the "perfect inputs, exit 1 → `run_failed`" row; its Proof checks `tail -n1` on a refused run and on the e2e run. |
| F1 ticket and board gate | Coordinator text, below. |
| F2 final take has no owner | `followup-final-take.md` (new): draft ticket with scope, stop-and-ask rules, new `*_demo` database, preconditions. C3 and § How to run: the coordinator opens it at the last F151 land, before C2. Stage 05: an auto-off probe on a copy of the seed with one `auto` category on A; `@setup` also checks that no `autonomy_paused` notice is in the chat. |
| F3 day not ended | C1a: "newest ended run day". D12: the procedural guard (export only an ended day; at G3 the owner compares `exported_at`, now printed in the `demo_seed_day` line, with the end of that day). Stage 07 G3 note says so. |
| F4 day 5 or ≥ 5 | D10 and Q6: seed day ≥ 5 is final (an ended day 5, 6 or 7 export). Stage 08 test row "day 7 → candidate". |
| F6 D8 primary path dead | D8: step 7 always reminds the step-6 delegation; no branch uses `plan.overdueDelegation`. Fact added (lab switches A with `keepSwitches: false`, never sets `create_draft`). Stage 06 step table and decision. |
| F5 alt text on a trial seed | D13 and stage 07 step 1: alt texts and captions describe the day-5 seed; a trial-only difference goes into the note. |
| F7 prompt and sim stack not pinned | Q7 [important: production] (new): hold the sim-stack classifier and the production prompt pointer until the final take. C1a names it; the follow-up draft lists both as preconditions. |
| F8 stage 06 too full | Stage 08 (new, `[risky]`, Opus review): `uploadVerdict`, `modelCheck`, `DemoPrepared.seedDay` and `exportedAt`, the output order, the `llm_settings` capture. Needs only stage 04 (landed), no export: it can build now. Stage 06 Needs it; stage 06 is 646 words now. Numbered 08, not inserted as 05, so the reviews, notes and board lines that name stages 05–07 stay true. |

Word counts after the repair: plan 1499; stages 05–08: 700, 646, 698, 675.

### F1: proposed text for the coordinator (not edited by this job)

`ticket.md`, § Slices, replace the sentence "Stages 01–04 need no export; 05–07 need the C1 export." with:

> Eight stages. Stages 01–04 and 08 need no export; 05–07 need an export of an ended run day 1 or later; the day-5 export is only for the final take, a follow-up ticket.

`ticket.md`, § Sequenced, `Build after:` line, replace "Gate: the C1 demo-week export at `~/.local/share/email-assistant/demo/demo-seed-day5.json` and the `*_demo` database of F121 C3, for stages 05–07 only." with:

> Gate: for stages 05–07 only, an export of an ended run day 1 or later (plan C1a) in `~/.local/share/email-assistant/demo/` and a `*_demo` database; the day-5 export (C1) only for the final take (C3, follow-up ticket).

`spec/build.md`, the F151 line, replace "7 stages, no migration, [risky] 04–06): … 01 ∥ 03, then 02, 04, 05 (needs the C1 export), 06, 07." with:

> 8 stages, no migration, [risky] 04–06, 08): … 01–04 landed; 08 now (no export); 05 after a trial export of an ended run day 1 or later (C1a, from 2026-11-23T23:00Z), then 06 (needs 05 and 08), 07; the day-5 take is a follow-up ticket.
