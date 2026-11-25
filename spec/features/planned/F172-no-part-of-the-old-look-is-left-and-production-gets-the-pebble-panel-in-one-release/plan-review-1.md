FAIL 867ab63b16bde37a1cfbade8c8858fb63cdac469

Cold review of the F172 plan: the leftover sweep, the visual review, the mockup removal and the v0.5.0 release. `git rev-parse HEAD` = 867ab63b1, which matches the candidate. The plan base is ee4b61369. The only commit after it is the plan commit, so all code facts below are at the base.

Pre-mortem answer. Four stages could let a defect reach users or production:
- **Stage 05** can ship without the owner's "go" after the standing rule has expired.
- **Stage 01** can delete the Nunito font token.
- **Stage 04** proves the public release text with a test that cannot fail.
- **The ticket** promises a "what is new" card that the plan does not turn on.

## Blocking

**B1. The release gate checks that the standing rule is present. It must check that the rule is still valid (proven by reading).**
- `stages/stage-05-release.md:9` (P1, `plan.md:15`, `questions.md:5`) skips the owner "go" while `spec/build.md` "still holds the rule".
- `spec/build.md:44` says the rule is "valid for 24 hours only, until 2026-11-25 evening, then ask again". The line can stay on the board after it expires.
- `spec/build.md:43` and `docs/product/pebble-ui/README.md:35` (PB-12) still say that the release waits for "go" and for the 20-draft check.
- Stage 05 runs after F169, F171 and stages 01–04, one of which has a 150-minute timeout. So it runs after the rule expired.
- The ticket also conflicts with itself: acceptance `ticket.md:26` says "The owner said 'go'", but `ticket.md:32` and `:37` say the "go" is taken as given.
- Fix: the P1 check must compare the rule's expiry date with the date of the run. After expiry it asks the owner for "go". Make `ticket.md:26` agree with P1.

