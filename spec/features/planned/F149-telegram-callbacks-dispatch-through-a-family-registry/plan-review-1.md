PASS 2973af4c59d1c020c3568d139a922c056e85364d

This is a cold review of the F149 plan, which moves Telegram callbacks to a kind codec record in core and a family handler record in the server. HEAD is `2973af4c`, which matches the candidate. The plan base is `e8f6f2b1`, which is the merge-base with master. I found no blocking finding, and the decisions do not conflict with each other. Both stages fit the size rule. `wc -w` gives plan.md 1,208, stage 01 696 and stage 02 699. plan.md:76 records 1,186 because it counted before the trims, and 1,208 is still under the limit.

**Pre-mortem.** If a bug reaches a user, stage 01 most likely lets it through (N1). The rewritten decoder could read a category or reason code before it checks the code, and no listed test or break check covers that. Stage 02 is safer: the typed handler record and the existing integration tests guard it. Its own unit-test break check proves less than it claims (N3).

## Unverified
- I could not import `callbacks.ts` in a bun test with no DB, so I do not know if a unit test can load it (stage-02:37 "no DB"). The worktree has no `node_modules` ("Cannot find module '@ea/core'"), the disk quota was exceeded, and I did not install.
- The compile of the D6 type test is the plan's own open item (plan.md:38). I did not check it.

## Notes
- **N1 · plausible · stage 01 · missing edge case and test.** Forged data with a prototype key in the code position is not tested, for example `` `fr:constructor:${ID}` ``, `` `vr:__proto__:${ID}` `` and `` `rw:toString:${ID}` ``.
  - `CODE_TO_CATEGORY` and `CODE_TO_REASON` are plain objects built by `Object.fromEntries` (callback.ts:131-133, 153-156). Today only the regex character class keeps data out of them (callback.ts:137, 151).
  - D3 (plan.md:13) asks for an anchored check of the rest, and the rule "never index a plain object with data" also covers these maps. But test 4 (stage-01:34) and the break check (stage-01:40) cover only the prefix position.
  - A worker who does `rest.split(":")` and then a map lookup passes every listed test, and returns `category: Object` for `fr:constructor:<id>`.
  - Fix: add these three rows to test 4. Add a break check that swaps the anchored code pattern for split plus lookup.
- **N2 · proven by reading · stage 01 · test that cannot fail.** Test 8 (stage-01:38) says it "proves step 2 changed nothing". Step 2 (stage-01:24) turns the old predicates into one-line wrappers over `isCallbackOfFamily`, so test 8 compares a function with itself. That breaks the styleguide rule against "a case that passes when its code breaks".
  - The real proof is the existing asserts that stay unchanged: callback.test.ts:125-126 and 167-168, and callback-loop.test.ts:84-157. Test 6 (the family column) adds to that.
  - Fix: drop test 8, or assert fixed booleans that follow the old definition (callback.ts:105-111).
- **N3 · proven by reading · stage 02 · break check breaks the fixture.** The break check at stage-02:42 swaps `loop` and `delegate` in the test's own recording record. That edits test code, not product code, so it says nothing about `dispatchCallback`.
  - Fix: break the product. Make `dispatchCallback` use a fixed family, or change the `family` of one kind in `callbackKinds`, and see test 1 fail.
- **N4 · gap · ticket acceptance 3 has no proof step.** Acceptance 3 is "A kind with no family, prefix or codec, and a family with no handler, fail `bun run typecheck`" (ticket.md:29). Stage 02 states it only as a Done-when (stage-02:26), and no step tells the worker to show it and report it.
  - The typed golden table (stage-01:29) proves only that a missing golden row fails typecheck.
  - Fix: add a type-level test with `// @ts-expect-error` on a handler record that lacks one family. Add a reported break: a new kind in `Callback` with no `callbackKinds` entry, then typecheck, then restore.
- **N5 · worker must guess · stage 01.** The golden table is a record keyed by kind (stage-01:29), so it cannot hold the "extra row with `afterId: ID`" for `reply_review` (stage-01:31). The plan should say where that row goes, for example a separate case.
- **N6 · worker must guess · stage 02.**
  - Test 2 reads `callbackHandlers` (stage-02:40). Step 2 declares it as a plain `const` and says it stays in the module (stage-02:21, 24). The plan should say "export it from `callbacks.ts`, not from `channels/index.ts`".
  - Test 2 repeats what the mapped type already enforces.
