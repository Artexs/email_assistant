PASS 64591565048a197f3fa8f502f02255d8fada43f6

The refreshed plan is true for the code at the candidate. I found no blocking finding: no step, if a worker follows it, breaks a ticket acceptance bullet. I found 14 notes. Notes 1–4 are the ones most worth fixing before stages 01–04 build. `git rev-parse HEAD` = 64591565048a197f3fa8f502f02255d8fada43f6, the same as the candidate. The commits after the base `54b715b` change only the F097 plan files. `git status --short` was empty: I edited no repo file.

## Blocking findings
None.

## Unverified checks
- I did not run the stage proofs (lint, typecheck, `test:unit:ci`, `test:int:ci`). This is a review of a plan, and no candidate code exists yet.

## Pre-mortem: which stage lets a bug reach the user
- **Most likely: stages 03 and 04, if they land before F098 stages 06–12.** D39 (`plan.md`, D39 line) covers only the order "F098 landed first".
  - F098 does not know about `/review`. `grep -n "F097\|review"` in the F098 stages finds nothing.
  - F098 stage 11 keys `texts.bot.commands` by the literal list of 5 commands, and its type test checks that this list equals `commandNames` (`F098 stages/stage-11-bot-texts.md:70`).
  - The result: after the F098 switch-on (stage 12), a Polish user gets an English `/review` page, an English review picker and an English menu entry. The other alternative is that the F098 stage 11 worker must make up the Polish text.
  - No rule in F097 covers this order. How to run 3 says only "the later job merges `master`".
- **Second: stage 01.** It makes the backfill silently skip test-sender mail (note 1).

## Notes

1. **Stage 01: `requeueTooOld` changes behaviour, and no rule decides it.** Proven by reading the code.
   - `stage-01-test-senders.md`, step 2 lists `requeueTooOld ~171` as a caller of the new `mailKindFilter(kind, rule)`, and the goal says "SQL 'real' excludes test senders".
   - `mail/repo/claims.ts:155-174` is the re-queue of `mailbox:backfill` (`triage/backfill.ts:16`). It is not a real-label reader.
   - If the worker passes `testMailRule(config)`, a backfill stops re-queueing AgentMail mail. Then `docs/capabilities/sync.md:35` ("re-queues real mail of the window") is false, and stage 01 step 4 does not update `sync.md`.
   - The stage must say which rule to pass (`NO_TEST_SENDERS`, or the rule plus a `sync.md` line). The same question applies to `listUsageSince` (`triage/repo.ts:360-384`), which the plan names only as "the third at ~384". It changes `triage:cost --mail real`.

2. **Stage 01 step 4 names the wrong lines on `actions-and-undo.md`.** Proven by `sed`.
   - The step names "~lines 49 and 131". The main definition is at `docs/capabilities/actions-and-undo.md:12` (rule 2: "`synthetic` claims mail with a synthetic `Message-ID` only"). After stage 01 that line is false.
   - The `.env.example:47` and `:51-52` comments ("synthetic = … (@ea-seed.test Message-IDs)") also become stale, and no step updates them.

3. **D39 when only part of F098 has landed.** Plausible.
   - The D39 trigger is "`packages/core/src/texts/index.ts` exists", which comes with F098 stage 06. But `texts.bot` and `texts.bot.commands` come only with F098 stage 11.
   - Stage 04 says that "`/help` and the command menu come from `texts.bot`". If only stage 06 has landed, this cannot be done, and the worker must guess.
   - Stage 04 test 7 checks `helpText()`. F098 stage 11 deletes `channels/texts.ts` (`stage-11-bot-texts.md:11`). Stage 04 also does not say to add the `/review` line to `texts.bot.help` (en and pl).

4. **Stage 04 conflicts with F099 stage 12 on the flag count.** Proven by reading both stages.
   - F097 stage 04 step 1 says "a fourth row" in `tenancy-features.test.ts`, and step 3 says "four flags" on `tenancy-and-plans.md`.
   - F099 stage 12 adds `security_log` as "a fourth entry" (`F099 stages/stage-12-security-log-route.md:39`).
   - The job that lands second gets the count wrong on the page. The stage should say "every key in registry order" and "the flag count at your commit".

