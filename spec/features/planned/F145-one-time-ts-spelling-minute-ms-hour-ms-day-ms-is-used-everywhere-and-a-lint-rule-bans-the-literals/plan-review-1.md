# F145 plan review 1

Job `2026-11-20-f145-plan-review-148a8aff`, model `claude-sonnet-5-5`, thinking high, candidate `b37af335`. Final verdict message, filed whole:

PASS b37af3354f167d105f060a5eab7a96b07437f62f

HEAD matches the candidate. I found no proven break of a ticket acceptance bullet. I found two rule-design holes and one weak value check, and I recommend fixing all three before the build.

## Blocking findings

None.

## Checks I ran

- `git rev-parse HEAD` printed `b37af335…`, the candidate.
- `bun install --frozen-lockfile` succeeded (991 packages).
- `bunx eslint --print-config apps/docs/src/autonomy-evidence.ts` showed that docs `.ts` files are already linted with the TS and prettier rules. A new rule block therefore does not start linting new files. I raised this as a risk and ruled it out.
- `bunx eslint .` at HEAD exits 0 with 11 existing warnings (`no-console` and similar). Stage 01's "only `ea/no-time-literals` warnings as new output" is a fair wording.
- `node -e` arithmetic on the D2(b) criterion (details in note 1).
- `rg` sweeps of the code at HEAD, listed under the notes they support.
- I did not run the planned tests or the rule. Neither exists yet. `bun run test:unit:ci` and `bun run test:int:ci` were not run. They are decorative for a plan review.

## Notes

1. **[proven] D2(b) misses fractional chains that contain a time literal.**
   - Stage 01 `stages/stage-01-minute-and-rule.md:17` says "A literal inside a `*` chain never reports on its own". D2 (`plan.md:14`) reports a chain only when the literal factors multiply to a multiple of 60 000.
   - `1.5 * 60_000` gives 90 000. `1.5 * 60 * 1000` gives remainder 30 000. `0.5 * 60_000` gives remainder 30 000. I confirmed all three with node. None of them reports.
   - This contradicts the ticket outcome (`ticket.md:9`): the rule fails when new code writes `60_000`.
   - Float modulo can also hide a hit. `0.1 * 3 * 60 * 1000 % 60000` gave 18000.000000000004.
   - Fix: report any chain that holds a literal equal to one of the three values. Also report chains whose factors include both 60 and 1000. Add T-cases for `1.5 * 60_000` and `1.5 * 60 * 1000`. Do not rely on floating-point `%`.
   - No such expression exists at HEAD (`rg` found none). The hole is a future bypass.

2. **[plausible] The value-equality proof for stages 02–04 is weak. This is where a changed time window would get through.**
   - `plan.md:62` leaves the check to a Haiku reviewer who "evaluates each `old → new` pair". The worker writes that table itself.
   - `plan.md:53` runs lint, typecheck and unit and integration tests. Most tests import the constant by name, so a wrong multiplier in the rewrite passes them.
   - The seed scripts `apps/server/src/scripts/e2e-*-rows.ts` are covered only by this review. The proof never runs e2e. `stage-04:18` says "the e2e suites see the same rows", with no run behind it.
   - Stage 05 may rewrite late literals (`stage-05:10`) and has no review (`plan.md:63`).
   - Fix: add a deterministic check to the Proof. Options:
     - A script that evaluates the old and new text of each changed line with `MINUTE_MS`, `HOUR_MS` and `DAY_MS` bound, and fails on a difference.
     - Or a before-and-after dump of every numeric export, compared at base and at HEAD.
   - Apply it to stage 05 as well.

3. **[plausible] The rule never flags `60 * MINUTE_MS` or `24 * 60 * MINUTE_MS`.**
   - The literal factors there are 60 and 1440, which are not multiples of 60 000.
   - Stage 04 (`stage-04:18`) tells the worker only to "rename uses". Real lines exist: `e2e-approvals-rows.ts:119` has `2 * 24 * 60 * MINUTE`, and `e2e-delegations-rows.ts:12` has `24 * 60 * MINUTE`.
   - The worker must guess between `2 * 24 * 60 * MINUTE_MS` and `2 * DAY_MS`. The first form passes lint and keeps a hand-built day.
   - Fix: add a D6 line, "fold to the largest unit". Decide whether the rule also flags a literal factor next to a unit name.

4. **[plausible] Several D3 and D2 branches have no test.**
   - D3 ignores `*.spec.ts`, `*.test-helper.ts` and `**/e2e/**` (`plan.md:15`). T13 covers only `time.ts`, `x.test.ts` and `test/integration`.
   - T14 covers no `.tsx`, `.mjs` or `tools/fake-telegram/src` path.
   - No T-case covers parenthesized or right-nested chains (`60 * (60 * 1000)`), `1000 * 60 * 60` order, `-60_000`, `6e4` (D2 says "any separator form") or `export const DAY_MS`.
   - Add a negative case from real code: `expiresIn: 60 * 60 * 24 * 30` in `apps/server/src/platform/auth.ts:367`. That is seconds and must stay `[]`. `apps/docs/src/reference.test.ts:205` reads that exact text by regex.
   - Without these cases, removing an ignore or the chain flattening leaves the new test green.

5. **[plausible] D2 leaves minutes written through division unaddressed.**
   - `ms / 1000 / 60` and `/ 60 / 60` are minutes written with literals. D5 covers seconds only, and no decision mentions division chains.
   - None exist at HEAD (`rg` found none).
   - Say in D2 or D5 that they are out of scope, or add a selector.

