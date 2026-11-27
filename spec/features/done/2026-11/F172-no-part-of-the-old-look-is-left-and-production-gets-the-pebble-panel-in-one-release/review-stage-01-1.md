PASS d6c95930c37fa8194e3744c75c7b1ba08a46ab1e

I reviewed the F172 stage 01 candidate: the leftover guards, the Placeholder removal and the Telegram button text. `git rev-parse HEAD` = d6c95930c37fa8194e3744c75c7b1ba08a46ab1e, which matches the candidate. The merge-base with master is 4afd600f8, so the candidate is three commits: ec547cc36, 93e2212c1 and d6c95930c. Commit 4afd600f8 holds the check-job.sh grep fix and the Polish FAQ edit. It is already on master and is outside this diff.

Blocking findings: none.
Unverified checks: none on the acceptance bullets. The worker's own break checks (each guard made to fail once) are not in the saved logs. My probes below cover all three.

## Acceptance, checked

- **Emoji guard can fail.** Proven by reading and a probe (`/tmp/f172-rev-probe/emoji.log`).
  - `apps/web/src/i18n/emoji.test.ts` reads `en`, `pl`, `enPlurals` and `plPlurals` directly.
  - The probe counted 1492 keys per locale and 12 plural keys per locale, all string forms.
  - Every file in `i18n/texts/` (21 files, tests excluded) is spread into `en.ts` and `pl.ts`, so no text file escapes the scan.
  - The pattern `\p{Extended_Pictographic}|️` matches `✅` and `✏️`.
  - The fixture tests cover stage test cases 1–4. The `test.each` covers case 5.
  - An empty scan is not a real risk: the dictionaries are static imports.
- **Unused-file guard can fail.** Proven by a probe (`/tmp/f172-rev-probe/files.log`), a copy of `unusedFiles` run on the real tree.
  - It scanned 579 sources and 257 candidates and found 0 unused files.
  - With `src/components/shell/Placeholder.tsx` added back, it reports exactly that file.
  - The test asserts `sources.size > 300`, so an empty glob fails.
  - It covers `@/` (the alias in tsconfig `@/*` → `./src/*`), imports with and without an extension, `/index`, and importers in `dev/` (D9).
- **Unused-token guard can fail.** Proven by a probe (`/tmp/f172-rev-probe/tokens.log`).
  - Its `DECLARATION` regex parses all 94 tokens of `global.css`; a naive `--x:` scan also finds 94, so nothing is missed.
  - Real sources: 0 unused. Empty sources: 81 unused.
  - Adding `--color-unused-x: red;` gives exactly `["--color-unused-x"]`.
  - The test asserts `sources.length > 100_000`.
- **`--font-sans` and companion tokens count as used.** Proven by reading `apps/web/src/lib/unused-tokens.test.ts`.
  - `ALWAYS_USED` holds `--font-sans` and `--font-mono`.
  - A companion (`--x--mod`) is left out of the seed queue and is marked used only when its base token is used.
  - Tests "the font tokens of the base styles…" and "a companion token follows its token" cover both directions.
  - Tokens are found through the queue, with declarations cut out of the readers. So a token that only an unused token reads stays unused (fixture test 1).
- **Polish text has no reader gender.** Proven by reading `apps/web/src/i18n/texts/pl-settings.ts` `cat_help`.
  - "Oceniaj wiadomości przyciskiem z ptaszkiem lub ołówkiem w Telegramie…" uses the imperative, which has no gender, and matches the stage text word for word.
  - The unchanged "asystent sam" refers to the assistant, not the reader.
  - The English text matches the stage. `apps/docs/.../reference/settings.mdx` changed in the same commit. No Polish reference page exists, and no Polish docs page holds the old ✅/✏️ text.
- **Nothing deleted is still referenced.** Proven: `rg` for `shell/Placeholder|\bPlaceholder\b|placeholder_text` over apps, packages, docs, tools and scripts exited 1 (no match). Its output file `/tmp/f172-rev-probe/rg.log` is 0 bytes.
  - The only deleted file is `Placeholder.tsx`. Its key `placeholder_text` left both en-auth and pl-auth.
- **Step 3 "Do".** No token was unused, so `global.css` and the ADR token table rightly have no change.

## Notes (not blocking)