5. **Stage 04 step 1 has a wrong instruction for `web-operator.test.ts` case 4.** Proven at `apps/server/test/integration/web-operator.test.ts:103-116`.
   - The title "three keys per row" means the keys of each row object: `Object.keys(row)` equals `["enabled","flag","orgId"]`. That stays true after the change.
   - The edit that is needed: a fourth flag row, and a fourth `false` at line 112. The instruction "four keys per row; rename the test title" makes the title false. The same error is in plan F21.

6. **Stage 04 step 3 leaves a false line on the tenancy page.** Proven by reading the page.
   - The step updates only `tenancy-and-plans.md:93`.
   - `docs/capabilities/tenancy-and-plans.md:31` ("No code outside the CLI reads a flag yet: `isFeatureOn` has no caller in the server") also becomes false after stage 04.

7. **The 400-line rule meets other large files that D38 does not cover.** Plausible.
   - `platform/config.ts` is 493 lines, and stage 01 adds to it. F20 does not list it.
   - Stage 16 step 3 still adds the judge to `triage/eval.ts` (557 lines: `runCase`, `CaseResult`, the state schema). D38 moves only the stage 13 pool out of it.
   - `scripts/eval.ts` (245 lines) grows in stages 01, 13, 14, 15 and 16. No split is planned, so it can pass 400 lines.

8. **Plan F13 gives a wrong location for `pickedText`.** Proven by grep.
   - F13 says that `pickedText` is "in `channels/callbacks.ts`". It is defined at `packages/core/src/digest/answers.ts:26` and only called at `callbacks.ts:156`.
   - F098 stage 06 also changes its signature (adds `texts`, `F098 stage-06:96`). D39 covers that change.

9. **Stage 01 step 3 does not name all the shapes it changes.** Plausible: the worker can find them through type errors.
   - `TriageScope` (`triage/jobs.ts:25`; built in `main.ts:45-56`) must carry the rule.
   - `triage/service.ts:472` needs the rule from its deps.
   - `getEmailMailbox` (`mail/repo/emails.ts:130`) must return `fromAddress` for `actions/undo.ts:43`.

10. **Stage 14 step 1 says "import it" for a function in the same file.** Plausible confusion only.
    - `wilsonInterval` would already be in `packages/core/src/triage/metrics.ts`, which is the file that stage 14 edits.
    - F100 stage 08 also clamps the bounds to [0, 1], and D23 does not say that. The stage should say "check the clamp too".

11. **The stage 21 step 3 check exits with code 1 when it succeeds.**
    - `grep -c "go/no-go" docs/code-patterns.md .agents/limen/styleguide.md` prints `…:0` for each file, but grep exits 1 when no line matches.
    - If a worker adds `&& echo OK` after it, the check reads as a failure. Use `! grep -q …` or `grep -c … || true`.
    - The three places in F22 are correct: `docs/code-patterns.md:75`, `:149`, `:223` and `styleguide.md:30`.

12. **Stage 03: rule 10 of the triage page lists no `/review` source.** Plausible.
    - Step 4 updates § Data (`triage.md:105`), the Entry points row (`:67`) and § Tests.
    - Rule 10, "Feedback sources" (`triage.md:40`), lists each tap source, but no stage adds the `/review` page to it.

13. **Stages 01 and 03 are large for one job.**
    - Stage 01 now has 4 steps and touches about 25 files: every `mailKindFilter` caller, the scopes, the integration tests and 2 capability pages.
    - Stage 03 has 4 steps: the migration, a new repo file, 4 callback kinds, the new `review-taps.ts` and 2 pages.
    - Both are still possible, but they are the most likely to time out. Stage 11 (about 350 lines plus the runbook) is accepted from review 1.

