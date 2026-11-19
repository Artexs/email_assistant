# F121 plan review 1

Job `2026-11-18-f121-plan-review-9cb589a4` (claude-opus-5-5, high), at `85f26a6f`. Review text copied whole from the job log; the job's final note check follows.

FAIL 85f26a6f6cc91a55914e673ecf27f35808c0ae74

HEAD is `85f26a6f6cc91a55914e673ecf27f35808c0ae74`. It matches the candidate, and the tree was clean after my probes.

## Blocking findings

**B1. The rule for weak ledger rows misses rows that say `unverified` or `gap` in the middle of the cell. The security page can then state an unproven claim, and the build check passes. (Proven: I parsed `docs/legal/claims.md`.)**
- The plan's rule is at `stages/stage-01-hold-and-claim-check.md:38` and `interfaces.md:12`. A row is weak only when its source *starts with* `gap` or `unverified`.
- 25 rows start that way. Seven more rows have the word later in the source cell:
  - C033: "OpenAI does not train on API data … unverified: the contract itself is not in the repo".
  - C036: "no EU region … unverified: the region setting…".
  - C039, C137, C140, C185 and C197.
- The ledger header counts 31 gap or unverified rows, but only 25 start that way.
- Stage 02 sends the buyer questions "is it used for training" and "where is it processed" to exactly these rows (`stage-02:13`). The build check marks them strong.
- This breaks D2 (`plan.md:27`, "its source is not `gap` or `unverified`") and the Q9 default (`questions.md:21`).
- Test 9 (`stage-01:45`) uses only fixtures with the word at the start of the cell, so it cannot catch this.
- Fix: a row is weak when the word `gap` or `unverified` appears anywhere in the source cell. Add a fixture like C033 to test 9.

**B2. Stage 04 cannot pass its own Proof unless it edits the Polish page, which its scope forbids. (Proven by a probe.)**
- `index` is in `POLISH_SET` (`apps/docs/src/front-matter.ts:15`).
- Probe 1: I added one `##` section and a `security/` link to the English `index.mdx`. Test T4 in `apps/docs/src/polish.test.ts:109` then failed: `"h2 1 0"`, `"links start/,faq/,security/ start/,faq/"`. That test runs in `test:unit:ci`, which is part of the Proof.
- Probe 2: I added one line to the same file. `bun run docs:stale --strict` then gave `pl/index is stale and its source index is public`, exit 1. This would block release-checklist step 7 and every VPS release from the land of stage 04 to the land of stage 05.
- Stage 04 puts the Polish home out of scope (`stage-04:41`). Stage 05 comes later (`plan.md:109`).
- Fix: move the Polish home rewrite and re-stamp into stage 04, or join stages 04 and 05 for `index`.

**B3. The public security page shows `<to confirm: …>` placeholders from the sub-processor registry. No decision covers this. (Proven: I read `packages/core/src/legal/subprocessors.ts`.)**
- Stage 02 (`stage-02:32`) renders "every registry row, with … `location`".
- 8 of the 10 rows have a location that is `<to confirm: location>` or ends in `<to confirm: country>`. One row is named `<SMTP provider>` and has `termsUrl: "<to confirm: …>"`.
- Stage 02 test 2 (`stage-02:20`) forbids `<to confirm` only in claim rows.
- This conflicts with Q9: weak claims are left out, but unverified sub-processor facts are shown as they are.
- A decision is needed: hide the placeholder field, show a fixed "not yet confirmed" text, or leave out unconfirmed fields. The cold read will also need an expected answer for "where is it processed".

## Unverified

- **U1.** Stage 10 test 3 (`stage-10:19`) expects `duration > 0` from an H.264 MP4 in Chromium.
  - CI uses Playwright's own Chromium (`apps/docs/e2e/playwright.config.ts:24-26`). I expect, but could not confirm here, that it cannot play H.264. If so, the test fails in CI, and the deploy's `docs:test` fails after G3 (a broken deploy).
  - "A 1-second MP4 made by the test" needs ffmpeg, which D9 forbids in CI (`plan.md:34`).
  - Decide on a committed fixture and one of two paths: a codec check, or the `chrome` channel.

