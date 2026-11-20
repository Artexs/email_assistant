# F143 plan review 1

Job: `2026-11-20-f143-plan-review-d7ac5d7f` (Opus 5.5, thinking high). Final message, filed whole:

FAIL aedc8a4c24b2135805fdebd3b4a1bb0bc7bdab16

This is a cold review of the F143 plan (split the files that grew past 400 lines, plus a size lint that warns over 400 and fails over 800). `git rev-parse HEAD` = aedc8a4c24b2135805fdebd3b4a1bb0bc7bdab16, the candidate commit. The tree is clean. Plan-folder citations use `stage-NN:line` and `plan.md:line`. Repo citations use the repo path.

## Blocking

**B1. Six stages split files that tests read as text, and no stage names those tests. Proven by reading the tests against the planned moves.**
The plan's rule (`plan.md:19` D7) is "No importer and no test changes, except the text-reading tests a stage names". Ticket acceptance 5 (`ticket.md:33`) allows asserts to change only in "the tests the stages name". If a worker follows the stage files as written, these tests fail (`test:unit:ci` or `test:int:ci`), or the worker edits a test that no stage names. The plan's "Facts checked" (`plan.md:37`) lists only the readers of `main.ts`. No stage grepped for tests that read its own files.
- **Stage 03 (start-up), `stage-03:10-24,38-39`.** The run tracker removes the `Promise.allSettled([` list and the `xRun = x.run();` lines. These asserts cannot survive the tracker (D9):
  - `composition.test.ts:46-51,79-84` and the push block at `:141-152`, plus the same pattern for report mail and the tripwire (`:165-205`). They check that `allSettled` contains `historyRun`, `contactsRefreshRun`, `pushRun`, `reportMailRun` and `tripwireRun`.
  - `apps/server/test/integration/trust-regate.test.ts:877`: the regex `Promise\.allSettled\(\[[^\]]*\bregateRun,…tripwireRun`.
  - `trust-regate.test.ts:870-873` also requires the `regateAll(… "start")` text before `createCommitterJob(`. `startSource()` joins files in file-name order (`stage-03:38`), and the committer is in `jobs.ts`, which sorts before `triage.ts`. That assert fails.
  - So `stage-03:39` ("No assert changes") cannot hold. Needed: name these tests as changed. Replace the shutdown asserts with a real guard (N3). Replace the order guard with a check of the `start*` call order in `main.ts`.
- **Stage 04 (web root).** `composition.test.ts:247-254,457-466` read `web.ts` for the `mailRoutes`, `mailOAuthCallbackRoutes`, `trustRoutes` and `settingsDeps` calls. Stage 04 moves these into `web-routers.ts` and `web-route-deps.ts` (`stage-04:13-16`).
  - The `postOneClick(` call at `web.ts:446` (in the route mounts) also moves.
  - `platform/outside-services.test.ts:63-70` then fails, and so does `public-http.test.ts:670` (`callers == ["web.ts"]`).
  - Production data in `platform/outside-services.ts:38-41` (`file: "web.ts"`) must change too. Stage 04 forbids that: check 4 at `stage-04:28` and "must pass with no edit" at `stage-04:32`.
- **Stage 07 (privacy maps).** Step 2 (`stage-07:18`) moves `matchesAddress` and `replaceAddress` (`address-map.ts:434-440`) to `address-regex.ts`. Two tests in `apps/server/test/integration/privacy-address-pattern-use.test.ts` then fail:
  - `:11-13`: only `address-map.ts` is excluded from the scan, so the new file is flagged.
  - `:26-30`: reads `address-map.ts` for the SQL text, which is no longer there.
  - `stage-07:39` says "Existing guards, unchanged".
- **Stage 08 (digest, commands, rule suggestions).** `loadBrief` moves to `reports/digest-brief.ts` (`stage-08:12`). Its body reads `firstOfDay` (`reports/digest.ts:185,191`). `modules/channels/consent-gate.test.ts:55-56` allows only `modules/reports/digest.ts` and expects the setter list `["modules/channels/digest-job.ts"]`, so it fails.
- **Stage 10 (e2e seed constants).** `e2e-seed-args.ts` becomes re-exports only (`stage-10:13`). The model pin block (`e2e-seed-args.ts:530`) moves to an `args-*.ts` file. `platform/llm/provider-scan.test.ts:20-21,104-108` then reports the stale entry and the new site as unlisted. `ALLOWED_SITES` is owned by the active provider-registry ticket (F141), which is not in the conflict note (`ticket.md:42`).
- **Stage 11 (e2e seed steps).** `apps/server/src/scripts/e2e-mail-tag.test.ts:72-85` reads `e2e-seed.ts` for every `e2e…Mailbox` use and for the body of `seedAssistMailbox`. Both move into parts (`stage-11:12-16`).

