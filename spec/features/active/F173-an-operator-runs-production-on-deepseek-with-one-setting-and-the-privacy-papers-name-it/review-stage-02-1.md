PASS dbfb6956111377e2806524c182b3ac33d7d1ca14

I reviewed the F173 stage 02 candidate, the change that names DeepSeek in the privacy papers and docs: DPIA risk R11, the public security page in en and pl, the ADR 0015 amendment, the capability pages, the operator docs and the release note. HEAD is `dbfb6956111377e2806524c182b3ac33d7d1ca14`, which matches the candidate. The tree is clean. The branch is two commits on merge base `63c0b3120`.

There are no blocking findings. Every acceptance bullet of `stages/stage-02-papers-and-docs.md` holds by reading and by the worker's saved logs.

Unverified: nothing that blocks. The saved proof (`/tmp/f173/check.log`, last line `check:job PASS master=63c0b31209 tip=dbfb695611 full=0`) ran against master `63c0b3120`. Master has moved since then (see note 1), so that proof does not cover the merge that is now needed.

## Notes

1. **The merge with current master conflicts, and the resolution must keep the new rule 6 text.** Proven with `git merge-tree --write-tree master HEAD`, which reports `CONFLICT (content): Merge conflict in docs/capabilities/triage.md`.
   - The cause: the stage 03 gate-run branch reached master. It edited the same rule 6 paragraph. It added the `toDeepseekJsonSchema` clause and kept the old text "is for dev, tests and evals: it has no sub-processor row".
   - Whoever resolves the conflict must keep this candidate's "may serve production mail" text and add master's `toDeepseekJsonSchema` clause.
   - If master's side wins, the dev-only claim comes back and acceptance test 6 fails.
   - After the merge, `check:job` must run again.
   - `reply-drafts.md` merges automatically.

2. **One row of the DPIA measures table lacks its Source cell.** Proven by counting pipes: `docs/legal/dpia.md:75` has 3 pipes, the R10 row above it has 4.
   - The R11 measures row puts its sources inline, so the Source column renders empty for R11.
   - Every other row fills that column, and the section says "Each measure has its source".
   - Fix: move the paths `docs/decisions/0015-llm-provider-switch.md`, `apps/server/src/platform/llm/providers/endpoint.ts` and `docs/legal/claims.md` into a third cell.

3. **The gate results are stated correctly.** I compared every mention with master's `evals/results/deepseek-gate-lab-01.md` and the owner decision of 2026-11-26.
   - The candidate states no pass or fail number itself. It points to the summary file and to `deploy/README.md` § DeepSeek as an AI provider.
   - Switch step 1 there ("no errors and its `go` set holds the `go` set of the running provider, else stay on `openai`") agrees with the classifier result: 4 error cases, so the install stays on OpenAI.
   - Step 2 keeps `reply_drafts` off when its gate fails and `style_from_sent` off because it had no gate run. Both agree with the summary.
   - No text in the candidate moves the VPS off OpenAI.
   - Plausible improvement: the release note could say the outcome in one line ("today the classifier and drafter fail, so installs stay on OpenAI"). The operator would then not need to open the summary to learn it.

4. **No OpenAI-only fact is given to DeepSeek.**
   - The R1 measure now says that DeepSeek uses the same adapter, "and this project does not claim that DeepSeek obeys it" (`store: false`).
   - The training and abuse-log facts are now limited to "When the install uses OpenAI".
   - The en and pl security pages keep the OpenAI facts under "Facts that come only from the AI provider". The DeepSeek facts go in a separate bullet marked "optional … not the default setup".
   - Plausible readability note: the first heading says "the AI provider" without the name OpenAI. A reader of the new DeepSeek bullet could read it as general. "the default AI provider" would remove that doubt. This is not a claim error.

5. **R11 agrees with the privacy page and record B.**
   - In the DPIA (`dpia.md` lines 57, 75, 93), R11 says DeepSeek "states that it collects, processes and stores" data in the PRC. It names the adequacy gap, the placeholders `<to confirm: transfer mechanism>` and `<to confirm: DeepSeek API data use and retention>`, and levels medium/high.
   - This matches `apps/web/src/legal/en/privacy.md` lines 48 and 51 (the provider list, the PRC location and the same placeholder).
   - It also matches `docs/legal/records-of-processing.md` Record B, lines 51–52 (the `deepseek` recipient and the PRC transfer).
   - The claim in the R11 measures that "DeepSeek is a sub-processor in the DPA and the privacy policy" is true at HEAD.
   - The ledger changes are correct: rows C283–C288 are added, C209 changes to "US (OpenAI or Gemini)", and the totals 288 / 3 / 33 agree with the new count row.

6. **Polish text is correct.** The new lines in `pl/security.mdx` (lines 62–65) and the pl line in `CHANGELOG.md` address no reader by gender. They use impersonal forms, and the second person "akceptujesz" is the same for all genders. The sourceHash of `pl/security.mdx` was updated to `b6025a857b27fa65`. In this job `bun run docs:stale` printed `stale: 0`, so the Polish page is in step with the English page. That bash call also held `;`, so it does not count as a proof command for Limen.