14. **Stage 13 step 1 has a wording conflict.** It says "`runEval` … keeps its signature", but the input gains `concurrency` and `budget`. The fields are optional, so a worker can do it. This is wording only.

## Refresh facts I checked and found true
- `config.ts:406` (`sendTestAddresses`) and `config.ts:261-268` (the `SEND_TEST_ADDRESSES` check, only under `SEND_SCOPE=self`).
- The `.env.example` order: `SEND_TEST_ADDRESSES=` at :59, before `SEND_LIMIT_*`.
- `mail/repo/emails.ts:11` (`mailKindFilter`).
- `mail/repo/claims.ts:65` and `:171`; `mail/repo/lookup.ts:25`.
- `actions/repo/claims.ts:92`; `actions/repo/filters.ts:17`; `actions/scope.ts`; `actions/undo.ts:43`.
- `triage/repo.ts`: 272, 322, 384, and `listUnlabeled` at 245.
- `triage/service.ts:472`; `triage/jobs.ts:121`.
- File sizes in F20: 629, 393, 299, 557, 245, 214 lines.
- F21: the three test files and their lines. `grep sent_sync` finds no other test file that lists every flag.
- F22: the three places and the styleguide line.
- The capability pages and rules that the stages name: `triage.md` rules 6, 12, 13 and 15, Entry points, Data; `digest-and-notices.md` rules 9 and 10, rows 72, 73 and 86; `tenancy-and-plans.md:93`.
- `eval.ts:156`, `:196`, `:444`, `:468`.
- `.env.example:18` and `:25-29`; `mapper.ts:81`; `batch.ts:3`; `message.ts:15`; `feedback.ts:75-79`; `fixtures.ts:53`; `categories.ts:31`; the CHECK at `20261104000001_triage.sql:49`; `evals/testmail/README.md:88`.
- 108 eval cases (12 + 16 + 80).
- The F098 D9, D18 and P6 texts; F100 F7 (`reviewMessage`, `metrics-repo.ts`); F100 stage 08 Wilson check.
- `featureEpicPattern` accepts `E2a`.
- `packages/core/src/texts/` exists already (only `locale.ts`), so D39 is right to test for `index.ts`.

## Checks I ran
- `git rev-parse HEAD` → `64591565048a197f3fa8f502f02255d8fada43f6`.
- `bash scripts/plan-drift.sh spec/features/planned/F097-e2a-offline-lab 54b715b` → "named paths: 123; changed since base: 0; gone: 0; no drift".
- `bun install --frozen-lockfile` → exit 0.
- `bun test apps/server/src/capability-map.test.ts` → 12 pass, 0 fail. This shows the baseline that the new page steps check against.
- One bash call of `git rev-parse HEAD && git status --short && sed -n …` over the key refresh lines, joined only with `&&`. It exited 0, printed the candidate sha and no status lines, and showed each cited line.

## Note check
- Refresh items checked against the code at 64591565: proven. `git rev-parse HEAD && git status --short && sed -n 11p apps/server/src/modules/mail/repo/emails.ts && sed -n 406p apps/server/src/platform/config.ts && … && wc -l apps/server/src/modules/triage/repo.ts …` (one bash call, `&&` only, exit 0). This call covers the main cited lines. The other items in "Refresh facts I checked and found true" came from earlier calls that used `;`, so for those items the evidence is the reading, not a run that counts as proof.
- Findings cover the pre-mortem, gaps, rule conflicts, guess-steps, unsourced facts and oversize stages, each with a mark and file:line: proven. The evidence is this final message (§ Pre-mortem and Notes 1–14, each marked as a note and labelled proven or plausible).
- First line is `PASS <sha>`, and HEAD matches the candidate: proven. The same `git rev-parse HEAD && …` call printed `64591565048a197f3fa8f502f02255d8fada43f6`.
- Easy-to-miss rule "Do not edit files.": followed. The same `&&` call ran `git status --short` and printed no lines. The only file I wrote is the job note outside the worktree (`/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-14-f097-plan-review-refresh-1-492740db/note.md`), which the Limen prompt requires.
