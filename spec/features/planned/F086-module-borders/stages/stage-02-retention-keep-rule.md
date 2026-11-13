# F086 stage 02 — Retention keep rule from the composition root; `actions` stops importing `delegation` [risky]

Part of [`../plan.md`](../plan.md). Decisions: D4, D14. One `[risky]` step: data integrity. If the keep rule is lost, the daily retention job clears the applied draft payload of an open delegation, and the chaser can no longer read the language and the due date for its reminders.

## Step 1 — Invert the "open delegation" read

**Goal.** `actions/repo.ts` no longer imports `../delegation/repo`. `clearActionPayloads` gets a required keep rule from its caller; `retention.ts` (a composition root) passes the rule that `delegation` exports. The SQL that runs is the same as today.

**Files.**

- `apps/server/src/modules/actions/repo.ts`: line 14 (the import), the new type `PayloadKeepRule`, `clearActionPayloads` (line 1691) and its comment.
- `apps/server/src/modules/actions/index.ts`: export the type.
- `apps/server/src/modules/delegation/repo.ts`: the new function `isOpenDelegationDraft` beside `openDelegationFilter` (line 16).
- `apps/server/src/modules/delegation/index.ts`: export it.
- `apps/server/src/retention.ts`: line 84 passes the rule.
- `apps/server/test/integration/retention-clear.test.ts`: the 5 calls of `clearActionPayloads` and one new test.
- `apps/server/test/integration/retention-job.test.ts`: one new test.
- `docs/modules.md` §2: two prose lines (below).

**Interfaces.**

`actions/repo.ts`, directly above `clearActionPayloads`:

```ts
// A row that matches the rule keeps its payload. The composition root passes it (`retention.ts`), so `actions`
// does not need to know when another module still reads a payload (the hooks pattern, read side).
export type PayloadKeepRule = (eb: ExpressionBuilder<DB, "actions">, ctx: TenantContext) => Expression<SqlBool>;
```

`clearActionPayloads(db, ctx, opts: { before: Date; batch?: number; keep: PayloadKeepRule })`. In its inner `selectFrom("actions")`, the whole `.where((eb) => eb.not(eb.exists(eb.selectFrom("delegations")…)))` block (lines 1720–1732 today) becomes:

```ts
          .where((eb) => eb.not(opts.keep(eb, ctx)))
```

All other lines of the function stay. Update its comment (lines 1689–1690; the sentence spans the line break): replace "The applied draft of an open delegation keeps its payload: the chaser reads the language and the due date from it." with "A row that matches `opts.keep` keeps its payload (`retention.ts` passes the open-delegation rule of `delegation`)." In the same comment, line 1685 starts with `// Retention (A23):`; make it `// Retention (docs/architecture.md §7):`. Leave line 1681 (`PAYLOAD_TYPES`) as it is. The new `PayloadKeepRule` comment above has no code.

`actions/index.ts`: add `PayloadKeepRule,` to the `export type { … } from "./repo"` list (alphabetical place: after `PlannedActionInput`).

`delegation/repo.ts`, directly below `openDelegationFilter`:

```ts
// The keep rule of the actions retention clear: the row is the applied draft of an open delegation, and the
// chaser still reads the language and the due date from its payload. `retention.ts` passes it.
export const isOpenDelegationDraft: PayloadKeepRule = (eb, ctx) =>
  eb.exists(
    eb
      .selectFrom("delegations")
      .select("delegations.id")
      .whereRef("delegations.draft_action_id", "=", "actions.id")
      .where("delegations.org_id", "=", ctx.orgId)
      .where(openDelegationFilter)
  );
```

with `import type { PayloadKeepRule } from "../actions";` in the parent-import group (`delegation → actions` is a permitted edge, D1). The subquery is the one that `actions/repo.ts` has today; do not change it.

`delegation/index.ts`: add `isOpenDelegationDraft,` to the `export { … } from "./repo"` list (alphabetical place: after `insertDelegation`).

`retention.ts`: `import { clearDelegationTasks, isOpenDelegationDraft } from "./modules/delegation";` and line 84 becomes
`const payloads = await clearers.clearActionPayloads(db, ctx, { before: textsBefore, keep: isOpenDelegationDraft });`. `Clearers.clearActionPayloads` stays `typeof clearActionPayloads`.

