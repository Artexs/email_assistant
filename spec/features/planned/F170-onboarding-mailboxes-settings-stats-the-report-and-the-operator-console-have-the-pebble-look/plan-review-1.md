**Verdict: the F170 plan is not ready to build.** It has 3 blockers (the first three findings) and 4 smaller findings. I changed no repo files. The last `git status --short` printed nothing.

**Findings**
1. **OAuth "access revoked" card (P3, question 3, stage 07).** The plan says Connect "reconnects" an existing OAuth mailbox. At HEAD it does not.
   - `startOAuth(provider)` in `apps/web/src/lib/mail-oauth.ts` never sends `mailboxId`.
   - `connect` in `apps/server/src/modules/mail/oauth/apply.ts` refuses an existing address with `mailbox_exists`.
   - Only a start call that carries `mailboxId` reaches `reconnect`, and no web code sends one.
   - The default button would always fail. Decide between a Reconnect button that sends `mailboxId` and a "remove and connect again" hint. Mark it `[important: user-visible]`.
2. **Stage 10 Needs line is incomplete.**
   - It lists F166 stages 03 and 09 only. It also uses `FactBox` (F166 stage 10), `Button` size `xs` at 36 px (F166 stage 04), and the `schemes` option and `UI_SHEET_DIR` (F166 stage 02).
   - The other stages get stage 02 and stage 08 only through F166 stages 06 and 10.
3. **The Proof depends on F166 work that does not exist at HEAD.**
   - `web:build:dev`, `ui:sheet` and `patterns.spec.ts` are missing.
   - No F170 Needs line names them.
4. **Stage 01 removes `set_section_general`, and three places still read it.**
   - `push-devices.spec.ts` and `telegram-detail.spec.ts` wait for that heading. Both belong to stage 04.
   - `apps/docs/.../reference/settings.mdx` renders the key.
   - Stage 01 has no docs step.
5. **Shared contact-sheet rows have no owner.** D7 adds sheet rows in the F166 file `apps/web/e2e/ui-sheet/routes.ts`. Several stages would edit it in parallel. The flag states the plan names also may not exist, because `seed.ts` has no flag states.
6. **The `useModeChange` interface is inconsistent.**
   - D2 gives `onChanged` and `onFail`, but stage 01 mentions `onMissing`.
   - Stage 02's Needs line puts the hook in `ModeCard.tsx`. It is in `lib/use-mode-change.ts`.
7. **Two owner-visible choices are missing from `questions.md`.**
   - The Stats ring shows `wouldHandle` in a shadow week (stage 08).
   - A read-only owner on the onboarding mode step loses the "open" text (stage 06).

**Checked and fine**
- Named files, e2e specs and docs how-tos exist.
- The stats and onboarding schemas and the stats helpers match the stage text.
- The unit-test values in the stages are consistent with the code.
- No stage changes an API, and there is no scope creep.
- Question 1 correctly marks the Assist-link deviation as an owner decision.

**Not verified:** the operator `page.route` fallback. I ran no test suite, lint or typecheck.

## Note check
- Every stage has a Needs line that names a real file or interface: proven. I read all ten stage files; stage 10 and the Proof have gaps (findings 2 and 3).
- Each file seam, proof command and decision exists at HEAD: proven. Evidence: I checked `package.json`, `apps/web/src/components/`, `apps/web/e2e/tests/` and `apps/server/src/modules/mail/oauth/apply.ts` with `ls`, `rg` and `grep`. These were separate calls, mostly with `;` or pipes, so no single qualifying command exists. Three items do not exist at HEAD, and findings 1 and 4 to 6 come from this check.
- Verdict with findings delivered, no repo file edited: proven. Evidence: this message, and `git status --short`, a single call that exited 0 with no output.

**Easy-to-miss rule ("Report only; do not edit files"): followed.** `git status --short` printed nothing in the worktree. My only write was `.limen/jobs/…/note.md`, which the task required and which sits outside the worktree.

**Project reminders**
- Tests run once per job, never commit with `--no-verify`, no `test:*` runs: followed. I ran no test suite and made no commits.
- `check:job` as the last step of a product-code job: not applicable. This is a review job and I committed no code.
- A review job runs no test suite, lint or typecheck: followed.
- Never delete `node_modules/.cache/`: followed. I did not touch it.

Not proven yet: none. Nothing is in flight; the plan has no fixes applied.
