# F087 plan review 1

> Final message of the review job `2026-11-13-f087-plan-review-2-edbd7c0c` (Opus 5.5, high; candidate 49a3c6c), filed whole. The first review job (`2026-11-13-f087-plan-review-399ca072`) stopped on the Claude quota and gave no result. The job's last turn (the note check) follows the review message.

PASS 49a3c6cec452a14bea19d1c812ece51c9720dcc2

The plan can ship. No finding proves that any stage breaks one of the six acceptance lines in the ticket. The pre-mortem points to stage 2 as the most likely place for a bug to get through, because of N1. Stage 1 (N3) and stage 3 (N5) come next.

**Blocking findings:** none.

**Unverified checks:** none. The candidate changes only `spec/` files (`git diff --stat cb3a447 49a3c6c`: 8 files, all under `spec/features/planned/F087-feature-flags/`), so lint, typecheck and the test suites do not test this candidate. I did not run them.

## Notes

### Gaps: events that no rule covers

- **N1 (plausible; the mechanism is proven by reading the code).** Stage 2 has no test that makes entry points call `configureFeatures`.
  - D9 (`plan.md:54`) copies the shape of `configureMailHosts`, but not its guard test. `apps/server/src/scripts/mail-hosts-configured.test.ts:19-37` fails when `main.ts` or a mail script leaves out `configureMailHosts(`. Nothing like it exists for flags.
  - Stage 2 configures only `main.ts` (`stage-02-table-and-read.md:83-89`). `scripts/job-run.ts` runs the same jobs from the CLI, and stage 2 does not configure it.
  - Pre-mortem: E5a reads `sent_sync` in `mail.sync`, and the operator runs `bun run job:run mail.sync` for the pilot. The flag reads off, prints one warn line, and Sent sync silently does not run.
  - Fix: in stage 2, add a `features-configured.test.ts` that does the same job as the mail-hosts test, for every entry that imports `isFeatureOn` or `featureStates`.
- **N2 (plausible).** A row set to off stays off and nothing can clear it.
  - U2 (`plan.md:143`) and Q4 (`questions.md:8`) turn `stats_page` on and then off again for the pilot.
  - Under D11 (`plan.md:56`), that leaves an explicit `enabled=false` row. D12 (`plan.md:57`) provides no command to delete a row.
  - Result: if E3a later turns the flag on by changing the default, the pilot (the first organization that should see the feature) stays off.
  - Fix: make U2 use a test organization, or tell the E3a plan to run `--on` for the pilot.
- **N3 (proven by running the regex over `docs/product/stage-2/05-execution-plan.md`).** The epic pattern rejects real epic codes.
  - The pattern is `^E\d{1,2}[a-z]?(-[A-Z])?$` (D19 `plan.md:64`, `stage-01-registry.md:35`).
  - It rejects `E7-T1` to `E7-T7` and `E8-LR`, which are codes in the execution plan table.
  - A later flag whose owner is E7-T2 fails stage 1 test 1 (`stage-01-registry.md:52`), and the worker must guess whether to change the regex.
- **N4 (plausible; the code order is proven at `http.ts:320-322` and in `stage-04-operator-check.md:34-38`).** An operator's own suspended organization blocks future operator writes.
  - `refuseSuspendedWrites` runs after `requireOperator` (D15 `plan.md:60`).
  - So a later POST under `/api/operator/*` (for example, E7 resuming another organization) gets `403 org_suspended` when the operator's own organization is suspended.
  - Stage 4 test 10 (`stage-04-operator-check.md:122`) covers only GET. Record this for E7, or add the prefix to `SUSPENDED_WRITE_ALLOW` when E7 adds writes.

### Steps where a Sonnet worker must guess

- **N5.** Stage 3 CLI cases 2 and 3 (`stage-03-write-and-cli.md:109-112`) conflict with the test setup.
  - The organizations are "deleted in `afterEach`", but case 3 ("The same again → `already on`") needs the row that case 2 wrote.
  - If case 3 is its own test, it gets `unset → on`.
  - Fix: state that cases 2 and 3 run in one test.
- **N6.** Stage 2 test 1 (`stage-02-table-and-read.md:101-102`) says to use "the savepoint helper of `auth-public-schema.test.ts`" for code `23505` as well.
  - That helper is local, not exported, and hardcodes `23514` (`auth-public-schema.test.ts:23-27`).
  - Fix: tell the worker to copy it with a `code` parameter.
- **N7.** Stage 4 says to build the http.test app "as the `requireTenant` tests do". Those tests set only `session` (`http.test.ts:189`), but `requireOperator` reads `c.get("web")`. The worker must invent a partial `WebDeps`.

### Rules that conflict

- **N8.** `plan.md` contradicts itself about the cold review.
  - Lines 3 and 17 say the cold review is done and its fixes are logged (`plan-review-1.md`).
  - Line 190 ("Cold review") says "Not run yet", and no `plan-review-1.md` exists in the feature folder.
  - This is drift for the coordinator to repair.
- **N9.** D9 and stage 2 disagree on the signature of `isFeatureOn`.
  - D9 (`plan.md:54`) rejects "a fourth argument on every `isFeatureOn` call".
  - Stage 2 (`stage-02-table-and-read.md:66-71`) exports an optional fourth argument, `settings`.
  - Any caller can pass `{ configured: true, off: new Set() }` and skip `FEATURES_OFF`, and the stage 5 standard does not forbid it.
  - Fix: keep the parameter internal, or add an "Avoid" line to the styleguide.
