FAIL b33b67d68ac2d73a976ac2f82a904f6530a3f784

I reviewed the F147 plan: `ticket.md`, `plan.md`, `questions.md` and stages 01–04 at the candidate commit. `git rev-parse HEAD` gives b33b67d68ac2d73a976ac2f82a904f6530a3f784, so HEAD matches the candidate, and the tree is clean. One finding blocks: the plan changes operator log levels without saying so. Stage 04 would ship that change, and after it a lost event notice no longer shows up as an error line.

## Blocking

**B1. Stage 04 (D7) changes log levels that `questions.md` Q2 does not tell the owner about. A lost event notice then drops out of the error-line check.** Proven by reading the code and docs.

- What changes:
  - Event detector failures are `error` now: `operator_notice_failed` at `channels/operator.ts:135,151,191` and `operator_notices_failed` at `:209`. Stage 04 step 2 turns them into `warn operator_check_failed`.
  - Service-level send failures go from `warn` to `error`: `slo_alert_send_failed` at `operator/slo-job.ts:102`.
  - Service-level state failures go from `warn` to `error`: `slo_check_failed` at `slo-job.ts:49`.
  - Q2 names only one change: info→warn with no chat.
- Why it matters:
  - The release and watch checks count `level:error` lines (`deploy/README.md:154` `filter level:="error"`; `notes/2026-11-15-vps-deploy-queue.md:17,25,80,90,100` "0 error lines").
  - After stage 04, a DB failure that stops `trial_ending`, `auth_error_24h` or `send_limit` detection is only a `warn`.
- Conflict with the stage's own test text: the moved tests assert `level: "error"` with no `kind` (`channels-operator.test.ts:606-607`, `:625`, `:641`). Stage 04 test 2 says "only the log names change".
- Fix: give each D7 line an explicit level. Keep event-path detector failures at `error`, or make `operator_check_failed` an error. Put every level change into Q2. Add the expected level to stage 04 test 2.

## Unverified

None. I ran no suites; the plan holds no code to prove.

## Notes

1. **Note (proven by reading).** D7 has no class for the event hook guards: `capReached`, `authMailFailed` and `sendLimitReached` throwing on an invalid date (`channels/operator.ts:220-239`). The test at `channels-operator.test.ts:614-630` pins them. These are neither "a check or detector" nor "a state read or write". The `runRetries` part has no single `kind` for `operator_check_failed { kind }`; HEAD logs no kind there (`:209`). A worker must guess both.
2. **Note (proven by reading).** D13 makes the locale required, and two stage rules say the tests do not change:
   - Stage 01 test 5 says `ops-slo-job.test.ts` stays unchanged, but `runSloTick` and `sendTestAlerts` without `locale` stop compiling (`ops-slo-job.test.ts:324`).
   - Stage 03 test 1 says only the import path and types change, but about 25 calls `createOperatorNotices({ db, now, send })` have no locale (`channels-operator.test.ts:133`…).
   - With the rule "a deviation is a question", a strict worker stops here. Say "tests add `locale: \"en\"`".
3. **Note (proven by reading).** Stage 04 does not say which `status` an event delivery logs. HEAD event lines carry `{ kind }` only (`channels-operator.test.ts:257`); test 1b suggests `open`. Decide it in the plan.
4. **Note (plausible).** Stage 03 says "notify takes the event". At HEAD the key and the text are built inside the synchronous `try` of each hook (`channels/operator.ts:214-232`). If `notify` calls `operatorEventKey` or `renderOperatorEvent` before its first `try` (`:74-79`), an invalid date rejects the `void start(...)` promise and causes an unhandled rejection. The moved test at `:614` would catch it, but the plan should state where the key and text are built.
5. **Note (proven by reading).** The lint guard misses the commonest copy in the repo:
   - A `["pl","en"] as const` list with a derived `typeof` type, the shape of `legalLangs` (`apps/web/src/lib/legal.ts:1-3`).
   - `z.enum([...] as const)`.
   - The ticket Outcome says "the lint finds a copy"; acceptance bullet 5 is narrower. Decide whether that gap is accepted.
