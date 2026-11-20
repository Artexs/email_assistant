FAIL 363e02644d90a2af7ba342ab4e2dbf85a9c77306

The plan is cold-reviewed at HEAD `363e02644d90a2af7ba342ab4e2dbf85a9c77306`, which matches the candidate. There is one blocking finding: the new cases test a new builder, but no case tests that the start-up code or the CLI actually uses that builder. Several notes follow.

## Blocking

**B1. In the pre-mortem, stage 02 lets a broken operator wiring through, and stage 01 does the same for the copy-check opener. Proven by construction from the planned cases.**

The old cases pinned the composition root itself:
- C1 (`apps/server/src/main.test.ts:44-51`) checked that `startOperator` passes the one `operatorSend` to both `createOperatorNotices` and the `ops.slo` tick.
- C3 (`main.test.ts:61-69`) checked that "the job runs that list".
- C5 (`composition.test.ts:232-234`) checked that the `openMailboxProvider` call in `reply-check-copy.ts` passes `oauthTokens`.

The planned replacements call only the new builders:
- Stage 02 cases 1–6 (`stages/stage-02-operator-wiring.md:34-39`) call `operatorWiring(ctx)`. No case calls `startOperator`.
- Stage 01 case 2 (`stages/stage-01-cli-web-release.md:19`) calls `checkCopyOpenDeps`. No case runs the script's opener.

D6 (`plan.md:32`) and stage 02 step 1 (`stage-02:27`) say `startOperator` "calls `operatorWiring(ctx)`, passes `notices` … and `sloTick`". Nothing checks that. Two edits stay green under every planned case:
- `startOperator` gives `createOperatorNotices` a second `createOperatorDelivery(...)`, or a send of `null`.
- The opener in `reply-check-copy.ts` passes `{ db, secrets, openProvider }` inline. This compiles, because `OpenDeps.oauthTokens` is optional (`apps/server/src/modules/mail/open.ts:32`).

This breaks ticket acceptance "Each new case fails when its wiring is removed once" (`ticket.md:26`) and the scope line "Keep what each case guards: the wiring order and the shared context" (`ticket.md:15`). The breaks in D8 and in the stage files remove a line inside the builder only. They never remove the hop from the root to the builder.

C4 is mostly safe, because the input of `committerDeps` requires `oauthTokens` (`composition.ts:149`). C6 tests what the old case tested; the hop from the web stays pinned by `composition.test.ts:451-455`, which P1 keeps.

The planner must take one of these decisions:
- **(a) Test the root.** `StartContext.scheduler` is a plain field (`start/context.ts:16`), and `Scheduler` is `add(name, pattern, fn)` (`platform/scheduler.ts:12`). A test can call `startOperator(ctx, io)` with a fake scheduler, record the `ops.slo` and `channels.operator` functions, and run them. One option is an int test on the job DB, with the fake `io` set to low disk and a fake `late.telegram`: expect one `sendDirect(4242, <slo_disk text>)`. For "shared", let `startOperator` take the wiring as a parameter, and check that both scheduled functions reach the same spy delivery. For C5, the script exports the whole opener, or the `checkDraftCopy` deps, and `main` passes it unchanged.
- **(b) Record a decision with the owner's sign-off.** The decision says that the hop from the root to the builder is guarded by review only, and it narrows "its wiring" to the builder. This changes ticket acceptance, so it goes to `questions.md`.

## Unverified

- **The shape of the F147 stage 04 interface.** It has not landed: `grep createOperatorDelivery apps/` finds nothing. `plan.md:54` already makes a mismatch a question.
- **New-case pass and fail.** I ran no case: the stage code does not exist.

## Notes