- **N10 (plausible; F086 has not landed).** F086 D6 (`spec/features/planned/F086-module-borders/plan.md:20`) will add a checklist that conflicts with stage 2.
  - The checklist says "a new table with `org_id` joins the tenant-filter test, the organization delete and the DSR map".
  - Stage 2 covers the cascade and the tenant filter only. No organization-delete test or DSR map exists (a grep finds no `information_schema` test).
  - The stage 2 worker reads `docs/code-patterns.md` first and meets a checklist it cannot meet. Stage 5 handles merging that text (`stage-05-standards.md`); stage 2 does not.
- **N11.** The ticket names two signatures.
  - Outcome (`ticket.md:9`): `isFeatureOn(ctx, flag)`.
  - Acceptance (`ticket.md:24`): `isFeatureOn(db, ctx, flag)`.
  - The plan follows the acceptance line. This is ticket drift to report, not repair.

### Facts used without a source

- **N12.** `plan.md:111` says "Integration tests run in parallel with other test files in one process". Nothing supports this.
  - `test:int` is `bun test apps/server/test tools/fake-telegram/test` (`package.json:16`), and `bunfig.toml` sets no concurrency.
  - The rule it leads to is conservative, so it does no harm.
  - The warn-once state of stage 2 test 6 (`stage-02-table-and-read.md:107`) shares one module across all files in the process and has no reset. The test passes only while no other test reads with unconfigured settings.

### Stage size

- **N13 (judgement).** Stage 4 (~300 lines, `plan.md:166`) is the largest-risk job.
  - It adds the auth guard and the first cross-tenant read, and it touches config, http, a router, a core type, `web.ts`, docs and four test files with 19 cases.
  - One review must judge both risks. Splitting 4.1 (guard) from 4.2 (route) would keep each review focused.
  - Stage 3 (~300 lines) is large but low risk.

### Claims checked and true

- `listOrganizations` orders by `created_at`, then `id` (`tenancy/repo.ts:73-87`), and is a listed exception (`docs/code-patterns.md:33`).
- `lockOrganization` uses `FOR NO KEY UPDATE` (`repo.ts:129-130`), and the transaction shape of `setOrgPlan` matches (`service.ts:170,228`).
- `audit_log` has no CHECK on `event` (`20261104000001_triage.sql:103-120`).
- The default privileges come from the migrator (`20261103000001_app_grants.sql`).
- `log.warn` writes to `console.error` (`log.ts:26-28`).
- The preload is in `bunfig.toml`.
- `WEB_TRUSTED_PROXIES` refuses a bad entry (`config.ts:242`).
- `http.ts:5` imports `@ea/core`.
- `makeWeb` is at `web-http.test.ts:54`.
- The route walk in `web-suspended.test.ts:86-88` skips GET and ALL, so the new route and the guard do not break it.
- `db:worktree` runs migrations on a fresh job DB (`db-worktree.ts:97,173`), so stages 3 and 4 do not depend on owner step U1.
- `z.uuid()` in zod 4.6.7 accepts upper-case input.
- No new export name collides with an existing one in `packages/` or `apps/`.

### Checks run

- `git rev-parse HEAD` printed `49a3c6cec452a14bea19d1c812ece51c9720dcc2`, which matches the candidate.
- Bun `.env` probe in a temp folder (Bun 1.4.4): `FOO=` stays `""` and the `.env` file does not override it. So the `FEATURES_OFF = ""` line in the preload does protect the CLI tests.
- P2 Hono probe against hono 4.13.16, installed into a temp folder outside the repo and deleted after. The guard runs for:
  - `/api/operator`, `/api/operator/`, `/api/operator/flags`, `/api/operator//flags`, `/api/operator/flags/`;
  - `/api/operator/%66lags`, `/api/%6fperator/flags`, `/api/./operator/flags`, `/api/me/../operator/flags`.

  It does not run for `/api/me`, `/api/operatorx` or `/api/OPERATOR/flags`, and none of those reach the handler. P2 holds.
- Regex check of the epic pattern over the codes in `05-execution-plan.md`: 8 codes are rejected (N3).

---

PASS 49a3c6cec452a14bea19d1c812ece51c9720dcc2

The plan can ship. No finding proves that a stage breaks an acceptance line. My review message above holds the full findings (N1–N13) with file and line citations.

## Note check

- HEAD equals the candidate: proven. `git rev-parse HEAD && git status --short && test -z "$(git status --short)" && echo CLEAN` exited 0 and printed `49a3c6cec452a14bea19d1c812ece51c9720dcc2`.
- Each finding quotes a plan file:line and a code file:line: not proven. No command or file proves this. The evidence is only my previous message, where findings N1–N13 cite plan, stage, ticket and code lines.
- Plan claims checked against `apps/server/src`, `packages/core`, `db/migrations` and the tests: not proven. I read and grepped those files, but every one of those bash calls joined commands with `;` or a pipe. The Hono probe in `/tmp` was deleted and has no saved log.
- Easy-to-miss rule "Read only; change no file": followed. `git rev-parse HEAD && git status --short && test -z "$(git status --short)" && echo CLEAN` exited 0 and printed `CLEAN`. The only file I wrote is the Limen job note, which is outside the worktree.