## Notes

1. **The gate wiring is not tested, and an existing test will break. (Proven by reading.)**
   - The test at `apps/docs/scripts/deploy-gate.test.ts:204` starts the real script and expects `deploy=true`. With the real constant `["index","security","pricing"]`, it will get `deploy=false`.
   - Stage 01 does not say how the script test gets the pending list. The quick fix is an env override, which would also be a way around the hold.
   - Stage 01 tests 1–6 test only `deployDecision`. If `main` passed `[]` instead of the list, all of them still pass.
   - Add a script-level test that uses the real constant. Inject the list as a parameter of `main`, never through env.
   - `stage-01:19` says "the job summary like the other skips", but today the script writes no job summary.
2. **The flagged-text test cannot catch the mistakes the plan says it catches. (Proven by reading.)**
   - `flagged-text.test.ts:116-129` reads only the `.mdx` files under `src/content/docs`.
   - It does not see: claim text in `claims.ts`, registry rows, `CostTable`, OpenAPI summaries, VTT captions, or the `DemoVideo` line.
   - These places rely on it anyway: `stage-02:14`, stage 06 test 7, `stage-10:13` and `plan.md:66`.
3. **The owner rule and two plan defaults conflict.**
   - Owner rule (`plan.md:11`): user docs describe nothing that a default-off flag gates.
   - P7/Q4 (`plan.md:22`, `questions.md:15`) publishes flagged routes, including the trust routes that P6 excludes.
   - P5/Q2 publishes flagged steps in the video and its captions.
   - Q4 is marked `[minor]`, but it breaks an explicit owner rule.
4. **G1 and G2 use different standards for "public".**
   - G2 treats a commit to the public repo as publication that cannot be taken back (`questions.md:8`).
   - D1 lands the security and pricing text and the claims in public `master` and holds only Pages.
   - State this to the owner, or keep the page sources off `master` until G1.
5. **At G1 the owner reviews a site that differs from the deployed one.**
   - The G1 step builds without shots and without the video (`questions.md:7`).
   - The deploy later adds demo shots (after G2) and the video (after G3). The owner never sees those frames.
   - G3 has no "watch it first" step. The asset is not pinned by hash, so an upload with `--clobber` changes the next deploy.
6. **The claim check can be satisfied by proofs that prove nothing.**
   - It checks only that each proof path exists (`stage-01:39`). It does not check that the path is one of the cited ledger row's sources.
   - A ledger `condition` other than `—` is not required on the public claim. There is no `condition_missing` reason.
   - The rule "Do not soften a ledger claim" (`stage-02:12`) has no test.
7. **The rendered tables are not tested.**
   - D3 (`plan.md:28`) and the acceptance want the *rendered* rows compared. Stage 03 tests the `costRows()` data, and the browser check only counts 3 rows. A `CostTable` that renders the wrong field passes. Stage 02 test 4 has the same gap.
   - Rounding shows total 1.91 and margin 23.10, which add up to 25.01 (checked with `bun -e`).
   - The "20 mailboxes per host" text is typed by hand instead of read from the constant.
8. **`toVtt` does not fit stage 09.**
   - `interfaces.md:32` defines `toVtt(steps, lang)` with no marked times and no trim offset.
   - `stage-09:17` takes cue times from the marked times, but test 1 uses the table times.
9. **A second recording run will probably fail.**
   - `importDemo --replace` refuses (`replace_refused`) when the earlier import's mailbox is no longer paused with the placeholder secret (`import.ts:62-74`).
   - A live `mailbox:connect` step does exactly that. The e2e wipe (`e2e-seed.ts:167`) does not delete "Kordelan demo (import)".
   - So a second `demo:record`, or a stage 07 shot run from the demo seed on the shared e2e DB, fails. The connected mailbox may also poll during other e2e runs. No cleanup decision exists.
10. **Stage 07 sign-in and flagged data are not decided.**
    - The import makes the owner with no password (`live-lab.md` rule 24.7). "Sign in as that owner" needs a decision: the reset-link path, terms acceptance, and an address that is not one of the e2e seed users (the e2e wipe deletes those users).
    - A rerun needs `--replace`.
    - The demo week ran with `LAB_FLAGS_ON`, so its activity data can show flagged features in a shot. `shotFeaturesProblem` checks only the org's flag list.
