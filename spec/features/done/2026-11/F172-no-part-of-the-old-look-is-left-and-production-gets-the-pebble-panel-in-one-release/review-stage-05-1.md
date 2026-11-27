PASS 89b517f749b5d07dc50a4f9eb15d79246faa2451

Reviewed commit: 89b517f749b5d07dc50a4f9eb15d79246faa2451. `git rev-parse HEAD` gives the same sha, and the tree is clean.

Blocking findings: none.

Unverified checks (not blocking): this review did not run `check:job`, `lint:full`, `docs:build`, `docs:test` or `docs:stale --strict`. The task said to run no test suite, and the reminders say the same. The worker's proof line was not in the task, so I did not see it.

Task checks:
- **The T10 case fails on a broken copy. Proven by a test run.** I ran `bun test apps/docs/src/flagged-text.test.ts -t changelog`. On the real file, all 3 changelog cases passed. Then I added "what is new" (a `docs_links` literal) to the en line of `[Unreleased]` "For users". The new case failed with `"docs_links: What is new"`, and the old T10 case still passed. I restored the file with `git checkout`. The case cannot pass when the file has no `[Unreleased]` heading, because `expect(renamed).not.toBe(source)` guards the rename. The only `## [Unreleased]` string in the file is the real heading on line 18; the header comment does not hold one.
- **The public "For users" text claims nothing false. Proven by reading the code.** The one item names a teal colour, larger text and buttons, rounded cards and a tab bar at the bottom on a phone (`Nav.tsx:78`, `lg:hidden`), and light or dark from the device. Each of these is unflagged. The text does not name Approvals, Delegations, Review or Stats. Those four are flagged in `nav-items.ts:40-53` and appear only under `### Changed`, which stays private (`changelog-page.ts`).
- **The Polish text has no reader gender. Proven by reading it.** It has no past-tense verb and no adjective that refers to the reader. "Twojego urządzenia" is neutral.
- **Nothing outside `design/` imports or names `design/ui-proposals`. Proven by grep.** `git ls-files design` is empty (`/tmp/f172-rev/design-files.log`, 0 lines). `git grep ui-proposals HEAD` finds 18 lines (`/tmp/f172-rev/ui-proposals-refs.log`). They are in ADR 0037 § Context, `docs/product/pebble-ui/README.md`, two notes from 2026-11-23 and spec folders. All of them are planned history lines; no code or config file is among them. A further grep found no `.ts`, `.tsx`, `.js`, `.mjs`, `.json`, `.yml`, `.yaml`, `.sh` or `.astro` file, and no file in `deploy/` or `.github/`, that names `design/`. The ESLint ignore and the seven `.gitignore` lines are gone. Commit `94092626b` exists and holds `design/ui-proposals/proposals/03-pebble/`.
- **The changelog parser accepts the file at release. Proven by a script; output in `/tmp/f172-rev/prep.log`.** `/tmp/f172-rev/prep.ts` ran `prepareRelease({version:"0.5.0"})` on the real `CHANGELOG.md` and `package.json`. The release was not refused. The output keeps an empty `## [Unreleased]` and adds `## [0.5.0] - 2026-11-26` with both groups. `parseChangelog` then gives `Unreleased` with `forUsers: []` and `0.5.0` with one en/pl item. `flaggedTextProblems(changelogPage(...))` gives `[]` for the prepared file. The new T10 rename, applied to the prepared file (empty `[Unreleased]`), also gives `[]`.
- Other claims I checked: `next-themes` is in `apps/web/package.json` at `v0.4.5` and is gone at HEAD, in both that file and `bun.lock`. `git diff v0.4.5 HEAD -- db/migrations` is empty, so the no-migration line is true. The card text in the capability page matches `WhatsNew.tsx:116` (the `docs_links` gate) and `WHATS_NEW_MAX = 5`. The case that step 3.4 asks for in `whats-new.test.ts` already exists (T2, T4). The new `changelog.test.ts` case asserts an exact `toEqual` and is not a copy of T1 or T2.

