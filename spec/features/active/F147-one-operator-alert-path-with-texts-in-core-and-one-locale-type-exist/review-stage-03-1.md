FAIL 9932537e8a592efc8155a9d8dfaa06fe139a75d3

I reviewed commit 9932537e8a592efc8155a9d8dfaa06fe139a75d3. `git rev-parse HEAD` matches the candidate. The stage commits are 1d962529 (the move) and ee696b85 (the code-patterns path). The merge base with master is ece30ece.

## Blocking

**B1. A bare ticket code in a new comment fails the repository guard test. Proven by test.**
- Location: `apps/server/src/modules/operator/notices.ts:22`. The comment is `// The module field stays `channels` until the log names of the operator path change (F147 stage 04).`
- `bun test apps/server/src/comment-codes.test.ts` fails with 1 pass, 1 fail. The case "no source file under apps, packages, scripts or tools holds one" reports exactly this line.
- The guard test was already on the base of the stage commit. So the stage proof (`plan.md` § Proof, `test:unit:ci`) and the bare-code scan of `check:job` fail at this commit. Master CI would go red after the land.
- The pre-commit hook did not catch it because `comment-codes.test.ts` does not import `notices.ts`.
- This breaks the stage "Done when" item "Proof: plan.md § Proof with NN=03" and the key risk "no bare codes in new strings/docs".
- Fix: replace `(F147 stage 04)` with the ticket folder path, for example `spec/features/active/F147-one-operator-alert-path-with-texts-in-core-and-one-locale-type-exist/stages/stage-04-one-delivery.md`, or with plain words. The words "stage 04" also match the guard pattern.

## Unverified

- Stage test case 5, the mutation of the `llm_cap` key in `operatorEventKey`: I did not run it. It needs the integration DB, and this is a review job.
- Integration tests in `operator-notices.test.ts`: I did not run them. I read the diff only.
- I ran no lint, typecheck or full suite, as the task said.

## Key risks checked (proven by reading the diff against ece30ece)

- **Dedup order is kept.** The diff does not touch the body of `notify`. The order is still in-memory `doneKeys`/`inFlight`, then `hasAuditKey`, then send, then `recordAudit` with `{ kind, key }` in `ctx`. Send comes first and the row second.
- **The event, key and text are built inside the synchronous `try` of each hook.** This holds for `capReached`, `authMailFailed`, `sendLimitReached` (through `startSendLimit`), and the loops of `runOrganizations` and `runAuthErrors`. An invalid date still logs `operator_notice_failed`.
- **Old key literals are equal.** `packages/core/src/ops/events.ts` `operatorEventKey` gives the same template for each of the five kinds as the old inline code. `trial_ending` uses ms, `auth_error_24h` uses ms, `llm_cap` uses `dayStart.toISOString()`, and `auth_mail_failed` and `send_limit` use the UTC day.
- **Texts are equal.** `renderOperatorEvent` (`packages/core/src/ops/alert-text.ts`) calls the same `textsFor(locale).operator` functions with the same arguments. For trial ending, `ended = now >= endsAt` is the inverse of the old `now < endsAt` test, so the result is the same.
- **No channels import is left.** `rg createOperatorNotices` finds only `start/operator.ts` and the test, and both import from `modules/operator`. `channels/index.ts` drops the old names and exports `telegramErrorFields`.
- **The module graph needs no change.** `operator --> channels|actions|audit|mail|tenancy` already exist in `docs/diagrams/module-graph.md`. `channels` still imports `actions`, `mail`, `tenancy` and `audit` from other files.
- **Tests.** `operator-notices.test.ts` is a rename. Only the import, `locale: "en"` and two new cases change. The new cases use literal keys. The value `1794996000000` equals `2026-11-18T10:00:00Z`. Every old expected string and key is unchanged.

## Notes

- **N1 (proven by grep): a stale test path in the docs.** `docs/capabilities/digest-and-notices.md:182` still lists `apps/server/test/integration/channels-operator.test.ts`, and that file no longer exists. Point it to `operator-notices.test.ts`. The fix can ride with B1.
- **N2 (proven by reading): one small order change for `llm_cap` and `send_limit`.** Before, the code checked `retries.has(key)` before it rendered the text. Now it renders the text first. The only effect: when a retry is already queued, an invalid `until`/`dayStart` now logs `operator_notice_failed`, where the old code returned silently. With valid input there is no difference. This is not blocking.
- **N3: stale counts in `docs/modules.md`.** The channels bullet still lists four event names, and the rule 11 header in `digest-and-notices.md` keeps "(S6a)". Both are old text that the diff did not add.
- **N4: old paths in history documents.** ADRs 0024 and 0027 and the E07/E08 epic notes still name `modules/channels/operator.ts`. They are history and need no change.

## Checks run

- `git rev-parse HEAD && git cat-file -e HEAD:apps/server/src/modules/operator/notices.ts && git diff -M --stat ece30ece HEAD` exited 0. HEAD is 9932537e, `notices.ts` exists, and `channels/operator.ts` is shown as renamed to `operator/notices.ts`.
- `bun install --frozen-lockfile` installed 991 packages.
- `bun test apps/server/src/comment-codes.test.ts` gave 1 pass and 1 fail. The failure is `notices.ts:22`, as described in B1.
- Reading only: `git diff -M ece30ece HEAD`, `rg` for importers and stale paths, and the module graph lines.

## Note check

- **HEAD, file moved, no channels import:** proven. Evidence: `git rev-parse HEAD && git cat-file -e HEAD:apps/server/src/modules/operator/notices.ts && git diff -M --stat ece30ece HEAD`. The importer search was a read of `apps/server/src/start/operator.ts`.
- **Behaviour kept (dedup order, key and text in the sync try, old key literals):** proven by reading. Evidence: `apps/server/src/modules/operator/notices.ts` and `packages/core/src/ops/events.ts`, compared with the ece30ece diff.
- **Moved tests and the two new old-row cases:** proven by reading only. Evidence: `apps/server/test/integration/operator-notices.test.ts`. I did not run the cases. Stage test case 5 (the mutation) is not proven, because it was not run.
- **No bare codes in new comments, strings or docs:** broken. `bun test apps/server/src/comment-codes.test.ts` failed on `notices.ts:22`. This is blocking B1.
- **Easy-to-miss rule "Run no suite.":** followed. I ran only the one test file `comment-codes.test.ts`, to prove a specific doubt. I ran no `test:unit`, `test:int`, `test:e2e`, lint or typecheck.
- **Reminder "tests run once, no suite runs":** followed. The only run was one `bun test <file>`.
- **Reminder "`check:job` for a product-code job":** not applicable. This is a review job and I made no commits.
- **Reminder "a review runs no suite, lint or typecheck":** followed.
- **Reminder "never delete `node_modules/.cache/`":** followed. I deleted nothing.
