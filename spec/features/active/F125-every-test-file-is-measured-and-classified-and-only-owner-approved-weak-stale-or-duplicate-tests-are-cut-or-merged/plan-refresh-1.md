# F125 · Plan refresh 1

Old base: 54fe78f (2026-11-14). New base: 1927d052 (HEAD, 2026-11-19). Stage count unchanged (7 phase A stages, gate G1, phase B after G1).

## Drift output

`bash scripts/plan-drift.sh <this folder> 54fe78f`:

```
named paths: 26; changed since base: 6; gone: 0
changed: apps/server/test/contract/mail-provider.ts
changed: apps/server/test/integration/e2e-seed.test.ts
changed: apps/server/test/integration/imap-contract.test.ts
changed: apps/server/test/preload.ts
changed: apps/web/src/lib/activity-text.test.ts
changed: packages/core/package.json
commits after the base that touch the named paths:
  170e8617 F120 stage 08: sender line in the Activity detail and the approval summary
  18fd9ef6 F118 stage 04: installable panel shell (manifest, icons, service worker, offline page, push payload and texts)
  b63c8e6b F132: comments name the rule, not a ticket or decision code (apps/server/test)
  34a345c4 F110 stage 22: unsubscribe data
  dfddb2e0 F110 stage 16: why lines
  9a4d6aa9 F117 stage 04: AuthMaterial in the IMAP and SMTP adapters
  3fd323b7 F105 stage 12: e2e seed owners with a second factor
  b1809412 F100 s02: fetchContent and fetchFlagsIn in the port, the IMAP adapter and the fake
```

## Recount (2026-11-19, HEAD 1927d052)

Unit: `bun test <path> --reporter=junit --reporter-outfile=<temp>` per path of `test:unit`, serial, Bun 1.4.4, no DB, no `.env` (none in the worktree), after `bun install --frozen-lockfile` (no `bun.lock` change). All passed, 0 skipped.

| Path | Files | JUnit cases | Cases ≥ 1 s |
| --- | --- | --- | --- |
| `packages/core` | 165 | 2,760 | 1 |
| `apps/server/src` | 203 | 2,807 | 8 |
| `apps/web/src/lib` | 84 | 920 | 0 |
| `apps/web/src/i18n` | 10 | 54 | 0 |
| `apps/web/integrations` | 3 | 19 | 0 |
| `apps/docs/src` | 11 | 139 | 0 |
| `apps/docs/integrations` | 5 | 64 | 0 |
| `apps/docs/scripts` | 6 | 119 | 5 |
| `deploy/test` | 7 | 89 | 2 |
| `tools/fake-telegram/src` | 8 | 59 | 1 |
| Unit total | 492 | 7,030 | 17 |

The 6,988 of the task (test:unit:ci on 2026-11-19) is an earlier HEAD of the same day.

Int and e2e (not run; file list and `grep -cE '^\s*(test|it)(\.each\([^)]*\))?(\.(skip|only|todo|skipIf\([^)]*\)|if\([^)]*\)))?\('`):

| Path | Files | Call sites |
| --- | --- | --- |
| `apps/server/test` (427 in `integration/`, 3 top level) | 430 | 5,514 |
| `tools/fake-telegram/test` | 4 | 19 |
| `apps/web/e2e` (37 in `tests/`, 1 in `docs-shots/`) | 38 | 224 |
| `apps/docs/e2e/site.spec.ts` | 1 | 8 |
| `tools/mail-oauth-spike` (in no suite) | 2 | – |

Repo: 977 test files (`git ls-files '*.test.ts' '*.test.tsx' '*.spec.ts'`), about 258,000 lines; 11,700 call sites by the stage 01 grep (core 2,090). Total about 12,800 cases.

Flag estimate (a throw-away TypeScript AST probe, not committed; raw S1 without the helper check, S2, S5, S6 per file, S7 on test calls only): stage 04 area 6 flagged cases, 3 B groups, 21 T groups; stage 05 area 21 cases, 6 B, 9 T; stage 06 area 161 cases (157 raw S1), 5 B, 3 T. Unit S9: 17. Int S9 and core S10/S11 are unknown before stages 02 and 03; core S11/S10 scaled from F3: about 80 S11 cases, up to 165 S10 file items.

## Changes

