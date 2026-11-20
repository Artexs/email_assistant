# F121 plan review 2 (refresh 1)

Job `2026-11-19-f121-plan-review-2-0b075cef`, `claude-opus-5-5`, high, on `d8c887f9`. Final message, whole:

FAIL d8c887f9f63e38e0039f648bc336778951399af6

The F121 plan refresh (public pages and demo) holds together at `f21809c4`, with one blocking problem. The ticket still describes the plan before D10, the decision that stages 09–10 build on the e2e seed. One acceptance bullet cannot be met by any stage. The fix is one coordinator edit to `ticket.md`. Refresh jobs may not edit the ticket (`.agents/limen/planner.md:66`), and `plan-refresh-1.md` does not name the edit the coordinator must make (`planner.md:36` requires that).

HEAD matches the candidate. The tree is clean at the end, and I changed no file. The only side effect is `bun install --frozen-lockfile`, which wrote the git-ignored `node_modules`.

## Blocking

**B1. The ticket's acceptance and gate lines contradict D10, so acceptance bullet 4 cannot be met. Proven by reading.**
- `ticket.md:31` requires: "`bun run demo:record --seed <file>` writes an MP4 of 100–130 s and captions in en and pl".
- No stage records with `--seed`:
  - The stage 10 proof records the e2e source only (`stages/stage-10-demo-record.md:5`, test 2 at :30).
  - Test 4 stops at the setup step and says "The full demo-source recording is the follow-up ticket's" (:32).
  - Stage 09 leaves the demo-source column of the spike table `open` (`stage-09-demo-script.md:11`). Stage 10 therefore cannot record from a demo seed.
- `ticket.md:43` still says "Before stage 09: coordinator step C1 … start it at the build start". This conflicts with:
  - D10 (`plan.md:83`) and the C1 line (`plan.md:119`): C1 gates no stage and starts only after the F113 day run.
  - The owner answer in `notes/2026-11-20-replan-parallel.md:272`.
- A stage 10 worker reads `ticket.md` (spawn prompt, `plan.md:141`). The rule "A gap or a deviation is a question" (`plan.md:107`) then makes that worker stop. A close-out reviewer would fail bullet 4.
- **Fix (coordinator):**
  - Change `ticket.md:31` to `bun run demo:record` (e2e source).
  - Move the `--seed` bullet to the follow-up ticket.
  - Change the Gate line to "C1 gates no stage (D10)".
  - Record the change in `plan-refresh-1.md`.

## Unverified

- Whether the refresh job's final message named the ticket edit. I could not see that message. The folder files do not name it.
- `docs:build`, `docs:test`, `docs:shots` and the Proof were not run. This is a plan review, and no stage code exists.

## Notes

**N1. Bun tests and Playwright specs share folders, and CI never runs the stage 07, 09 and 10 unit tests. The Check failure is proven; the Playwright pickup is plausible.**
- `test:unit` (`package.json:15`) does not include `apps/web/e2e`. `test:int` (:16) covers only `apps/server/test` and `tools/fake-telegram/test`. As a result:
  - Stage 07 test 1 (`shotSource`), stage 09 tests 1–5 (`toVtt`, `ffmpegArgs`, `demoDbProblem`) and stage 10 test 1 never run in the Proof or in CI. Their mutation guards run only once, in the worker's job.
- Proven: `bun test apps/web/e2e/docs-shots`, the stage 07 Check at `stage-07-demo-shots.md:42`, fails at HEAD. Bun collects `shots.spec.ts` and errors ("test.describe.configure() … configuration file", 0 pass 1 fail).
- Stage 10's `bun test apps/web/e2e/demo` (:34) will fail the same way once `record.spec.ts` exists. Stage 09's Check fails after stage 10 lands.
- Plausible: `docs-shots.config.ts:14` sets `testDir: "./docs-shots"` with no `testMatch`. Playwright's default match takes `*.test.ts`, so `docs:shots` would load a bun-only `source.test.ts`. The same applies to stage 10's own `demo.config.ts`.
- Two more choices the plan leaves open:
  - Where the "Integration (own DB)" tests live: stage 07 tests 2, 3 and 6, and stage 10 test 4 (`stage-10-demo-record.md:32`).
  - The setup function that stage 10 test 4 calls outside Playwright.
- **Decision needed:** put the pure modules and their tests under a `test:unit` path, or add the folders to `test:unit` with a `testMatch`. Name the integration-test home.

