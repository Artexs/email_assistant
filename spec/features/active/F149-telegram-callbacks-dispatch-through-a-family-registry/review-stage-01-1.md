PASS 23c26f93d8fc57220c953205bdd937c33a27cfc2

I reviewed F149 stage 01, the core callback registry. The candidate replaces the encode and decode switches in `@ea/core` with one `callbackKinds` record keyed by kind. `git rev-parse HEAD` printed 23c26f93d8fc57220c953205bdd937c33a27cfc2, which matches the candidate. That commit merges master into the stage commit 3392a7f4. The merge does not touch `packages/core/src/digest/`. I found no blocking finding.

## Unverified
- **Typecheck guards (stage 01 break check 4, ticket acceptance 3, plan-review-1 N4).** A review runs no typecheck, so I did not run the break "a kind in `Callback` with no `callbackKinds` entry". By reading:
  - `satisfies { [K in CallbackKind]: KindEntry<K> }` (callback-kinds.ts:320) rejects a missing key.
  - The mapped `golden` table type rejects a missing row.
  - The `sameTypes` tuple (callback-registry.test.ts, end of file) fails to compile if `family` widens to `CallbackFamily`, or if a family union changes.
  - I did not see the worker's report of its break checks. The proof is the pre-commit typecheck of 3392a7f4.

## Focus checks
- **Forged prototype keys in the code position decode to null: proven by test and break run.**
  - `codedDecode` matches the rest against an anchored pattern, `^([a-z]):(UUID)$`, and then looks up the letter in a `ReadonlyMap`. The prefix lookup `KIND_BY_PREFIX` is a `Map` as well. No data string indexes a plain object.
  - Test 4 has the rows `fr:constructor:`, `vr:__proto__:` and `rw:toString:`, which covers plan-review-1 N1.
  - Break run 1: I replaced `codedDecode` with `split(":")` plus a plain-object lookup. Exactly those 3 rows failed (123 pass, 3 fail).
  - Break run 2: I replaced the prefix `Map` with a plain object. The rows `__proto__`, `constructor`, `toString` and `hasOwnProperty` failed (122 pass, 4 fail).
  - I restored the file after each run, and `git status --porcelain` was empty.
- **The old predicates and the codec give the same answers as before: proven by a differential probe.**
  - I loaded the plan-base `callback.ts` (`git show 3392a7f4^1:…`) as a temp file next to the new code, ran the comparison, then removed the temp file.
  - `parseCallback`, old against new, over 872,392 data strings gave 0 differences. The strings were every 3-piece combination of the 33 prefixes, the codes, the prototype keys, upper-case ids, ids with a trailing newline or letter, and base64 parts of 21 and 22 characters, plus 200,000 random strings with a prefix.
  - On the 28,627 non-null values, which cover all 33 kinds:
    - `encodeCallback` gave 0 differences.
    - `isAnsweredCallback`, `isReplyCallback`, `isLoopCallback`, `isDelegateCallback`, `isFeedbackCallback` and `isReviewCallback` gave 0 differences.
  - The encode error texts are the same: "bad email id" for the feedback kinds and "bad id" for the other kinds (D8). The `dp` data of the golden ids is the same string.
  - The five existing test files have no diff against the plan base.
- **One source of prefixes: proven by rg.**
  - In the two codec files, each of the 33 prefixes appears once in code, at its `prefix:` field in callback-kinds.ts:108–317. `callback.ts` holds no prefix literal now.
  - Other core matches are comments, plus `sim/live/executive.ts:87`, which the stage exempts.

## Stage 01 and plan-review-1 items
- Tests 1–7 are present. N2 holds: there is no self-comparing "test 8". N5 holds: `rv:${ID}` has its own case. The family counts are 9, 2, 6, 5, 2 and 9, and test 6 ties each golden family to `callbackFamilyOf`.
- `callback-kinds.ts` has 364 lines, under the 400-line limit (D14).
- Only one server file changed: approval-taps.ts imports the `ApprovalCallback` type from core instead of its local `Exclude`.
- No runtime import cycle exists: `callback-kinds.ts` imports `./callback` as a type only.
- N3, N6, N8 and N10 are about stage 02, and this candidate does not touch them.

