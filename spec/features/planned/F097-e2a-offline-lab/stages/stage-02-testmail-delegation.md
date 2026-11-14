# F097 stage 02 — `delegation` in testmail batches (F065)

Part of [`../plan.md`](../plan.md).

After this stage a testmail batch can expect `delegation` when it says that delegates are active, the blind label may be `delegation`, and `testmail:remote compare` scores a right `delegation` result as `ok` instead of `WRONG` (D2). Source: `spec/features/dropped/2026-11/F065-testmail-delegation-label/plan.md`.

## Step 1 — Batch schema and validation

**Goal.** `delegation` is a legal expected and blind category only in a batch with `delegatesActive: true` (D2).

**Files.** `packages/core/src/testmail/batch.ts`, `batch.test.ts`, `blind.ts`, `blind.test.ts`, `packages/core/src/testmail/index.ts` if an export changes.

**Interfaces.**

```ts
export const testmailCategories = ["urgent", "needs_reply", "info", "notification", "spam"] as const; // unchanged
export const batchCategories = [...testmailCategories, "delegation"] as const;
export type BatchCategory = (typeof batchCategories)[number];

// batchSchema gains: delegatesActive: z.boolean().default(false)
// batchCaseSchema: expected.category and blind.category use z.enum(batchCategories)
// BatchIssueCode gains "delegation_without_delegates"
// blindLabelsSchema: category uses z.enum(batchCategories)
```

`validateBatch` adds the issue `delegation_without_delegates` (detail `expected: delegation needs delegatesActive` or `blind: …`) for a case whose expected or blind category is `delegation` while `batch.delegatesActive` is `false`. The `.strict()` objects stay strict; the old batch files in `evals/testmail/batches/` parse unchanged (default `false`).

**Decisions.** D2.

**Test** (unit, `batch.test.ts` and `blind.test.ts`):

1. Each file in `evals/testmail/batches/` parses with `batchSchema` and gets `delegatesActive: false`.
2. A batch with `delegatesActive: false` and one case `expected.category: "delegation"` → exactly one issue `delegation_without_delegates`.
3. The same batch with `delegatesActive: true` → no issue of that code.
4. A blind label `delegation` in a batch with `delegatesActive: false` → issue `delegation_without_delegates` (when `requireBlind`).
5. `blindLabelsSchema` accepts `{ id: "a", category: "delegation" }`.

**Check.** `bun test packages/core/src/testmail/`

**Done when.** Cases 1–5 pass.

**Out of scope.** The persona file, the AgentMail sender.

## Step 2 — Target input and `compare`

**Goal.** `compare` scores `delegation` (D2).

**Files.** `packages/core/src/testmail/target.ts`, `target.test.ts`, `apps/server/src/scripts/testmail.ts` (the `validate` category count loop uses `batchCategories`), `evals/testmail/README.md` (§ 2 "Limits": replace the two lines "AgentMail mail is not "synthetic" …" and "A triage result `delegation` … counts as `WRONG`" by: "`TEST_SENDER_ADDRESSES` on the VPS marks AgentMail mail as test mail (F097 stage 01)." and "Set `delegatesActive: true` in a batch when delegates are active on the VPS; then `delegation` is a legal expected category and `compare` scores it. `unsure` still counts as `WRONG`."; and the checker instruction section: the checker may answer `delegation` only for a batch with `delegatesActive: true`).

**Interfaces.** `targetInputSchema` `expected: z.enum(batchCategories)`; `buildCompareRows` is unchanged in logic (`ok: result.category === c.expected`), its types widen.

**Decisions.** D2.

**Test.**

1. `buildTargetInput` of a batch with one `delegation` case → the target case has `expected: "delegation"` and parses with `targetInputSchema`.
2. `buildCompareRows` with that case and a result row `category: "delegation"` → `ok: true`; with `category: "needs_reply"` → `ok: false`.
3. `renderCompareTable` prints `ok` for case 2's first row.

**Check.** `bun test packages/core/src/testmail/ apps/server/src/modules/testmail/`

**Done when.** Cases 1–3 pass; the README lines are replaced.

**Out of scope.** The checker agent file outside the repo (`~/.pi/agent/agents/testmail-checker.md`): name the needed one-line change in the final message.