**N2. The cost table's parts do not add up to its total. Proven by running `costToRun` at HEAD.** Rounded cells at 100 mails: 0.43 + 0.36 + 0.05 = 0.84, but the total shows 0.83. At 200 mails: 0.86 + 0.36 + 0.05 = 1.27 against 1.26. `docs/cost-model.md:30-31` has the same rows. A buyer sees a sum that is wrong, and no decision covers it. Review 1's fix (N7) only made total plus margin equal the price. **Decision needed** in `stage-03-pricing-page.md:18`: a "rounded; parts may not add up" line, or another rule.

**N3. Two margin formulas conflict. Plausible: equal at HEAD, different later.** Stage 03 and interfaces use `marginUsd = round2(price − round2(totalUsd))` (`interfaces.md:169`, `stage-03:18`). The doc test uses `round2(PLACEHOLDER_PRICE_USD - cost.totalUsd)` (`apps/server/src/cost-model-doc.test.ts:68`). I checked all three base rows: 24.38, 24.17 and 23.74 come out the same both ways. They diverge when a total lands exactly on x.xx5. Stage 03 test 4 (:25) ties the page to the doc, so a later `pilotCost` update that follows the doc's update rule (`docs/cost-model.md:64`) would break F121 test 4 in an unrelated job. Align one formula.

**N4. Verified: the stage 03 fixed test values are correct.** I ran `costToRun` at HEAD with the doc test's `round2` (+1e-9 shift):
- Estimate rows: totals 0.62, 0.83, 1.26; margins 24.38, 24.17, 23.74; basis `estimate`.
- Measured fixture (1,000 mails, $1.00): LLM 1.5, total 1.905 (float 1.90500000000000002665), rounded 1.91, margin 23.09, basis `measured`.
- `plan.md:87` matches the code and the doc (basis `estimate` at 87 mails).

**N5. Stage 02 tells the worker to use `usedWhenText`, but the docs app cannot import it. Proven by reading; the import failure itself was not run.**
- `stage-02-security-page.md:31` names `usedWhenText`. It lives in `apps/web/src/lib/legal-tables.ts:30`.
- `apps/web/package.json:6-9` exports only `./i18n/en` and `./i18n/pl`. The function takes a panel `Dictionary`.
- The worker must guess: add a web export, move the function to `@ea/core`, or copy it. That is an unnamed interface across apps.
- Its output also prints env key names (`TELEGRAM_BOT_TOKEN`, `VAPID_PRIVATE_KEY`) on the buyer page. `stage-02:16` forbids env names only in claims.

**N6. Q11 is a rule exception but is not labelled as one. Plausible.**
- `questions.md:213` labels it `[important: privacy]`.
- It departs from the owner rule of 2026-11-15 that `plan.md:58` and `:103` quote. `stage-02:15` applies that rule to claims only.
- Q2 and Q4 carry `rule-exception` after review 1 (N3). Q11 should carry it too.
- `flagged-text.test.ts` scans only `.mdx` sources, so component-rendered registry text is never scanned. That is the intended effect of Q11. The owner should see it as an exception.

**N7. The stage 02 dependency on F138 is correct but not complete. Verified for the no-Gemini part; the rest is plausible.**
- F138 stage 02 step 3 removes the `gemini` registry row. That is enough for stage 02 test 8 and stage 12 test 4.
- F138 stage 04 (`…/F138-*/stages/stage-04-adr-and-papers.md:33`) rewrites the ledger in `docs/legal/claims.md`:
  - C038 and C139–C141 get the source `ADR 0037`.
  - The `gemini` mentions leave C182, C184 and C196.
- If an F121 claim cites C182, C184 or C196 and a proof path drops out of the source cell, `claimCheck` fails `docs:build` in F138's job. That job does not know F121.
- **Options:** add "Needs F138 stage 04" to stage 02, or forbid citing those rows until F138 lands.

**N8. Stage 04 step 3 sits outside "Done when" and has no test. Proven by reading.** The pricing → security link step is at `stage-04-home-page.md:40-42`, after "Done when" (:38). No test checks that the link is there. The link check catches a broken link, not a missing one. Stage 05 T4 enforces it only later, through the pl twin. Move step 3 before "Done when" and add one assert.

**N9. Nothing technically stops an e2e-source video from being uploaded. Plausible.**
- D10 says such a video "is never a G3 candidate" (`plan.md:83`, `questions.md:199`). This is prose only.
- The stage 11 release-checklist text (`stage-11-video-on-site.md:43`) says only "`bun run demo:record`; the owner watches it, uploads it". Before G2, that command records the e2e source.
- Add "only when the run logs `demo_source demo`" to the checklist.

**N10. No step creates the follow-up ticket or the `*_demo` database. Proven by reading.**
- D10 and stage 12 (:26) name a follow-up ticket that records from the C1 seed. No coordinator step (C1, C2) or stage creates it.
- Stage 10 needs a `*_demo` DB "passed in the task" (:5). `scripts/limen-prepare.sh:18-43` makes only `<date>-<hash>` names. No step says how the coordinator creates and drops the demo DB.
- A database URL in task text can carry a password into `.limen/jobs/*/task.md`.