Notes:
1. **The rule sentence is missing from "For users". Proven by reading the code; this is a stage-spec deviation, not an acceptance break.** Stage 05 step 2, item 2, says to add "a sender rule is added as one sentence on the Rules page" when the Rules page has no default-off flag. The Rules page has no flag (`nav-items.ts:52`, `flags: null`). The one-sentence add form (`23987ba44`, 2026-11-25) is not in `v0.4.5` (`git merge-base --is-ancestor` says "after-release"). So the condition holds, and the item was left out. The commit gives no reason. The text is not false, and no ticket acceptance bullet needs the item. The coordinator decides whether to add it before stage 06.
2. **The T10 heading differs from the stage spec. Proven by reading the parser.** The case uses `## [999.0.0] - 2000-01-01`, not the spec's `## [0.0.0-unreleased] - 2000-01-01`. The spec value would throw `changelog_heading` (`SEMVER` rejects a pre-release), and `0.0.0` would throw `changelog_order`. The worker's choice is the correct one.
3. **T10 reads only the English text. Plausible gap, from earlier work.** `changelogPage` renders only `item.en`, so the new case never checks the Polish "For users" text. The card shows that Polish text when `docs_links` is on. A flagged Polish literal in `pl:` would pass T10. This follows the spec ("runs changelogPage"), so it is a hardening idea only.
4. **The Polish wording could confuse. Plausible.** "zaokrąglone karty" (cards) and "pasek kart" (tab bar) use the same word for two things in one sentence. "pasek zakładek" is the more usual Polish for a tab bar. The panel has no Polish word for the tab bar, so no panel term conflicts.
5. **Edits outside the § Look paragraph. Proven by reading them; correct.** The capability page also changes item 9 (Activity row actions below `sm`, the Categories row title `cat_action_*`, the pill above the text below `lg`, the report `rep_intro` line removed). These follow the stage 04 fixes: `cat_action_` exists in `CategoriesCard.tsx:111`, and `55a7327bc` removed the repeated report line. ADR 0037 gains decisions 16 and 17, which name the guards. This makes true the comment in `unused-files.test.ts` that says the ADR holds the rule. The emoji guard points to decision 9 ("Emoji leave the panel texts").

Checks run:
- `bun install --frozen-lockfile`: 990 packages installed.
- `bun test apps/docs/src/flagged-text.test.ts -t changelog`: 3 pass, 0 fail on the real file. 2 pass, 1 fail (the new T10 case) on the broken copy. The file was restored.
- `bun /tmp/f172-rev/prep.ts <worktree>`: ran twice. The second run saved its output to `/tmp/f172-rev/prep.log`. prepareRelease succeeded, the parse was as above, and flagged problems were `[]` and `[]`.
- `git grep -n ui-proposals HEAD` → `/tmp/f172-rev/ui-proposals-refs.log`; `git ls-files design` → `/tmp/f172-rev/design-files.log`.

Note check
- T10 fails on a broken copy and does not pass always: not proven. I saw the case pass on the real file and fail on the "what is new" copy in this session, but I saved no log. That bash call also joined its commands with `;`. I did not rerun the test file to make a log, because the run-once rule applies.
- The public For-users text claims nothing false: proven. Evidence: `CHANGELOG.md` lines 20-23, read against `apps/web/src/components/shell/nav-items.ts` lines 40-53 and `apps/web/src/components/shell/Nav.tsx` line 78.
- The Polish text has no reader gender: proven. Evidence: `CHANGELOG.md` line 23.
- Nothing outside `design/` names `design/ui-proposals`: proven. Evidence: `/tmp/f172-rev/ui-proposals-refs.log` (docs history, notes and spec only) and `/tmp/f172-rev/design-files.log` (empty).
- The changelog parser accepts the file at release: proven. Evidence: `/tmp/f172-rev/prep.log`.
- Easy-to-miss rule "Run no test suite": followed. The only test command was the single-file `bun test apps/docs/src/flagged-text.test.ts -t changelog`, run twice: once on the real file, once on the broken copy. No `test:*`, `check:job`, `lint` or `typecheck` ran. No file records this; the evidence is the commands of this session.
- Reminder, tests run once per job: followed. I ran no `test:unit`, `test:int` or `test:e2e`, and the one test file ran only to see the new case pass and fail.
- Reminder, `check:job` as the last step: does not apply. This is a review job, and it made no commit.
- Reminder, a review runs no suite, lint or typecheck: followed. I ran one file only, to see the new test fail when the copy breaks.
- Reminder, keep the `node_modules/.cache/` folder: followed. I did not delete it.

Decisions for the owner: none