## Notes
- **Plausible, low risk, outside the typed contract.** `isFeedbackCallback` was a structural check (`"emailId" in callback && …`). It is now a lookup in `callbackKinds[callback.kind]`. An untyped object with an unknown kind would now throw a TypeError where it gave false before. An object with the kind `constructor` would give false through the prototype. All callers pass `parseCallback` output, so I found no reachable path. Stage 02 removes these wrappers (D7).
- **Plausible, docs.** `docs/capabilities/open-loops.md:20` still names `callback.ts` as the home of the prefixes, and the prefixes now live in `callback-kinds.ts` (plan-review-1 N8). The stage gives the docs to stage 02. Stage 02 should fix this line.
- **Duplicate re-export.** `digest/index.ts` re-exports `encodeCallback` and `parseCallback` through both `./callback` and `./callback-kinds`. Both resolve to the same binding, so it is legal. The clean test run loaded it with no error.

## Checks run
- `bun install --frozen-lockfile` installed 991 packages. The first test run had failed with "Cannot find module '@ea/core'" because the worktree had no `node_modules`.
- `bun test packages/core/src/digest/callback-registry.test.ts` gave 126 pass, 0 fail.
- The same file with the two break edits gave 3 fail and 4 fail, as described above. I restored the file each time.
- I ran the differential probe script once with `bun` and then removed it.
- `git rev-parse HEAD && rg -c 'prefix: "[a-z]{2}"' packages/core/src/digest/callback-kinds.ts && git diff --exit-code --stat 3392a7f4^1 3392a7f4 -- <the five existing test files> && git status --porcelain` exited 0. It printed the candidate sha and 33, with no diff and a clean tree.
- I ran no suite, no lint and no typecheck.

## Note check
- **Forged data with `constructor`, `__proto__` or `toString` in the code position decodes to null:** proven by the file `packages/core/src/digest/callback-kinds.ts`. `codedDecode` uses the anchored `CODED_REST` and a `ReadonlyMap`, and `KIND_BY_PREFIX` is a `Map`. The break-run results come from bash calls joined with `;`, so they are supporting evidence only.
- **Old predicates give the same answers as before:** not proven by the harness standard. The probe ran in a bash call joined with `;`, and it saved no log. It printed "predicate diffs 0" and "parse diffs 0". I did not rerun it, because it was a run-once check.
- **One source of prefixes:** proven. `git rev-parse HEAD && rg -c 'prefix: "[a-z]{2}"' packages/core/src/digest/callback-kinds.ts && …` exited 0 and printed 33. The search over the rest of core was in a `;` call and is not proven to that standard. It showed only comments and the exempt `sim/live/executive.ts`.
- **Stage 01 acceptance, existing test files unchanged:** proven. `git diff --exit-code --stat 3392a7f4^1 3392a7f4 -- <five files>`, in the same `&&` call, exited 0.
- **Stage 01 acceptance, tests 1–7 present and passing:** proven by the file `packages/core/src/digest/callback-registry.test.ts`. The run that passed (126 pass) was a single `bun test` call, but its output went through a pipe to `tail`, so the harness may not count it.
- **Stage 01 acceptance, break checks 1–3:** not proven to the harness standard, for the same reason (`;` calls). I saw break checks 2 and 3 fail as the stage expects. Break check 1, the prefix change that test 1 should catch, I did not run.
- **Stage 01 acceptance, break check 4 (typecheck fails on a kind with no entry):** not proven. A review runs no typecheck.
- **plan-review-1 N1:** proven by the test file (the three rows with a prototype key in the code position).
- **plan-review-1 N2:** proven by the test file (no self-comparing test).
- **plan-review-1 N5:** proven by the test file (the separate `rv:${ID}` case).
- **plan-review-1 N9:** proven by the `rg -c` line above.
- **plan-review-1 N4:** not proven (the typecheck break is above).
- **plan-review-1 N3, N6, N7, N8 and N10:** dropped for this candidate. The task scopes this review to stage 01, and these items are about stage 02 or the owner question.
- **Easy-to-miss rule "Run no suite. Name the commit reviewed.":** followed. I ran only single-file `bun test` runs of `callback-registry.test.ts` and one probe script. The first line of this message names 23c26f93, and the `&&` call printed it.
- **Reminder "tests run once per job; run single files only":** followed. I ran one test file: once clean, once per break, and once for a failed first attempt before the install.
- **Reminder "a job that commits product code runs `bun run check:job`":** not applicable. This review made no commit, and `git status --porcelain` was empty.
- **Reminder "a review job runs no suite, lint or typecheck":** followed. I ran none.
- **Reminder "never delete `node_modules/.cache/`":** followed. I deleted nothing in `node_modules`.