**B2. The unused-token rule of stage 01 classifies the font token as unused, and the stage says to delete it (proven with grep).**
- `stages/stage-01-leftover-guards.md:35` says that `--font-*` is used only when a `font-<n>` class appears, and `:36` says to delete each unused token.
- `apps/web/src/styles/global.css:117` defines `--font-sans` (Nunito, ADR 0037 decision 3). No source file holds `font-sans` or `var(--font-sans)`. Tailwind's own base styles read the token.
- So test 4 ("the real files give an empty list") passes only after Nunito leaves the panel.
- `--text-xs--line-height` (`global.css:121`) has the same problem: no class `text-xs--line-height` exists.
- Fix: define these tokens as used (a `--font-*` or `--text-*` token that Tailwind's base styles read, and `--<token>--<modifier>` companions). Add a test case for each.

**B3. Acceptance 4 conflicts with P3 (proven by reading; the production flag state is unverified).**
- `ticket.md:27` says "the panel shows the 'what is new' card once per user", and `ticket.md:9` promises users the card.
- P3 (`plan.md:17`) keeps the card behind `docs_links`, which is off by default. Stage 05 only records the flag state (`stage-05-release.md:46`: "where it is off, write that the card waits for the flag").
- No note records `docs_links` as on in production. The v0.4.5 release record says "No flag changes" (`notes/2026-11-15-vps-deploy-queue.md:231`). So the acceptance is probably unreachable.
- The card stores the seen version in `localStorage` (`apps/web/src/lib/whats-new.ts:45-48`). So it shows once per member and browser, not "once per user".
- Fix: change the acceptance to what P3 delivers, or change P3.

**B4. The T10 check in stages 04 and 05 cannot fail, so it does not prove P6 (proven by reading).**
- `apps/docs/src/changelog-page.ts:10` skips `Unreleased`. T10 (`apps/docs/src/flagged-text.test.ts:174-189`) scans only `changelogPage(...)` and the built page.
- Stage 04 writes the text under `[Unreleased]` (`stage-04-mockup-out.md:16`). So step 2.2 "only if T10 passes with it", test 1 "T10 passes" and the Proof `bun test …flagged-text.test.ts` all pass whatever the text says.
- Stage 05 step 1.5 (`stage-05-release.md:13`) also runs T10 before `release:prepare`.
- This is the failure that made the first v0.4.5 release commit red (`notes/2026-11-15-vps-deploy-queue.md:234`), and P6 itself cites it.
- Fix:
  - Stage 04: add a T10 case that scans the `forUsers` items of `[Unreleased]`, for example `changelogPage` on a copy where `[Unreleased]` is renamed to a version.
  - Stage 05: run T10 after `release:prepare` and before `git commit`.

## Gaps (an event no rule covers, or a step a Sonnet worker must guess)

- **G1. The "bare `shadow`" rule cannot give an empty list on the real source (proven with grep).** `stage-02-stock-sweep.md:10` and test 4 (`:21`). `token-classes.test.ts` scans whole file text, not class strings.
  - Hits for the bare word: the mode value `shadow` (`MailboxCard.tsx:28`, `ModeCard.tsx:30,81,84`) and comments (`SectionCard.tsx:16`, `StickyActions.tsx:3`, `sonner.tsx:5`).
  - `transition-[color,box-shadow]` (`badge.tsx:7`, `input.tsx:10`, `select.tsx:31`, `textarea.tsx:9`) matches a naive `\bshadow\b`.
  - Decide what the rule matches (class context only, or not after `-`), and add test cases for `shadow: "…"`, `"shadow"` and `box-shadow`.
- **G2. Arbitrary shadows are not covered.** ADR 0037 decision 1 puts every shadow value in a token. `button.tsx:12` (`shadow-[0_6px_16px_…color-mix…]`) and `StickyActions.tsx:30` hold raw shadows. Neither the guard nor the sweep marker (`-[NNpx]`, `stage-02:15`) clearly covers them. Decide: token, ADR entry, or keep with a reason.
- **G3. The plan does not decide whether a file that only the pattern page imports counts as used (proven with grep).**
  - `components/ui/tabs.tsx` is imported only by `dev/sections/tabs.tsx`.
  - `stage-01:23` excludes `dev/` from the files it lists but does not say whether a `dev/` importer counts.
  - If it does not count, stage 01 deletes `tabs.tsx`, but stage 02 owns `components/ui/` (`stage-01:3`, `stage-02:3`) and step 2 sweeps the `tabs` variants (`stage-02:26`). The two parallel stages then edit or delete the same file.
  - Decide whether `dev/` imports count, and which stage owns the result.
- **G4. The unused-file guard has no case for the `@/` alias.** Nineteen files import through `@/` (tsconfig `paths`, `apps/web/tsconfig.json`), for example `components/ui/dialog.tsx:9`. Test case 2 (`stage-01:27`) covers extensions only. Add an `@/x` case.
- **G5. The interface between the two parallel stages is undefined.** `stage-01:23` says stage 02 names any list entry that stage 01 keeps in ADR 0037, and `stage-02:40` says "If stage 01 reported…". The stages run in parallel, so stage 02 can land first.
  - Both stages also edit `docs/decisions/0037-panel-design-system.md`, `docs/capabilities/web-panel.md` (`plan.md:60`) and the pattern page under `dev/`.
  - This breaks Rules for width rule 1, "Two stages that may run together own no common file" (`docs/product/pebble-ui/README.md:95`). Give each shared file one owner, or order the ADR edits.
- **G6. The no-organization card has no picture on the sheet.** `stage-03-visual-review.md:23` asks stage 03 to check it from the sheet. `apps/web/e2e/ui-sheet/routes.ts:5-21` has no state for a user with no organization. Decide: add a sheet state (which touches the e2e seed), or check it another way.
- **G7. The ADR-match test of stage 02 has no matching rule.** `stage-02:41` checks that "each file of the list is named in" ADR 0037. The lists hold paths (`components/settings/TotpQr.tsx`). Decision 7 names `TotpQr.tsx` and "the scrim of dialogs and sheets" (ADR line 65). `stage-02:40` mixes basenames and paths. Fix one form, path or basename.
- **G8. The emoji guard does not say whether it reads the plural forms.** `stage-01:10` reads "every string of `en` and `pl`". `enPlurals` and `plPlurals` (`i18n/en.ts:29`) are separate objects. A probe found no emoji there today.
- **G9. Stage 04 test 1 is ambiguous and can trap the release.** "reads `[Unreleased]` with 1 or 2 `forUsers` items" (`stage-04:23`). If a worker pins the real file's `[Unreleased]` count, `release:prepare` empties `[Unreleased]` in stage 05, and CI is red on the release commit. Say that the check is temporary or must not pin the count.

## Rules that conflict

- **C1.** B1: P1 against PB-12, `build.md:43` and the expiry in `build.md:44`.
- **C2.** D3 and questions 4 remove `next-themes` and change `bun.lock` "as an exception". DB-1 (`README.md:42`) says "A stage that needs to break one stops and asks". The plan takes the default with no stop. It is listed for the owner, but the programme rule says stop.
- **C3.** P2 (`plan.md:16`) counts the record "the 20-draft check is not done" (`docs/owner-decisions.md:858`, status `new`) as "recorded". PB-12 says the release "waits for the 20-draft check".
- **C4.** `stage-05:36` calls the 30-minute watch "a record, not a stop". `stage-05:41` makes a new `error` event a rollback trigger. Say that a trigger inside the watch window leads to a rollback.

## Facts used without a source, or checks that prove nothing

- **F1.** `stage-02:12` sends a stock shadow to "the overlay shadow the ADR names". ADR 0037 names only `--shadow-card` (line 38). The ADR names no overlay shadow.
- **F2.** P6 (`plan.md:19`) says T10 fails on flagged text, so the flagged pages must stay out. T10 matches only literal parts of 7 or more characters of the listed keys (`flagged-text.ts` `literalParts`). A sentence such as "Approvals is a one-draft queue" passes T10. The P6 rule rests on the author, not on the test (see also B4).
- **F3.** `stage-05:34` checks that `/dev/patterns` is "not 200" with no session. An unsigned request gets `302 /login` whatever the build holds (`apps/server/src/platform/http.ts:449-451`). The real guard is `apps/web/integrations/dev-pages.test.ts`. Check `dist` in the image instead, or drop the step.
- **F4.** `stage-05:22` reads CI "at each later wake". `spec/build.md:13` says "never wait for a run", and stage 06 is a coordinator run that sends no wake. Name what wakes the coordinator for the release commit's CI.

## Stage size

- **S1. Stage 03 is plausibly too big for one job (not measured).**
  - The work: one full `ui:sheet` (about 40 rows × 8 shots, run time not verified, `plan.md:50`), 48 pairs of mockup and sheet images, three views of each route, up to 100-line fixes on any page, a second sheet run, then the full `test:e2e` (about 19 min).
  - That is about 230 images in one context plus the fixes, against a 150-minute timeout.
  - Proposal: split it into a review stage (the verdict tables only) and a fix stage.

## Notes

- **N1 (plausible).** Stage 04 removes the `design/**` ESLint ignore and the `.gitignore` lines. ESLint reads `.gitignore` (`includeIgnoreFile`, `eslint.config.js:255`). Until stage 06 step 1 moves the study files, `bun run lint`/`lint:full` in the main checkout would lint them. Stage 06 says to run "right after that land", which is enough if it is followed.
- **N2.** The stage 01 Needs line names a range, "F169 stages 01–10" (`stage-01:3`, `stage-02:3`). `.agents/limen/planner.md:53` asks for the real dependency, not a range. The guards do read every file, so the range is defensible. Say so in the line.
- **N3.** `stage-05:36` says "the v0.4.5 watch script" but gives no path. The script is `~/ea-logs/v0.4.5/watch.sh` (`notes/2026-11-15-vps-deploy-queue.md:231`).
- **Checked against the sources:**
  - D7: no file in `db/migrations`, `bun.lock` or `deploy/` changed since `v0.4.5` (`git diff --name-only v0.4.5 HEAD`: empty).
  - Stage 05 steps 4 and 6 agree with `deploy/release.sh` and `deploy/rollback.sh`: split check, clean tree, version match, 3 GB, `pending` semantics, the rollback target and `rollback ok v0.4.5`. They also agree with `deploy/README.md` § Release (lines 47–72) and `docs/release-checklist.md` steps 1–11.
  - The `PATH=$HOME/bin` (rclone) and `compose.sim.yaml` steps are sourced (`notes/2026-11-15-vps-deploy-queue.md:101,154,164`).
  - The service worker existed at `v0.4.5` with cache `ea-shell-v1`, so the rollback cache-name claim holds.
  - `design/` holds 55 tracked files and 48 shots. Commit `94092626b` added it.
  - `next-themes` has no reader. `select.tsx:56` has `shadow-md`. The only emoji in panel texts are in `cat_help` en and pl (probe below).

## Checks run

- `git rev-parse HEAD` → `867ab63b16bde37a1cfbade8c8858fb63cdac469`.
- Greps and reads of the files cited above.
- Two throwaway `bun` probes. No test runner ran.
  - One printed the literal parts of the default-off `FLAGGED_TEXT` entries. Example: `docs_links` gives "what is new".
  - One scanned `en`, `pl` and the plurals for `\p{Extended_Pictographic}` and U+FE0F. Hits: `cat_help` (en and pl) only.
- No test suite, lint or typecheck ran (review job rule).
- Not verified: the `docs_links` state in production, the run time of a full `ui:sheet`, and the CI behaviour of the release commit.

Decisions for the owner: none

## Note check

- HEAD matches candidate 867ab63b: proven. `git rev-parse HEAD` ran alone in one bash call, exit 0, output `867ab63b16bde37a1cfbade8c8858fb63cdac469`.
- Each finding quotes file and line, and the review covers gaps, conflicts, guesses, unsourced facts and oversize stages: proven. The sections B1–B4, G1–G9, C1–C4, F1–F4 and S1 of this message carry the file:line citations.
- Stage 01/02 guards, the T10 rule and the stage 05 release/rollback checked against the sources: not proven by a single exit-0 command. The evidence is the reads of `apps/web/src/lib/token-classes.test.ts`, `apps/web/src/styles/global.css`, `apps/docs/src/changelog-page.ts`, `apps/docs/src/flagged-text.test.ts`, `deploy/release.sh`, `deploy/rollback.sh`, `deploy/README.md`, `docs/release-checklist.md` and `notes/2026-11-15-vps-deploy-queue.md` in this session, cited in the findings.
- Easy-to-miss rule "A review job runs no test suite, lint or typecheck": followed. This session ran no `test:*`, `lint`, `typecheck` or `check:job` command. Its commands were greps, reads, `git` and two throwaway `bun <script>` probes, which were deleted after they ran.
- Reminder "tests run once per job; no test:unit/int/e2e": followed. None ran.
- Reminder "a product-code job ends with check:job": not applicable. This review job committed nothing.
- Reminder "a review job runs no suite, lint or typecheck": followed (see above).
- Reminder "never delete node_modules/.cache": followed. Nothing was deleted except the two probe files in the worktree root.