6. **[plausible] Two bypasses the plan does not mention:**
   - D2(c) matches only `VariableDeclarator` identifiers. A class field or an object property such as `{ DAY_MS: 86400000 }` is not matched, though the literal itself still reports.
   - Chain factors wrapped in TS nodes (`(60 as number) * 1000`) are not "numeric-literal factors". Stage 01 does not say how to treat them.

7. **[plausible] The `ea` plugin has no agreed home.**
   - Stage 01 creates `tools/eslint-rules/no-time-literals.js` and registers the plugin as `ea` (`stage-01:15`).
   - F143 (a line-length rule) and F150 (the bare-code lint rule) also edit `eslint.config.js`. The ticket calls the overlap "advisory" (`ticket.md:39`).
   - Their tickets are empty templates (scout 3). If any of them registers its own `ea` plugin object, flat config throws "Cannot redefine plugin".
   - Fix: have stage 01 write `tools/eslint-rules/index.js` as the single plugin object, and state in D1 that later rules join it.
   - `tools/` is described as test tools in `.agents/limen/styleguide.md`, so also decide whether the rule folder belongs there.

8. **[plausible] Acceptance bullet 3 has no check.**
   - Bullet 3 (`ticket.md:29`): `time.ts` is the only non-test file that defines the three names. Stage 05 "Done when" does not test it.
   - Rule D2(c) covers only the D3 scope. Test-support files under `apps/server/test/` define `DAY_MS` and `HOUR`, for example `loops-chaser-fixtures.ts:15` and `mail-provider.ts:24`.
   - The ticket's meaning of "non-test" excludes them, so the bullet holds. A reviewer who runs a bare `rg 'const DAY_MS'` will see the opposite. Name the scope in the bullet.

9. **[unverified] The ESM rule file loading under `bun run lint`.**
   - The plan flags this itself (`plan.md:35`). Root `package.json` has `"type": "module"`, which favours it.
   - Stage 01 T1 proves it.

10. **[unverified] Non-time `60_000` or multiples that the rule will flag.**
    - Examples are `rpm: 60_000` and `socketTimeout`. D8 handles them with a disable comment.
    - Worker judgment decides each case, and the plan has no list. The Haiku review (`plan.md:62`) checks only "no D8 disable on a real time".

11. **[plausible] Scope and fact drift (minor).**
    - `tools/mail-oauth-spike/` holds 4 time literals (`probe.ts:171`, `rows-google.ts:187`, `rows-microsoft.ts:263` and `:283`), all `60_000`.
    - D10 and Q4 leave them out. The ticket outcome says "every minute… in the product code", so the exclusion is a documented default.
    - "156 lines in 98 files" (`ticket.md:15`, `plan.md:31`) has no reproducible regex. My literal-only `rg` gave 134 lines. The stage areas sum to about 153 by my own counts (A 62, B 30). Treat the figure as a floor, as the plan says.

12. **[ruled out, no action] The other risks I checked:**
    - D1's reason holds: `eslint.config.js:208-209` and `:259` have one `no-restricted-syntax` block.
    - The test pattern in D3 and stage 01 matches `log-lint.test.ts:6-25`.
    - D11 matches `reference.test.ts:185` and `:327`. `triage/service.ts:128` reads `const MAX_AGE_MS = 7 * 24 * 3_600_000;`.
    - Adding `MINUTE_MS` to the `@ea/core` barrel causes no `export *` clash. The six local copies at HEAD are not exported.
    - `lint-staged` runs `eslint --fix`, and CI runs plain `bun run lint`. The rule at `warn` between stages 01 and 05 blocks no commit (`package.json:134-138`, `ci.yml:53`).
    - The stage sizes fit one job each. Stage 01 is 651 words, within the limit. The stage area counts match my `rg` counts.

Cold review job, review model `claude-sonnet-5-5`.

## Note check (job result)

PASS b37af3354f167d105f060a5eab7a96b07437f62f

The verdict and the findings are in my previous message. This message adds only the note check.

## Note check

- HEAD is the candidate `b37af3354f167d105f060a5eab7a96b07437f62f`: proven. `cd /home/artek/Documents/repos/.email_assistant-limen-worktrees/2026-11-20-f145-plan-review-148a8aff && git rev-parse HEAD` exited 0 and printed that sha.
- Lint-rule design (D1, D2, D9) checked against `eslint.config.js` and `apps/server/src/platform/log-lint.test.ts`: proven. I read both files at HEAD. The evidence is the files themselves, `eslint.config.js` and `apps/server/src/platform/log-lint.test.ts`, plus findings 1, 3, 4, 6 and 7 in my previous message. My earlier probes (`--print-config`, node arithmetic) ran in calls joined with `;`. They are not cited as proof.
- Every finding quotes file and line and carries a label (proven, plausible or unverified), and the first line is `PASS <sha>`: not proven. The text went to the coordinator in chat. No saved file or qualifying command shows it.

Easy-to-miss rule ("Missing code detail … is not a finding; a missing decision, edge case, test or interface is"): not proven. By my own reading, every finding names a decision, edge case, test or interface. The evidence is only the message text, with no file or command.

Not proven yet: the final message is delivered; the easy-to-miss rule is followed.

Binding project reminder (the merge-and-check step for jobs that commit product code): not applicable. This is a review job and it committed no product code. I wrote only `.limen/jobs/2026-11-20-f145-plan-review-148a8aff/note.md`. I ran no merge, typecheck or unit test, and the reminder does not require them.

Not run: `bun run test:unit:ci` and `bun run test:int:ci`, because the planned rule and its tests do not exist yet. In my previous message, check 3 (the `bunx eslint --print-config` probe and the node arithmetic) was a `;`-joined call, so it does not count as proof here.
