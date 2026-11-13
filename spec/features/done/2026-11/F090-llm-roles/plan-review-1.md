FAIL f46f7098ea4b15330d4720081d4c1c2268957f53

The plan has two blocking problems, both in stage 3. Its list of callers and fakes is incomplete, and its own rules make one triage test fail. I proved both in a scratch copy at /tmp/f090-review/repo, outside the repository. In that copy, stages 1 and 2 work as written: all 211 old unit tests of `platform/llm` and triage pass unchanged. The classifier request does not change.

HEAD is f46f7098, the same as the candidate. The worktree is clean. I made no commit. Logs are in /tmp/f090-review/logs/.

## Blocking findings

**B1. Proven: stage 3 misses one fake LLM client, `tools/fake-telegram/test/setup.ts:123-133`.**
- This file holds `urgentLlm()`, a fake with `classifierModel` and `classify(req)`.
- Stage 3 does not list it:
  - `stages/stage-03-callers.md:144` says "`tsc` lists exactly these".
  - P3 makes the same claim (`plan.md:96`).
  - The grep check at `stage-03-callers.md:162` searches only `apps/server/src` and `apps/server/test`.
- How I proved it: in the scratch copy I applied stages 1–2, then changed only the types to the stage 3 shape (`LlmClient = {modelOf, generate}`, `LlmUsage` with role and promptVersion). Then I ran `bun run typecheck`. Its log, `/tmp/f090-review/logs/stage3-typecheck.log`, has 2 errors in `@ea/fake-telegram typecheck: test/setup.ts`, beside the files that stage 3 lists.
- `bun run test:int` also runs `tools/fake-telegram/test`, so the e2e triage there would break at runtime too.
- A worker that obeys "only the files of this stage" (`stage-03-callers.md:170`) and "a gap is a question" (`plan.md:132`) must stop at the stage 3 proof.
- P3 is also wrong in the other direction. `tsc` does not report `actions-send.test.ts` (it casts `as unknown as LlmClient`, at line 945). The plan lists that file anyway, which is correct, but the claim "tsc lists exactly these" is false.
- Fix: add `tools/fake-telegram/test/setup.ts` to step 4 of stage 3. Add `tools/` to the grep at line 162.

**B2. Proven: the stage 3 fake rule breaks an assertion that stage 3 says must stay.**
- `stage-03-callers.md:150` tells the worker to type the `classifier.test.ts:10` constant as `Omit<LlmUsage,"role"|"promptVersion">` and to return `{ ...usage, role, promptVersion }`.
- `classifier.test.ts:185` asserts `expect(result.usage).toEqual(usage)`, and `classifyEmail` passes the usage through unchanged. With the extra keys, that assertion fails.
- How I proved it: I applied exactly this port in the scratch copy. `/tmp/f090-review/logs/stage3-classifier-test.log` shows 20 pass, 1 fail: "returns the analysis, the usage and promptVersion classifier-v2", at line 185.
- This conflicts with three rules:
  - `stage-03-callers.md:7`: "If an assertion must change to pass, stop".
  - `stage-03-callers.md:171`: no `expect(` change in the triage tests.
  - D17 (`plan.md:69`): the only intended assertion change is the `role` key in `triage-service.test.ts`.
- The worker therefore stops at stage 3.
- Fix: name this second intended change in D17 and Q3 (expect `{ ...usage, role: "classifier", promptVersion: "classifier-v2" }`), or have the fake return the constant unchanged.

## Unverified checks

- **Stage 2 integration tests** (`bun run test:int`): not run, because this job has no DB (no `DATABASE_URL`). Only `triage-logs.test.ts:92` uses the wrapper; the other integration fakes do not touch the client. Through the wrapper the client log line changes to `ok role=classifier model=…`. `triage-logs.test.ts` checks only the `[llm]` prefix and that no marker appears, so it should pass, but I did not run it.
- **Stage 3 full port, and stages 4–5 code:** not applied. I reviewed them only by reading the code.

## Notes

- **N1. Proven: the plan's status contradicts itself.**
  - `plan.md:3` says "cold review 1 done".
  - `plan.md:16` says "[x] Cold review (`plan-review-1.md`), findings handled".
  - `plan.md:208-210` says "## Cold review / Not run yet."
  - No `plan-review-1.md` exists in the folder. The coordinator should fix this when it files this review.
- **N2. Plausible: missing variable in a stage 4 test step.** Stage 4 step 2, test 3 (`stage-04-audit-and-registry.md:90`) says "add `expect(calls[0]?.data)…`" to "a safety block goes to unsure at once" (`triage-service.test.ts:444-470`). That case has no `calls` variable. The worker must add `const calls = await llmRows(trx, emailId);`. This is easy to infer, but the plan should say it.
- **N3. Plausible: an event that no rule covers (D10, `plan.md:62`; D11).**
  - Case: `LLM_<ROLE>_MODEL` is set without `LLM_<ROLE>_PROVIDER`, and the owner later switches `LLM_PROVIDER` (the switch of ADR 0015).
  - Effect: the role sends a model id of the old provider to the new provider.
  - Nothing refuses this at start, although D10's own reason ("a model id of one provider is not valid on the other one") applies.
  - No role uses the table yet, so nothing breaks today. Option: a start check that refuses `_MODEL` without `_PROVIDER`.