1. **The guard comments claim ADR text that does not exist.** Proven by grep. The comment in `unused-files.test.ts` says "`docs/decisions/0037-panel-design-system.md` holds the rule". The ADR has no unused-file rule and no unused-token rule; it has only decision 11 (unused text keys) and decision 9 (emoji). Stage 02 also has no step that writes those two rules into the ADR. Either a later stage adds them to the ADR, or the comments point to the test as the rule.
2. **The token guard does not assert a token count.** Plausible hardening, today harmless. The real-tree test checks the size of the source text but not of the token map. If `global.css` were rewritten with the last declaration of each block lacking a `;`, those tokens would be dropped and the test would still pass. An `expect(values.size).toBeGreaterThan(80)`-style check, or an exported count, would close this.
3. **Playwright spec files count as importers.** Plausible. `isTest` drops only `*.test.ts(x)`, so `e2e/tests/*.spec.ts` count as importers. `src/lib/legal-checks.ts` stays "used" only through `e2e/tests/legal.spec.ts` (`files.log`). D9 names "e2e helpers", not specs. This is a policy edge, not a break.
4. **Only direct importers count, not chains.** Proven by reading. A file whose only importer is itself unused is not reported until that importer is deleted. This matches the stage text ("no other file … imports").
5. **The new guard repeats two older emoji tests.** Plausible near copy under § Tests. `review-view.test.tsx` "no emoji in a review text of en/pl" is now a subset of the dictionary guard, so a later cleanup can drop it.
6. **The emoji pattern is broad.** `\p{Extended_Pictographic}` also matches `©` and `™`. No panel text holds them today. A future legal text with © would fail loudly, not pass silently.

## Checks run

- Read the candidate diff and the three new test files.
- Read the stage file, the plan and the two review files: `plan-review-1.md` (the first plan review) and `review-fixes-1.md` (its fixes). Read the ADR 0037 grep hits.
- Saved worker logs in `/tmp/f172-01/`:
  - `check.log`: last line `check:job PASS master=4afd600f84 tip=d6c95930c3 full=0`, 0 `(fail)` lines. All three guards ran and passed, including their real-tree tests.
  - `build.log`: exit 0.
  - `e2e.log`: 16 passed.
  - `docs.log`: 166 passed.
  - `docs-build.log`: exit 0.
  - The tip and master in these logs match the candidate and its merge-base.
- Probes with plain `bun` scripts in `/tmp/f172-rev-probe/` (copies of the guard functions, run on the real tree). The call `bun probe.ts > tokens.log && bun files.ts > files.log && bun emoji.ts > emoji.log && cat …` exited 0.
- The `rg` described above: exit 1 (no match), output in `rg.log`.
- No test suite, lint, typecheck or `check:job` ran in this review.

## Note check

- Each guard fails on a real violation and cannot pass on an empty scan: proven. Evidence: `/tmp/f172-rev-probe/tokens.log`, `/tmp/f172-rev-probe/files.log`, `/tmp/f172-rev-probe/emoji.log`, plus a reading of the size asserts in `apps/web/src/lib/unused-files.test.ts` and `apps/web/src/lib/unused-tokens.test.ts`.
- The unused-token rule treats `--font-sans` and its companion tokens as used: proven. Evidence: `apps/web/src/lib/unused-tokens.test.ts` (`ALWAYS_USED`, the companion loop, tests 4 and 5) and `/tmp/f172-rev-probe/tokens.log` (94/94 parsed).
- The Polish Telegram button text has no reader gender: proven. Evidence: `apps/web/src/i18n/texts/pl-settings.ts` `cat_help` (imperative "Oceniaj").
- Nothing deleted is still imported or referenced: proven. Evidence: `/tmp/f172-rev-probe/rg.log` (0 bytes; rg exit 1, no match).
- Easy-to-miss rule "Run no test suite": followed. This session ran only reads, git, rg, and plain `bun <probe>.ts` scripts in `/tmp/f172-rev-probe/`. No `bun test`, `test:*`, lint, typecheck or `check:job` ran.

Project reminders:
- Tests run once per job; no `test:unit`, `test:int` or `test:e2e`: followed. None ran.
- A product-code job ends with `check:job`: not applicable. This review committed nothing.
- A review job runs no test suite, lint or typecheck: followed. I relied on the worker's `check.log`.
- Never delete `node_modules/.cache/`: followed. It was not touched.