- ticket.md Outcome: "about 3,950 test cases" → about 12,800 (7,030 unit, about 5,500 int, about 230 browser).
- plan.md status: plan base 1927d052, refreshed 2026-11-19.
- plan.md P2, D8: 4,000 → about 12,800.
- plan.md D5: core 787 cases / 2 min marked as the F3 probe; 2,760 cases at HEAD.
- plan.md K4: both contract modules (`mail-provider.ts`, `mail-sender.ts`) and every file that runs them (int: `imap-contract`, `smtp-send`, `graph-send`; unit: `mail/fake/fake.test.ts`, `sender.test.ts`); the conditional `test.skip` in `mail-sender.ts` is K4. Reason: the contract module changed; `mail-sender.ts` was not named.
- plan.md K5: the two quarantine examples are gone at HEAD (no `Quarantined` comment in the repo).
- plan.md `FIX-NEVER-RUNS` and F6: `e2e-seed.test.ts:89` → `:90`; the `e2e` CI job sets the E2E URLs but runs only `test:e2e`; F136 may set per-job E2E URLs in `limen-prepare.sh`. Added the not-run spike tests.
- plan.md F1: new recount; old counts kept as history.
- plan.md N4: flag estimate and the cap check (see below).
- plan.md § Stages: stage 04 title names `apps/docs` and `deploy/test`.
- plan.md How to run: drift base 1927d052; `--yes --keep-open`; `--timeout 2h` also for 02 and 03.
- Stage 01: Needs line (none; names what it writes); `kind` `e2e` also for `apps/docs/e2e/`; area list with the new paths; count check numbers at HEAD.
- Stage 02: Needs line (file + scan key); timeout note; Done when counts at HEAD.
- Stage 03: Needs line as file; timeout note.
- Stage 04: Needs lines (files of 01–03); title; counts; new section for docs, deploy, the spike tests (S8 expected for script tests, K3 for deploy and secret checks, `not-run` spike tests); `activity-text.test.ts` K2 only for its "words tied to the Telegram source" describe (the file gained other describes); one continuation expected.
- Stage 05: Needs lines; counts; the fake contract runners are K4.
- Stage 06: Needs lines; counts; both contract modules; 45 CLI-spawning files; `e2e-seed.test.ts:90` evidence from `ci.yml` and `limen-prepare.sh`; F136 overlap paragraph; one or two continuations.
- Stage 07: Needs lines as the three review files and the pairs file.
- questions.md: Q2 count; new Q5 (caps kept) and Q6 (new areas to stage 04), both minor.

## Cap check

The cap of 150 items per job and two continuations (450 per stage) still holds. With the `S8` call sites of plan review 2 (regex count: stage 04 area about 99, stage 05 about 72, stage 06 about 49): stage 04 about 380 items → one or two continuations; stage 05 about 120 → zero or one; stage 06 about 210 + int S9 → one or two; above 450 only the fastest S9 cases stay `not read` (S9 is read last, slowest first). No stage split: the code does not force one (Q5).

## Checked, no change

- `apps/server/test/preload.ts`: only a comment changed; F5 holds (core needs no preload).
- `packages/core/package.json`: one new export (`./push`); the only dependency is still `zod` `^4.1.12`; core imports only `zod`, `bun:test`, `node:*`. D4 holds.
- `imap-contract.test.ts` still runs `describeMailProviderContract` from `../contract/mail-provider`.
- `bunfig.toml` preload, `.bun-version` 1.4.4, `deploy/Dockerfile` workspace copy: unchanged facts (D3, F8 not affected).
- `run-suites.sh` reads the suite paths from `package.json`, so the new unit paths join stage 02 with no plan change.
- F124 (parallel runs) and F136 (parallel Playwright) are still in `planned/`; no landed ticket did a step of this plan. `Build after: F124` for the cut stages stays.

## Changes after plan review 2 (`plan-review-2.md`, FAIL on fdb50594)

- Item 1 (blocking): stage 01 also scans shared suite modules (non-test `.ts` with `bun:test` case calls; at 1927d052 `apps/server/test/contract/mail-provider.ts`, `mail-sender.ts`) as `kind` by path, new `CaseRow.shared`, fixture test 14. Stage 02 checks the name on a (file, line) join, joins JUnit rows of shared cases by line, name pattern and classname, reports shared counts apart from the 1 % `unscanned` check, with a fixture test. plan.md D7 states the key exception. Reason: Bun reports a shared case with the runner file and the module line, so these rows were `unscanned` or joined to a wrong runner row.
- Item 2: N4, Q5 and stages 04–06 estimates include `S8`: 380 / 120 / 210 + int S9; continuations 1–2 / 0–1 / 1–2.
- Item 3: plan.md P2, D8, F1 and questions.md say "at least 12,800". ticket.md not changed in this round (coordinator instruction); its "about 12,800" is a floor too.
- Item 4: stage 04 rules for `apps/web/src/i18n` (K2), docs `src` and `integrations` (K2, CSP K3); `apps/docs/e2e/` is stage 06.
- Item 5: stage 06 F136 note adds `apps/docs/e2e/site.ts`, its config and `e2e-seed.test.ts`.
- Item 6: stage 06 reads `unit-int-pairs.tsv` if it exists in `master` at the job start; stage 05 always writes it (header only when empty).
- Item 7: no change (facts confirmed).
- Item 8: plan.md F1 trimmed to a pointer to § Recount. plan.md stays over the 1,500-word cap; no restructure in a refresh.
- Item 9: no change (unverified items stay for stages 02 and 03 to measure).