- **N4. Plausible: shared files with F087 that the gates do not cover.** The F090 gate (`ticket.md:39`) covers `platform/config.ts`, `.env.example` and `packages/core/src/index.ts` (F087 stages 1 and 4). These overlaps have no gate:
  - F087 stage 2 and F090 stage 3 both edit `main.ts`, in different regions.
  - F087 stage 3 (`auditEvents`) and F090 stage 4 (`recordLlmCall`, `countLlmCallsSince`) both edit `modules/audit/repo.ts`.
  - F087 stage 6 adds bullets "at the end" of `docs/code-patterns.md` § Side effects. F090 stage 6 inserts after "The LLM returns data…", which is the last bullet of that section today (`docs/code-patterns.md:60`). That is the same insertion point. Both stages also edit styleguide § Prefer.

  This is safe when the stages run in sequence; it can give merge conflicts when they run in parallel. Evidence: `/tmp/f090-review/logs/collision-grep.log`.
- **N5. F086 and F089, low risk.**
  - F086: no collision found. The new files follow the F086 zones (platform imports no module; scripts import `modules/triage` through `index.ts`; `testing.ts` is used only by tests, which the lint ignores).
  - F089: the gate names "F089 stage 1" and "the F089 stage that converts `platform/` log calls". F089 has only a plan input with three rough stages, and no `stages/` folder yet. Its numbering can change when `plan-task` runs.
- **N6. Plausible: acceptance 4 is partial for `--real`.** Acceptance 4 says `bun run eval` records the role and the prompt version. Stage 5 adds only `role` to the `--real` report; only the cases report has a prompt version (`eval-report.ts:32`). D24 accepts this, but the ticket does not say so.
- **N7. Not a break: the classifier request stays the same.** I compared the old `client.ts:90-145` with the stage 2 code (`/tmp/f090-review/logs/stage2-client.diff`):
  - same `model`, `system`, `prompt`, `z.toJSONSchema(schema)`, `AbortSignal.timeout` and `withTimeout` with the same `timeoutMs`;
  - same effort, rpm and limiter order, and `started` is set after the limiter wait;
  - same `parseOutput` and `classifyError`.

  One difference: the SDK client is now built at the first call, inside `try`, not at start. D13 notes this. `main.ts` builds the client only when the triage scope is on, and then the config check requires the key.
- **N8. Stage size.** Stage 3 touches about 18 files, about 19 with `setup.ts`. Most changes are mechanical, so one job is still fine.

## Checks I ran

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` in `/tmp/f090-review/repo` (copy of HEAD made with `git archive`) | OK |
| Baseline unit tests of `platform/llm` and triage | 211 pass |
| Baseline `bun run typecheck` | exit 0 |
| Stage 1 code as written, `tsc` | clean |
| My version of the 9 stage 1 cases plus `config.test.ts` | 88 pass |
| Stage 2 code as written, `tsc` | clean |
| Old unit tests of `platform/llm` and triage through the wrapper, plus my 4 probe cases of stage 2 (cases 3, 5, 7, 9), no edit to old tests | 215 pass, 0 fail; `/tmp/f090-review/logs/stage2-old-tests.log` |
| Type-level stage 3 rename, then `bun run typecheck` | `/tmp/f090-review/logs/stage3-typecheck.log` |
| Stage 3 classifier port | `/tmp/f090-review/logs/stage3-classifier-test.log` (1 fail) |
| Worktree state | `/tmp/f090-review/logs/worktree-status.log` (0 lines), `/tmp/f090-review/logs/worktree-head.log` (f46f7098) |

## Owner decision

To fix B1 and B2, the stage 3 file and D17/Q3 need an edit before stage 3 is spawned.

## Note check

- Classifier request is checked against the current code: proven. `/tmp/f090-review/logs/stage2-client.diff`, compared with the old `client.ts:90-145`. The request fields, timeout, effort and rate are the same.
- The stage 2 wrapper keeps every old test unchanged and green: proven for the unit tests, not proven for the integration tests.
  - Unit: `/tmp/f090-review/logs/stage2-old-tests.log` shows 215 pass, 0 fail, with no edit to any old test. That is the 211 old tests plus my 4 probe cases.
  - Integration: `test:int` did not run, because this job has no DB.
- The stage 3 list of callers and fakes is checked against the code: proven, and the list is incomplete.
  - `/tmp/f090-review/logs/stage3-typecheck.log` has the errors in `tools/fake-telegram/test/setup.ts` (B1).
  - `/tmp/f090-review/logs/stage3-classifier-test.log` has the failure at line 185 (B2).
- Collision with the F086 and F087 plans is checked: proven. `/tmp/f090-review/logs/collision-grep.log` lists the shared files; the findings are N4 and N5.
- Easy-to-miss rule, "apply stage code only in a scratch copy; do not commit": followed.
  - `/tmp/f090-review/logs/worktree-status.log` is empty.
  - `/tmp/f090-review/logs/worktree-head.log` holds f46f7098ea4b15330d4720081d4c1c2268957f53.
  - All stage code was applied only in /tmp/f090-review/repo.