6. **Note (plausible).** The ignore list goes by folder. A new mail-language `"pl" | "en"` in a module outside it (for example delegation, contacts or channels) fails with "Use UserLocale". That pushes the worker into the merge that D10 rejects. Name the escape: an `eslint-disable` with a reason, or a named mail-language type such as `ReplyLanguage` (`packages/core/src/replies/eligibility.ts:24`).
7. **Note (proven by reading).** No stage runs ticket acceptance bullet 4 (`bun run ops:alert-test --all` prints ten lines). Stage 04 tests only the parser and `sendTestAlerts`. Add a no-chat run that expects ten `unsent <kind> no_chat` lines (format at `apps/server/src/scripts/ops-alert-test.ts:40`).
8. **Note (proven by reading).** The stage 04 test list skips case 3, but its Done-when says "Cases 1–8 hold".
9. **Note (proven by reading).** D11 links `legalLangs` to `userLocales`. The legal version digest hashes per language (`apps/web/src/lib/legal-checks.ts:79`, pinned by `legal-version.test.ts`). It stays the same today because the order is equal. A third UI locale, though, will need legal docs and a new digest, so "a third language is one edit" is not true for the legal pages. That is fine, but write it down.
10. **Note (proven by reading).** The start-up line `operator_notices_on` (`main.ts:205`) keeps the old name; the acceptance search pattern does not match it. Decide to rename it or keep it. The comment at `main.ts:207` names `slo_alert_sent`, and the stage 04 search will find it.
11. **Note (proven by probe).** The plan's "Not verified" item is now settled. Under the repo `eslint.config.js`, a local rule sees the `TSUnionType` `"en" | "pl"` in `.astro` frontmatter. A second config block with `plugins: { ea }` (the same object) also loads with no error, which an `.astro` block needs because the existing `ea` block covers only ts/tsx/js/mjs (`eslint.config.js:313`). Probe: `/tmp/f147-review/probe2.mjs`.

Facts in the plan that I checked and found true:
- Layers: channels is the 4th layer and operator the 5th (`layers.json`); operator already imports channels (`slo-checks.ts:19`).
- The `ops_alerts` CHECK lists the five `slo_*` kinds (migration, line 6), and `docs/code-patterns.md:195` records the owner exception.
- `telegramErrorFields` is not exported from the channels index (`channels/index.ts:59`).
- `apps/docs` depends on `@ea/core`.
- Key epoch: `bun -e` gives 1794996000000 for 2026-11-18T10:00Z.
- The stage 04 expected test texts match `texts/operator.ts:33,36`.
- `userLocales` is `["pl","en"]` (`tenancy.ts:11`) and `@ea/core/web` exports it (`web/index.ts:42`).
- `tenancy.ts` imports only zod, so the push service worker can import it.

Stage sizes are within the plan-size rule (691/644/693/699 words), and no stage is too big for one job.

## Checks run

- `git rev-parse HEAD && git status --short`: b33b67d68ac2d73a976ac2f82a904f6530a3f784, clean tree.
- `bun install --frozen-lockfile` (Bun 1.4.4): 991 packages installed.
- ESLint probe against the repo config:
  - `.astro` frontmatter: the rule reported `UNION "en" | "pl"`.
  - Second `ea` block: loaded with no error.
- I ran no lint, typecheck, unit or integration suites, because the plan changes no code.

## Decisions for the owner

None.

## Note check

- Plan decisions checked against the code at b33b67d: proven. Evidence: `apps/server/src/modules/channels/operator.ts`, `apps/server/src/modules/operator/slo-job.ts`, `apps/server/src/modules/operator/alerts-service.ts`, `packages/core/src/texts/operator.ts`, `packages/core/src/ops/kinds.ts`, `apps/server/src/main.ts`, `eslint.config.js`, `tools/eslint-rules/index.js`, all cited with lines above. The probe is `/tmp/f147-review/probe2.mjs`.
- Pre-mortem answered (gaps, conflicts, guess steps, unsourced facts, oversize stages): proven. Evidence: B1 and notes 1–11 above, each with its label. The stage sizes are taken from the `plan.md` § Planning progress counts.
- First line `FAIL <sha>` and HEAD matches the candidate: proven. Evidence: `git rev-parse HEAD && git status --short` printed b33b67d68ac2d73a976ac2f82a904f6530a3f784 and a clean tree.
- Easy-to-miss rule ("Missing code detail … is not a finding"): followed. Evidence: no finding asks only for line numbers, edit text or file lists. I left out a missing `slo-host-checks.test.ts` import and the unlisted legal `.astro` props on purpose.
- Project reminder (merge master and run the checks before the final message): not binding for this job. It applies only to jobs that commit product code, and this review committed nothing.