**N11. The Needs lines follow `planner.md:53`. Two details. Verified by reading.**
- Every stage names files or interfaces, and none says "stages landed". `plan.md:135` matches all twelve Needs lines.
- Stage 01 says "May run next to 08" (:3). Stage 07 says it may run next to 01 (shared `astro.config.mjs`). Stage 01 should name 07 too.
- Stage 11 needs stage 10 only for a command name in a doc (`stage-11:3`). That puts stage 11 behind 09, 07 and the Playwright lock. `interfaces.md:186` already fixes `demo:record`, so "May run next to 10" fits the rule better.
- Stages 02–05 also run `docs:test` (Playwright) under the flock in their Check lines. The "Playwright stages 07, 10, 11, 12" label (`plan-refresh-1.md:44`) is incomplete. The flock still serializes them correctly.

**N12. Stage 06 holds two deliverables in one job. Plausible.** It builds the OpenAPI generator, refactors a shared fake helper out of the route test, and writes the API page component. It also writes the evidence page from imported constants, with a 3-fact fallback. The file is 561 words, and parts are independent. A split into 06a (`api:spec` + drift) and 06b (two pages) would cut the job risk. All stage files are within 700 words (`wc -w`: largest 700, stage 07). `plan.md` is 1,499 words.

**N13. Other focus items: verified.**
- Stage 06 `alsoOk`: the field exists (`apps/server/src/platform/openapi.ts:19`, emitted at :94). Exactly one route uses it (`apps/server/src/modules/channels/reply-api-docs.ts:32`), so test 5's case exists at HEAD.
- Registry: 11 rows; 10 carry a `<…>` placeholder (all except `telegram`); `gemini` is present until F138. This matches `plan.md:88` and Q10.
- `IMPORT_ORG_NAME = "Kordelan demo (import)"` (`modules/lab/demo-seed/types.ts:6`).
- `importDemo` rejects `example.com` with `non_test_address` (`import.ts:102`, `scan.ts`).
- `publicContentScan` allows `example.com` (`packages/core/src/web/public-content.ts:18`).
- `subprocessors` is exported from `@ea/core/web`; `costToRun` is exported from `@ea/core`.

## Pre-mortem: which stage lets a user-visible bug through

- **Stage 03:** the cost columns that do not add up (N2).
- **Stage 11:** the checklist that lets an e2e-source video reach G3 (N9).
- **Stages 07, 09, 10:** a later regression in `shotSource`, `toVtt` or `demoDbProblem` passes CI because those tests never run there (N1).

## Checks run

- `git rev-parse HEAD && git status --short && test -z "$(git status --short)" && echo CLEAN` → `d8c887f9…`, `CLEAN`.
- `bun install --frozen-lockfile` → 991 packages installed.
- `bun` script calling `costToRun` at HEAD → the values in N4.
- `bun` script over `subprocessors` → 11 rows, 10 with a placeholder.
- `bun test apps/web/e2e/docs-shots` → 0 pass, 1 fail, 1 error (the Playwright spec was collected by bun).
- Not run: `docs:build`, `docs:test`, `docs:shots`, the Proof, lint and typecheck. No stage code exists to check.

## Note check

- HEAD is d8c887f9 and the tree is clean: proven. `git rev-parse HEAD && git status --short && test -z "$(git status --short)" && echo CLEAN` printed `d8c887f9f63e38e0039f648bc336778951399af6` and `CLEAN`.
- Each focus item is checked against repo files with file:line: proven. Evidence: this final message. D10 is in B1. The Needs lines are in N11. Stage 02, F138 and the no-Gemini checks are in N7 and N13. The stage 03 values are in N2–N4. The stage 04 link is in N8. Stage 06 `alsoOk` is in N13. Stage 10 `--seed` and test 4 are in B1 and N1. Q11 is in N6. No command alone proves this item.
- Pre-mortem answered (gaps, conflicts, guess steps, unsourced facts, oversize stages): proven. Evidence: the Pre-mortem section and notes N1–N12 of this message. Gaps: N1, N9, N10. Conflicts: B1, N3, N6. Guess steps: N1, N5. Oversize: N12. Unsourced facts: none found; N13 lists the facts I checked.
- Easy-to-miss rule "Read-only: change no file": followed. `git rev-parse HEAD && git status --short && test -z "$(git status --short)" && echo CLEAN` printed `CLEAN` at the end. The probe scripts lived in the worktree only during their run and were removed. `node_modules` is git-ignored.