**B2. Stage 09 creates a moved-code file with no history, against acceptance 4. Proven from the text and the repo.**
- `stage-09:30` sends the reset limiter, the terms check, the pwned check and the revoke reports "to a new `auth-password.ts` if no existing file has their topic".
- No existing `auth-*.ts` file has that topic: the files are lockout, mail, mail-texts, sessions-end, sso-required, sso, two-factor and two-factor-reset. So the file will be created.
- `stage-09:57` says "No history merge". Ticket acceptance 4 (`ticket.md:32`) requires that "Every file made by a move keeps its history".
- Needed: a history copy from `auth.ts` for `auth-password.ts`, or a rule that moved code goes only into existing files.

## Unverified checks

- The full proof lanes (lint, typecheck, `test:unit:ci`, `test:int:ci`) did not run: this is a plan review with no code change.
- The F091 scripts at `HEAD` did not run (the plan lists this at `plan.md:43`).

## Notes

**N1. Two stages build a value import cycle that fails when the module loads. Proven with a Bun repro.**
- A repro in the worktree (removed after) gave `ReferenceError: Cannot access 'id' before initialization` for `views.ts → views-approvals.ts → views.ts` with top-level consts.
- **Stage 06** (`stage-06:20-21`): `notices/views.ts` keeps the shared field consts (`id`, `text`, `isoDate`; `views.ts:21-26`) and the kind-to-schema record. `views-approvals.ts` needs those consts at load time, and `views.ts` imports its schemas. That is the same cycle.
- **Stage 07** (`stage-07:12-13`): the slices call `byOrg(...)` at load. `byOrg`, `byOrgExcluding` and `secret` are `const` arrows in `export-map.ts:16-26`, and `export-map.ts` imports the slices. Same crash.
- Tests would catch both crashes, so no user sees them. But each stage cannot be built as written, and the worker must stop and ask (`plan.md:52`). Needed: a leaf file for the shared fields and helpers (for example `notices/view-fields.ts`, `privacy/export-map/kinds.ts`), plus the rule "no value cycle" that stage 08 already has (`stage-08:19`).

**N2. The `SIZE_EXCEPTIONS` life cycle does not enforce itself. Plausible.**
- Stage 01 lists the files over 800 "at `HEAD`" (`stage-01:14`). The stages run in parallel, and the reminder makes every job end with `git merge master`.
- Path 1: stage 02, 10 or 11 lands while stage 01 is in its Sonnet review. Stage 01 then keeps an entry for a deleted file.
- Path 2: stages 10 and 11 each delete their own entry next to the other's. The result can be `SIZE_EXCEPTIONS = []` with the off block still in place.
- In both paths, case 9 (`stage-01:31`) passes: it lints virtual text and loops over zero entries. Acceptance 2 (`ticket.md:30`) then fails at the last land. The edge-case line (`plan.md:31`) assumes stage 01 re-checks, but no step or test makes it.
- Proposed case 9: when the list exists, it is non-empty, a subset of the three D4 files, and each listed file exists with `wc -l` > 800.
- Case 9 also has an open interface. "Exported-in-file" (`stage-01:14`) does not say whether the test imports the constant or reads the text. An import breaks once the last stage deletes the constant.

**N3. After the tracker replaces the old guards, nothing checks that shutdown waits for the runs. Plausible.**
- The current guards (the `allSettled` asserts in B1) go away.
- Cases 1-6 (`stage-03:43-51`) and `main-start-log.test.ts` (SIGTERM → exit 0) all pass if `await runs.settled()` is dropped from shutdown.
- Proposed: a `shutdown` function with injected parts and a unit test of the order `scheduler.stop → telegram.stop (10 s) → runs.settled (30 s) → server.stop → web.close → db.destroy → exit 0`.
- Also, case 3 checks only `settled()`. The scheduler logs `job_failed` only when the callback's promise rejects (`platform/scheduler.ts:25,43`). The test should also check that the callback that `track` returns rejects with the run's error.