- **N7 · fact with no source · questions.md:1 and D12 (plan.md:22).** The lab also builds `ag:` by hand (`apps/server/src/modules/lab/executive.ts:270`), not only `ar:` and `rw:`. D2 keeps it valid, but the list in the owner question is incomplete.
- **N8 · gap · D15 docs.**
  - `docs/capabilities/digest-and-notices.md:140` lists `pickerMessage` under `callbacks.ts`, but D11 moves it to `feedback-taps.ts`. Stage-02:32 updates only rule 10 and the Telegram rows.
  - `docs/capabilities/open-loops.md:20` names `callback.ts` as the home of the prefixes. That goes stale if `callback-kinds.ts` is created (D14).
- **N9 · rule that needs a guess · stage-01:19.** The Done-when says "each prefix string appears once in core product code". Core product code already has more copies:
  - `sim/live/executive.ts:69-91` holds `"ap"`, `"ar"`, `"as"`, `"ag"` and `` `rw:` ``. The stage exempts these.
  - The comment at `loops/brief.ts:281` holds `dd:`. Nothing says whether comments count.
  - planner.md § Plan size allows a grep Done-when only as a must-find-nothing check, and this one is not.
- **N10 · low · stage-02:44.** The integration list leaves out `channels-reply-redraft-repair.test.ts` (scouts.md:133). `check:job` still runs it, because it imports the app.

## Decisions checked against the plan-base code (held)
- **D5 family members:** match callback.ts:19-74 (33 kinds; 33 prefixes, counted).
- **D3:** today's regexes are anchored and have no `m` flag, so `ap:<id>\n` gives `null` (callback.ts:135-151).
- **D8 error texts:** match callback.ts:238 and 243.
- **D9 adapters:** match the handler signatures at answered-taps.ts:20, reply-taps.ts:52, loop-taps.ts:20, delegate-taps.ts:31 (no `tapSource`) and approval-taps.ts:94.
- **D6:** the local `ApprovalCallback` is at approval-taps.ts:62-65.
- **plan.md:33 caller list:** confirmed. Product code calls the predicates only in `callbacks.ts`. The only test callers are `digest.test.ts`, `callback.test.ts` and `callback-loop.test.ts`.
- **`pickerMessage`:** exported only through `channels/index.ts:84`, with no importer outside the module.

## Checks run
- `git rev-parse HEAD && git merge-base HEAD master` printed 2973af4c59d1c020c3568d139a922c056e85364d and e8f6f2b1b47bd1ccf7569187d1f7746a61cdca49.
- `rg` for the predicate callers and for hand-built prefixes: results as quoted above.
- `wc -w`: plan 1,208, stage 01 696, stage 02 699, ticket 325.
- The `bun test` import probe failed: no `node_modules` (`Cannot find module '@ea/core'`). Not rerun.

As a review job I ran no suite, lint or typecheck.

## Note check
- **HEAD equals the candidate 2973af4c59d1c020c3568d139a922c056e85364d:** proven. `git rev-parse HEAD && git merge-base HEAD master` exited 0 and printed that sha.
- **Each plan decision is checked against the plan-base code:** not proven by a file or a single && command. The evidence is the read and `rg` calls of this session, quoted file:line in the "Decisions checked" list above. These were reads joined with `;`, and there is no saved log.
- **The final message lists gaps, conflicts, guess steps, unsourced facts, oversize stages and the pre-mortem stage:** not proven as a file. This message holds them: N1–N10, "decisions do not conflict", the `wc -w` counts and the pre-mortem paragraph.
- **Easy-to-miss rule ("Missing code detail … is not a finding; a missing decision, edge case, test or interface is"):** followed. Each of N1–N10 names a missing edge case, test, interface, decision or fact. None of them asks for line numbers or edit text.
- **Reminder "tests run once per job; run only single files with `bun test <file>`":** followed. I ran one single-file probe outside the repo, and it failed on the missing `node_modules`. I ran no suite.
- **Reminder "a job that commits product code runs `bun run check:job`":** not applicable. This review job made no commit, and `git status --short` was empty.
- **Reminder "a review job runs no test suite, lint or typecheck":** followed. I ran none.
- **Reminder "never delete `node_modules/.cache/`":** followed. The worktree has no `node_modules`, and I deleted nothing in it.