11. **Other check gaps:**
    - The public-content scan skips `.vtt` (`public-content.ts:9`), so the downloaded captions are not scanned.
    - The image-path check covers only `<img src>`. It misses `srcset`, `<source>`, `poster` and CSS `url()`.
12. **Some claims bypass the claim check, and some stages get no review.**
    - The API page says the API is not reachable from the internet (`stage-06:33`). That is ledger row C066, which has a condition, but the page states it outside `publicClaims`.
    - The rule for home-page claims (`stage-04:15`) has no test.
    - The review list (`plan.md:90`) leaves out stages 03, 04 and 06, which hold the price, the positioning claims and the flagged-route text.
13. **Cold-read question 10** ("how do I see it work") has no expected answer when G3 stays at its default (no video).
14. **The hold list is incomplete.** `OWNER_REVIEW_PENDING` (`plan.md:26`) leaves out the two new reference pages of stage 06.
15. **C1 can take up to about 12 days, not 5.** `demo-reset` starts on the next Monday unless `--date` is given (`live-lab.md` rule 23.7). `plan.md:82` says "≥ 5 days" and gives no `--date`.
16. **Stage 09 is probably too big for one job.** It holds a spike that can stop it, a live 8-step spec, the encoder and the command. Suggested split:
    - 09a: spike, `steps`, `toVtt`, argument builder.
    - 09b: the spec and the encode.
17. **A manual run can publish unreviewed pages without any warning.** While the list is not empty, a manual run (also a rollback) publishes the held pages. G1's own consequence pushes the owner toward manual runs. Add a warning or a confirm input.

## Checks run

- `git rev-parse HEAD`: matches the candidate.
- `bun install --frozen-lockfile`: exit 0.
- `bun test apps/docs/src/polish.test.ts apps/docs/scripts/deploy-gate.test.ts apps/docs/src/flagged-text.test.ts`: 56 pass, 0 fail.
- Probe for B2: a temporary edit of the English `index.mdx`, then the restore. T4 failed as quoted above, and `bun run docs:stale --strict` exited 1. `git status` was clean after the restore.
- Ledger parse with a Python script: 242 rows, 25 weak at the start of the cell, 7 with the word later in the cell.
- `bun -e` rounding check: 1.905 rounds to 1.91; the margin 23.095 gives 23.1 with `Math.round` and 23.09 with `toFixed`.
FAIL 85f26a6f6cc91a55914e673ecf27f35808c0ae74

The plan must not be built as it stands: three proven gaps would put an overclaim or unfinished text on the public site, or stop a stage from passing its own Proof. My full findings are in the previous message; here is the short form.

## Blocking findings
- **B1.** The rule for weak ledger rows checks only the start of the source cell (`stage-01:38`, `interfaces.md:12`). Seven rows say `unverified` or `gap` later in the cell, including C033 (AI training) and C036 (EU region), so the build check would accept them. This breaks D2 and Q9. I proved it with a Python parse of `docs/legal/claims.md`.
- **B2.** Stage 04 cannot pass its own Proof without changing the Polish page, which is out of its scope. A probe edit of the English `index.mdx` failed test T4 in `polish.test.ts` and made `docs:stale --strict` exit 1.
- **B3.** 8 of the 10 sub-processor rows have a location that is or ends in a `<to confirm…>` placeholder. Stage 02 renders every row on the public security page, and no decision covers this.

## Unverified
- **U1.** Stage 10 test 3 needs an H.264 MP4 to play in Chromium. I expect, but did not check, that Playwright's own Chromium, which CI uses, cannot play H.264. If so, that test fails and the deploy's browser check fails once the owner uploads the video.

## Notes
Notes 1–17 in the previous message stand. The most important:
- No test runs the gate script with the real list.
- The flagged-text test reads only the `.mdx` page files.
- The owner rule and the defaults Q2 and Q4 conflict.
- The owner's G1 review sees a site without the shots and the video.
- A second recording run fails with `replace_refused`.
- Stage 07 does not say how to sign in as the imported owner, who has no password.
- `toVtt` does not fit how stage 09 sets the caption times.