**N4. A wrong fact in stage 03. Proven against `main.ts`.** `stage-03:31` says "the start-up re-gate failure exits 1 before any worker exists". At `HEAD`, `mail.sync`, `platform.heartbeat`, `channels.operator` and `ops.slo` are scheduled (`main.ts:162-228`) before the re-gate (`main.ts:264`). The comment there says only "before the triage worker and the committer exist". A worker who trusts the stage text could reorder the start-up.

**N5. Stage 09's part interface leaves out the shared per-instance state. Plausible.**
- `hooksOf(deps)` (`stage-09:30`) gives no way to pass `now`, `report`, the per-instance `resetLimiter`, or the late `codeApi` (`auth.ts:293-311,553`).
- A limiter built per call fails open. `web-reset-request.test.ts:165` would catch that.
- A `codeApi` captured when the parts are built is `null`.
- Needed: name a part context with `getCodeApi()` and a limiter built once.

**N6. Stage 09's size limits may not fit together. Plausible.**
- `stage-09:33` lets `emailAndPassword` and the session fields stay or move. `stage-09:34,52` require `auth.ts` ≤ 400 and `createBetterAuth` ≤ 120.
- My estimate: `auth.ts` is about 400-470 lines after the hooks and helpers move. `auth-two-factor.ts` is 365 and `auth-sso.ts` is 353 before they get their parts.
- There is no fallback rule like `stage-04:18`.
- If `expiresIn` or the password lengths move out of `auth.ts`, `apps/docs/src/reference.test.ts:205,215` fails (it is in the unit lane). That is another unnamed text reader.

**N7. Stage 07 cannot name its slices without guessing. Proven from the key list.**
- The `EXPORT_MAP` keys are alphabetical. Owners interleave (for example `autonomy_trips` (trust) … `history_checks` (trust), and `email_*` (mail) … `mailbox_*` (mail)). Two contiguous slices then want the same `<owner>.ts` name (`stage-07:12`).
- The docs rule "add the key to the slice of its owner" (`stage-07:43`) conflicts with contiguous slices.
- A duplicate key with the same value passes the dump proof (`stage-07:13`). Add a check that the sum of the slice key counts equals the `EXPORT_MAP` key count.

**N8. Stage 11 cannot use a glob for the root deep-import exception, and names a wrong path. Proven.**
- `stage-11:21` names `scripts/module-graph.ts`. The real file is `apps/server/src/scripts/module-graph.ts`.
- `apps/server/src/modules/layers.test.ts:44-48` checks each `rootDeepImportExceptions` file with `existsSync`, so a glob fails. The stage's fallback (list each part file) works.

**N9. Stage 11's proof cannot catch a changed seeded value. Plausible.** The row-count proof (`stage-11:26`) misses a changed value or a wrong organization link. The goal (`stage-11:8`) is "the seeded rows do not change". A dump of the rows without generated ids and timestamps would catch it.

**N10. Gaps in stage 01's size tests. Proven from the case list.**
- The fixture has only code lines (`stage-01:21`). If someone flips `skipBlankLines` or `skipComments` to true, every case still passes.
- Nothing stops `/* eslint-disable size/max-lines-hard */`. Twenty-five source files already use `eslint-disable`. That defeats the ticket outcome "a ticket can no longer grow a file in silence".
- `.astro` files are in the covered set (D2) but have no test case.

**N11. The base worktrees in `/tmp` have no `node_modules`. Proven.**
- The dump and value proofs import the base code from a `git worktree add` in `/tmp` (`stage-05:28`, `stage-07:30`, `stage-10:31`, `stage-11:26`).
- `privacy/address-map.ts` imports `kysely` and `@ea/core`, and `e2e-seed-args.ts` imports `@ea/core`. Neither resolves without `bun install --frozen-lockfile` in that worktree.
- Environment: at review time the user quota on `/tmp` was full. `echo x > /tmp/f143-quota-probe` failed with "Disk quota exceeded". Every stage proof writes its logs to `/tmp/f143-sNN/`.

**N12. `same-bodies.ts` does not check where imports resolve. Plausible.** Stages 04, 06, 07, 08 and 10 trim by hand rather than with `split-repo.ts`. A hand-written import that resolves a name to another module passes `same-bodies` and typecheck when the signatures match.

**N13. The conflict rules are incomplete and conflict with the board. Plausible.**
- `ticket.md:42` and `plan.md:91` leave out:
  - the provider-registry ticket F141 (active), which owns provider-scan `ALLOWED_SITES` (stage 10);
  - the time-constant ticket F145 and the callback-registry ticket F149, which stage 08 lists at `stage-08:46` but which have no spawn rule;
  - F145 and the stale-statements lint ticket F150, which add lint rules to `eslint.config.js` (stage 01).