7. **No doc still says DeepSeek is dev-only or refused.** A grep for "dev, tests and evals" over docs, deploy, apps and packages finds nothing.
   - The matches for "no sub-processor row" are all about a provider with no row (`config-llm.ts:156`, `preview.ts`, `style-suggest.ts`), not about DeepSeek.
   - Unchanged: `docs/architecture.md` §6.3 (line 453) still says "Two providers … `gemini` or `openai`", and "Data by stage" (line 476) does not name DeepSeek. This was already true before this candidate, and the stage file does not list `architecture.md`. It is still a gap against the stage 02 Step 3 goal, "every doc says production may use DeepSeek". It is a small follow-up, not a break of an acceptance bullet.

8. **The new tests are sound.**
   - The new `describe("deepseek")` cases in `apps/server/src/legal-outside-calls.test.ts` make exact checks: 3 R11 rows, the L/S cells by regex, and fixed strings per language in a `test.each` table.
   - The claims ledger test in `apps/docs/src/security/claims.test.ts` now expects 288 rows.

## Checks I ran

- `git rev-parse HEAD` → `dbfb6956…`, and `git status` was clean.
- `git merge-tree --write-tree master HEAD` → exit 1, conflict in `triage.md`.
- `bun run docs:stale` → `stale: 0`, exit 0.
- The grep for acceptance test 6 → no match.
- Greps for stale DeepSeek claims and for store/training claims → nothing wrong found.
- A pipe count of `dpia.md` lines 74–75 → 4 and 3.

I read these saved logs and did not rerun them:
- `/tmp/f173/legal.log`: 2903 pass, 0 fail.
- `/tmp/f173/docs.log`: `claim_check ok 15`, exit 0.
- `/tmp/f173/check.log`: `check:job PASS master=63c0b31209 tip=dbfb695611`.

All three were written after the candidate commit time. Their master is the merge base, not current master.

I ran no test suite, lint or typecheck.

## Note check

- HEAD matches the candidate: not proven by the Limen rule. I ran `git rev-parse` in a bash call with `;`. Its output was `dbfb6956111377e2806524c182b3ac33d7d1ca14`.
- Stage test 1 (`legal-papers.test.ts` passes): proven. `/tmp/f173/legal.log` (2903 pass, 0 fail; it holds `apps/server/src/legal-papers.test.ts`).
- Stage test 2 (DPIA holds `| R11 ` and `China`, in `describe("deepseek")`): proven. `/tmp/f173/legal.log` (it holds `legal-outside-calls.test.ts`, 0 fail), and the rows are in `docs/legal/dpia.md` lines 57, 75 and 93.
- Stage test 3 (`claims.test.ts`, `subprocessor-view.test.ts` and `polish.test.ts` pass): proven. `/tmp/f173/legal.log` (all three files are listed, 0 fail).
- Stage test 4 (`docs:build` prints `claim_check ok`): proven. `/tmp/f173/docs.log` (`claim_check ok 15`, exit 0).
- Stage test 5 (`bun run docs:stale` exits 0): not proven by the Limen rule. I ran it in this job and saw `stale: 0` with rc=0, but the bash call also held `;`. No saved log exists, and I did not rerun it.
- Stage test 6 (the grep for "dev, tests and evals" finds nothing about DeepSeek): not proven by the Limen rule. The grep printed nothing, but its call held `;` and `2>/dev/null`. The current text of `docs/capabilities/triage.md` rule 6 and `docs/decisions/0015-llm-provider-switch.md` line 50 supports the result.
- Plan Proof exits 0: proven at the merge base. `/tmp/f173/check.log` (last line `check:job PASS master=63c0b31209 tip=dbfb695611`). It does not cover current master (note 1).
- No dev-only or refused claim, and no OpenAI-only fact on DeepSeek: proven by reading. `docs/legal/dpia.md` line 65, `apps/docs/src/content/docs/security.mdx` lines 58–63, `docs/capabilities/triage.md` line 16.
- R11 agrees with the privacy page and record B, and the gate results are correct with the VPS on OpenAI: proven by reading. `docs/legal/dpia.md`, `docs/legal/records-of-processing.md`, `apps/web/src/legal/en/privacy.md`, `deploy/README.md`, and master's `evals/results/deepseek-gate-lab-01.md`.
- Polish reader gender and the sourceHash: the gender part is proven by reading `apps/docs/src/content/docs/pl/security.mdx`. The hash part is not proven by the Limen rule, for the same reason as stage test 5.
- Easy-to-miss rule ("Run no test suite"): followed. This job ran only reads, greps, `git merge-tree` and the `docs:stale` script. It ran no `bun test`, `test:*`, lint or typecheck.
- Reminder, tests run once per job and no `--no-verify`: followed. I ran no test and made no commit.
- Reminder, `check:job` as the last step for a job that commits product code: does not apply. This is a review job and it made no commit.
- Reminder, a review runs no suite, lint or typecheck: followed. I ran none.
- Reminder, never delete `node_modules/.cache/`: followed. I touched no cache.