`docs/modules.md` §2:
- In the line that starts with `**Composition file \`retention.ts\` (S6a):**`, add after the first sentence: "It passes `isOpenDelegationDraft` of `delegation` as the keep rule of `clearActionPayloads`, so `actions` never imports `delegation`."
- In the "Hooks pattern" line, keep "There is no `actions → delegation` edge." (it is true again after this stage).

**Decisions.** D4, D14. The rule is required (no default, no `null`): typecheck stops a caller that forgets it. Do not export `openDelegationFilter` from the `delegation` index: nothing outside `delegation` needs it after this stage.

**Test.** Integration tests; each runs in a rolled-back transaction (`withRollback`).

1. `retention-clear.test.ts`: every existing `clearActionPayloads(trx, a.ctx, { before: before90 })` call becomes `clearActionPayloads(trx, a.ctx, { before: before90, keep: isOpenDelegationDraft })`, with `isOpenDelegationDraft` imported from `../../src/modules/delegation` (add it to the existing import on line 8). The expected counts stay: 4 and 0 (first test), 2 and 0 (applying rows), and the F083 test keeps `sent` and `overdue` with 1 reminder, clears `overdue` with 2 reminders, `done`, `answered`.
2. New test in `describe("clearActionPayloads: applying rows and open delegations (F083)")`: "a keep rule that matches no row clears the applied draft of an open delegation". Seed one `sent` delegation with `remindersSent: 0` exactly as `draftOf("sent", 0)` does in the test above it (draft `createdAt: over90`, `dueDate: "2027-03-01"`, `language: "pl"`). Call `clearActionPayloads(trx, a.ctx, { before: before90, keep: (eb) => eb.lit(false) })`. Expect the return value `1` and the draft payload `{}`. This proves that the rule decides, not a hidden filter.
3. New test in `retention-job.test.ts`, `describe("retention job: runOrg")`: "keeps the applied draft payload of an open delegation; clears the one of a closed delegation". `const a = await newOrg(trx, 30); const ctx = { orgId: a.orgId };` Two delegations, each with its own `insertDelegate(trx, ctx)` and `insertDraftAndSend(trx, ctx, a.mailboxId, { delegateId, createdAt: over90, dueDate: "2027-03-01", language: "pl" })` and `insertDelegation(trx, ctx, { mailboxId: a.mailboxId, emailId, delegateId, draftActionId: draftId, sendActionId: sendId, status, remindersSent: 0 })`: one with `status: "sent"`, one with `status: "done"`. Run `createRetentionJob({ db: trx, now: () => NOW }).runOrg({ id: a.orgId, dataRetentionDays: 30 }, NOW)`. Expect the `sent` draft payload `toMatchObject({ due_date: "2027-03-01", language: "pl" })` and the `done` draft payload `{}`. This proves the wiring in `retention.ts`.
4. `bun test apps/server/test/integration/retention-clear.test.ts apps/server/test/integration/retention-job.test.ts` passes (needs the job DB that the prepare script made).

**Check.**

```
grep -n '"delegations\|openDelegationFilter\|delegation/repo' apps/server/src/modules/actions/repo.ts
grep -rn 'from "../delegation' apps/server/src/modules/actions/
mkdir -p /tmp/f086-s02
bunx madge@8.0.0 --circular --extensions ts --ts-config apps/server/tsconfig.json apps/server/src > /tmp/f086-s02/madge.log 2>&1
awk '/^[0-9]+\)/ { line = $0; n = 0; split("", seen); while (match(line, /modules\/[a-z]+\//)) { m = substr(line, RSTART, RLENGTH); if (!(m in seen)) { seen[m] = 1; n++ } line = substr(line, RSTART + RLENGTH) } if (n > 1) print }' /tmp/f086-s02/madge.log | wc -l
git status --short bun.lock
```

- Both greps print nothing: `actions/repo.ts` names neither the `delegations` table nor `openDelegationFilter`, and no `actions` file imports `delegation`. (Other lines of `actions/repo.ts` say "delegation" in comments and in `setDelegationId`; they stay.)
- The awk count is `0`; madge lists 9 cycles, all inside one module.

**Done when.**

- Tests 1–4 pass; the checks above hold.
- The final message quotes the grep output and the madge cross count.
- The Proof of `plan.md` ends with `PROOF_OK` (`NN` = `02`).
- A review job checks the stage before the land (plan § Review).

**Out of scope.** The lint (stage 03). `clearDelegationTasks` (it stays inside `delegation` and keeps using `openDelegationFilter`). Other comments of `actions/repo.ts`.