- `spec/build.md:31` says "file overlaps named in plans are advisory: start the stages". `plan.md:91` says "Do not spawn". These two rules conflict.

**N14. Stage 03 leaves out two lint seams. Plausible.**
- The `platform/cli.ts` zone (`eslint.config.js:89`) targets only `${serverSrc}/*.ts`. `start/**` is not named in `stage-03:32`.
- `plan.md:31,87` say stage 03 edits `layers.json`. Stage 03 never mentions it.

**N15. Stage 03 is big for one job. Plausible.** With B1, stage 03 must also rewrite about fifteen text asserts in `composition.test.ts`, plus `trust-regate.test.ts` and `main.test.ts`. That is on top of the tracker and eight new files. Consider one stage for the tracker and its guards, and one for the file split.

**Checked, no gap:**
- **D1 (the two-severity rule) works on ESLint 9.23.0.** The probe config (registered as `size/max-lines-hard` from `builtinRules`, test ignores, an off block for `e2e-seed.ts`) gave:
  - `delegation/repo.ts` (809) and `e2e-seed-args.ts` (957): warning and error.
  - `e2e-seed.ts` (1259, in the exception block): warning only.
  - `apps/server/test/integration/fixtures.ts` (805): no message.
  - `TwoFactorSection.tsx` (408): warning.
  - Exit 1.
- **ESLint counts lines like `wc -l`.** `max-lines` drops the empty last line after a final newline (`node_modules/eslint/lib/rules/max-lines.js`), so the count equals `wc -l`, and case 10 holds.
- **Stage 03's job list matches `HEAD`.** It has 20 `…Run` variables and 22 `scheduler.add(` calls. The shutdown order matches `main.ts:571-608`. The scheduler skips a tick while a job runs (`scheduler.ts:31,41`), so "newest run only" is equal to `HEAD`.
- **The stage 09 runner semantics match `HEAD`.** `lockSignIn` returns a context override and ends the dispatcher. A throw refuses. Grouping the parts by file in the order sso → password → lockout → sso-required → two-factor keeps the per-path order.

## Checks run

- `git rev-parse HEAD && test "$(git rev-parse HEAD)" = aedc8a4c24b2135805fdebd3b4a1bb0bc7bdab16 && test -z "$(git status --short)" && echo HEAD_OK_CLEAN`: printed `HEAD_OK_CLEAN`.
- `bun install --frozen-lockfile` (Bun 1.4.4, which matches `.bun-version`): 991 packages installed.
- ESLint probe with a temporary `.f143-probe.config.js` (deleted after): results as listed under "Checked, no gap".
- `wc -l` over the tracked non-test lint set: three files over 800, the same as D4 (`plan.md:16`); 42 files over 400.
- Bun TDZ repro (temporary directory in the worktree, deleted after): `ReferenceError: Cannot access 'id' before initialization`.
- Not run: `bun run lint`, `typecheck`, `test:unit:ci`, `test:int:ci`. This is a plan review with no code change.

## Note check

- Verdict line and candidate SHA match: proven. `git rev-parse HEAD && test "$(git rev-parse HEAD)" = aedc8a4c24b2135805fdebd3b4a1bb0bc7bdab16 && test -z "$(git status --short)" && echo HEAD_OK_CLEAN` exited 0.
- Every finding quotes a file and line and carries a label: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-20-f143-plan-review-d7ac5d7f/final-message.md` (B1-B2 and N1-N15 each cite `stage-NN:line` or `plan.md:line` with repo file:line, and each is labelled proven or plausible).
- All five focus areas checked against the repo: proven. The same `final-message.md` covers the ESLint two-severity rule and its test (N10, plus D1 under "Checked, no gap"), the `SIZE_EXCEPTIONS` life cycle (N2), the start-up split (B1, N3, N4, N14, N15), the auth part runner (B2, N5, N6, plus "Checked, no gap"), and the move proofs (N1, N7, N9, N11, N12). The ESLint probe and the TDZ repro ran in commands that piped or used `;`, so they count only as the observations in this file, not as command proofs.
- Easy-to-miss rule (missing code detail is not a finding): followed. Each finding in `final-message.md` names a missing decision, edge case, test or interface, or a conflict. None asks for line numbers or edit text.
- Project reminder (a product-code job ends with `git merge --no-edit master` plus checks and a commit): does not apply. This is a review job that commits no product code, and the reminder exempts review jobs.