- **N1 (proven by probe).** The stage 02 env is refused by the config schema. The probe ran `loadConfig({ DATABASE_URL, CREDENTIALS_KEY, OPERATOR_TELEGRAM_CHAT_ID: "4242" })` and got "Missing or bad config keys: OPERATOR_TELEGRAM_CHAT_ID". The rule is at `platform/config-ops.ts:61-62`: the chat id needs `TELEGRAM_BOT_TOKEN`. Cases 1–2 (`stage-02:32,34-35`) give no token. The fallback at `stage-02:41` ("use the nearest value it takes") does not cover a missing companion key. It also conflicts with the rule at `plan.md:63` ("a deviation … is a question, not a choice"). Fix: add a valid `TELEGRAM_BOT_TOKEN` to the base env of cases 1–3, in the format that `config.test.ts:254` uses. Also state which rule wins. The SLO and backup values of cases 5–6 load (same probe).
- **N2 (proven by read).** The location of the F147 wiring pin is open. F147 stage 04 test 4 adds a source pin in "`main.test.ts` or the `startSource()` test" (`F147…/stages/stage-04-one-delivery.md:49`). F155 stage 02 deletes only "any operator source pin left in `main.test.ts`" (`stage-02:43`), and its Done-when checks only `main.test.ts` (`stage-02:52`). If F147 puts the pin in `composition.test.ts` or `start/jobs.test.ts`, a source-text pin of the operator wiring survives while every F155 check is green. Fix: delete the pin of F147 stage 04 test 4 wherever it lives.
- **N3 (proven by read).** F147 names its delivery two ways. The F147 plan D6 calls it `deliverOperatorText` (`F147…/plan.md:16`). F147 stage 04 calls it `createOperatorDelivery` / `OperatorDelivery.deliver` (`stage-04:12-22`). F155 stage 02 takes the stage 04 names (`stage-02:3,13-22`). The behaviour that F155 cases 2–3 depend on matches stage 04: send `null` gives `true` (`stage-04:23`). If the F147 worker follows D6, F155 stage 02 must stop and ask (`plan.md:54`). Ask the coordinator to make F147 use one name.
- **N4 (proven by read).** The fact behind D3 cites the wrong source. `plan.md:29` says "The int suite already runs retention (`retention-job.test.ts`)". That file runs retention inside a rolled-back transaction with a fixed `NOW` (`test/integration/retention-job.test.ts:101,583`). The spawned `job-run --name platform.retention` commits deletes over every organization of the worker DB, at wall-clock time. This is acceptable: each worker has its own DB and runs its files one after the other (`test/worker-db.ts:36-41`), and `job-run-cli.test.ts` already commits real jobs. Correct the cited fact. `retention_done` is written on every run that does not throw (`retention.ts:224`).
- **N5 (plausible).** The break of stage 02 case 6, "remove the backup entry" (`stage-02:39`), also fails case 4. It never shows that the entry uses `io.readFile`. "The entry ignores `io.readFile`" matches the case. The production default `io` (`stage-02:25`) has no case; the risk is low.
- **N6 (proven by probe).** The main.ts fact at `plan.md:46` holds. The spawned `main.ts` with that env exits 1. Stdout holds `features_off` with `"release":"f155-r1"`, and stderr holds `db_role_check_failed` with the same release.
- **N7.** The interface that stage 02 takes from F147 stage 04 matches: `createOperatorDelivery({ send, log })`, `deliver(alert, text): Promise<boolean>`, and `delivery` on both `OperatorNoticeDeps` and `SloTickDeps` (`stage-04:12-25`). `OperatorDelivery` keeps state, so one shared object also shares the per-key failure-log dedupe. That supports the `toBe` check in D7.
- **N8.** The sizes are within the limits of `.agents/limen/planner.md` § Plan size. `wc -w` gives plan.md 1252 (§ Planning progress records 1181, written before the § Cold review section), stage 01 506, stage 02 547, ticket.md 277. Each stage fits one job.
- **N9.** The callers-list case (`composition.test.ts:245-271`) stays true under D4. `\bcommitterDeps\(` does not match `jobRunCommitterDeps(`, and the builder bodies still call `committerDeps(` and `openMailboxProvider(`.

## Checks run

- `git rev-parse HEAD`: `363e02644d90a2af7ba342ab4e2dbf85a9c77306` (clean tree).
- `bun install --frozen-lockfile`: 991 packages installed.
- A `loadConfig` probe with the stage 02 envs: the chat-id env is refused; the SLO and backup env loads.
- A spawn probe of `main.ts` with the env at `plan.md:46`: exit 1, and both JSON lines carry `release: "f155-r1"`.
- Code reads: `start/operator.ts`, `start/context.ts`, `start/jobs.test.ts`, `main.test.ts`, `composition.test.ts`, `scripts/job-run.ts`, `scripts/reply-check-copy.ts`, `web-route-deps.ts`, `modules/operator/slo-checks.ts`, `modules/operator/slo-job.ts`, `platform/config-ops.ts`, `retention.ts`, `test/worker-db.ts`, `test/integration/job-run-cli.test.ts`, and the F147 plan and stage 04.
- I ran no test suite, lint or typecheck: this is a review job. Both probes were throwaway scripts in a temp folder inside the worktree, deleted afterwards.

## Note check

- **HEAD is the candidate:** proven. `git rev-parse HEAD` printed `363e02644d90a2af7ba342ab4e2dbf85a9c77306` (a single command that exited 0).
- **The interface stage 02 takes from F147 stage 04 matches:** proven, with the naming drift reported as N3. Evidence: `spec/features/active/F147-one-operator-alert-path-with-texts-in-core-and-one-locale-type-exist/stages/stage-04-one-delivery.md` (lines 12-25 and 49) and `…/plan.md` line 16.
- **Plan facts checked against code at HEAD:** proven by these files:
  - `apps/server/src/start/operator.ts`
  - `apps/server/src/platform/config-ops.ts`
  - `apps/server/src/retention.ts`
  - `apps/server/src/scripts/job-run.ts`
  - `apps/server/src/scripts/reply-check-copy.ts`
  - `apps/server/src/web-route-deps.ts`
  - `apps/server/src/modules/operator/slo-checks.ts`

  The two probe results (config refusal, main.ts release stamp) came from bash calls joined with `;`. They are evidence in this report, but they do not count as command proof under Limen's rule.
- **Final message form (first line, file:line, labels):** proven. Evidence: this message.
- **Easy-to-miss rule (no suite, lint or typecheck in a review job):** followed. The commands I ran were `git rev-parse`, `bun install --frozen-lockfile`, file reads and greps, and two probe scripts. No `bun test`, `test:*`, `lint` or `typecheck` ran.
- **Reminder "tests run once per job; no `test:unit`, `test:int` or `test:e2e`":** followed. No test command ran.
- **Reminder "a job that commits product code runs `check:job`":** does not apply. This review job committed nothing.
- **Reminder "a review job runs no suite, lint or typecheck":** followed (same evidence as the rule above).
- **Reminder "never delete `node_modules/.cache/`":** followed. I deleted only the temp probe folder `.tmp-review`.