## Note check
- HEAD is the candidate: proven. `git rev-parse HEAD && grep -n "to confirm" packages/core/src/legal/subprocessors.ts > /tmp/f121-review-facts.log && …` exited 0 and printed `85f26a6f6cc91a55914e673ecf27f35808c0ae74`.
- Each pre-mortem path is traced to a stage, with file:line: not proven. The trace is only in my previous final message, not in a file or a command.
- Facts the plan uses are checked against code at HEAD: proven. See `/tmp/f121-review-facts.log`: the `<to confirm>` registry rows, ledger rows C033 and C036, `"index"` in `POLISH_SET`, and `replace_refused` in `import.ts`. The other facts (the ledger parse, the T4 and strict-stale probes) ran in calls joined with `;` or a heredoc, so they do not count as proof.
- First line is `PASS <sha>` or `FAIL <sha>`: not proven. Only the final message itself shows this, and there is no file.
- Easy-to-miss rule (missing code detail is not a finding): followed, but not proven. Each finding names a missing decision, edge case, test or interface, not a line number or edit text. The only evidence is the text of the findings, and no command checks this.

## Final message of the job

FAIL 85f26a6f6cc91a55914e673ecf27f35808c0ae74

The plan must not be built as it stands: three proven gaps would put an overclaim or unfinished text on the public site, or stop a stage from passing its own Proof. My full findings are in the previous message; here is the short form.

## Blocking findings
- **B1.** The rule for weak ledger rows checks only the start of the source cell (`stage-01:38`, `interfaces.md:12`). Seven rows say `unverified` or `gap` later in the cell, including C033 (AI training) and C036 (EU region), so the build check would accept them. This breaks D2 and Q9. I proved it with a Python parse of `docs/legal/claims.md`.
- **B2.** Stage 04 cannot pass its own Proof without changing the Polish page, which is out of its scope. A probe edit of the English `index.mdx` failed test T4 in `polish.test.ts` and made `docs:stale --strict` exit 1.
- **B3.** 8 of the 10 sub-processor rows have a location that is or ends in a `<to confirm…>` placeholder. Stage 02 renders every row on the public security page, and no decision covers this.

## Unverified
- **U1.** Stage 10 test 3 needs an H.264 MP4 to play in Chromium. I expect, but did not check, that Playwright's own Chromium, which CI uses, cannot play H.264. If so, that test fails and the deploy's browser check fails once the owner uploads the video.

## Notes
Notes 1–17 in the previous message stand. The most important:
- No test runs the gate script with the real list.
- The flagged-text test reads only the `.mdx` page files.
- The owner rule and the defaults Q2 and Q4 conflict.
- The owner's G1 review sees a site without the shots and the video.
- A second recording run fails with `replace_refused`.
- Stage 07 does not say how to sign in as the imported owner, who has no password.
- `toVtt` does not fit how stage 09 sets the caption times.

## Note check
- HEAD is the candidate: proven. `git rev-parse HEAD && grep -n "to confirm" packages/core/src/legal/subprocessors.ts > /tmp/f121-review-facts.log && …` exited 0 and printed `85f26a6f6cc91a55914e673ecf27f35808c0ae74`.
- Each pre-mortem path is traced to a stage, with file:line: not proven. The trace is only in my previous final message, not in a file or a command.
- Facts the plan uses are checked against code at HEAD: proven. See `/tmp/f121-review-facts.log`: the `<to confirm>` registry rows, ledger rows C033 and C036, `"index"` in `POLISH_SET`, and `replace_refused` in `import.ts`. The other facts (the ledger parse, the T4 and strict-stale probes) ran in calls joined with `;` or a heredoc, so they do not count as proof.
- First line is `PASS <sha>` or `FAIL <sha>`: not proven. Only the final message itself shows this, and there is no file.
- Easy-to-miss rule (missing code detail is not a finding): followed, but not proven. Each finding names a missing decision, edge case, test or interface, not a line number or edit text. The only evidence is the text of the findings, and no command checks this.
