# F091 stage 03 — Handler table and the action-type completeness test

Part of [`../plan.md`](../plan.md). Decisions: D3, D4, D13, D14, D15, D17. Needs stage 01 landed. Three steps. Behaviour stays the same: the same handler runs for each row, and the committer opens IMAP, SMTP, the facts and the sort folders for exactly the same batches as before.

## Step 1 — `apply-shared.ts`; `drafts.ts` and `send.ts` stop importing `apply.ts`

**Goal.** The types and the transaction helper that `apply.ts`, `drafts.ts` and `send.ts` share live in a file that imports none of them. The cycles `apply ↔ drafts` and `apply ↔ send` end.

**Files.** New: `apps/server/src/modules/actions/apply-shared.ts`. Changed: `apply.ts`, `drafts.ts`, `send.ts`.

**Interfaces.**

`apply-shared.ts`, in this order:

1. A header comment: `// The types and the helper that apply.ts, drafts.ts and send.ts share. It imports none of them, so there is no import cycle.`
2. Moved whole (cut from `apply.ts`, text unchanged, comments included): `ApplyOutcome`, `ResolvableFolderKey` (with its comment line), `FolderResolver`, `ApplyDeps`.
3. One `inTransaction`, exported, replacing the three equal copies (`apply.ts` `async function inTransaction`, `drafts.ts` and `send.ts` `function inTransaction`):

   ```ts
   // Runs `run` in the caller's transaction, or in a new one.
   export function inTransaction<T>(db: ApplyDeps["db"], run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
     return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
   }
   ```

4. The handler types (step 2 uses them):

   ```ts
   /** What the committer opens or loads for a batch that holds a row of this type. */
   export interface ApplyNeeds {
     /** An IMAP connection. Without one the row goes back to its status for a later try. */
     provider: boolean;
     /** An SMTP sender, for a row in `approved` only: the recovery of an `applying` send needs none. */
     sender: boolean;
     /** The owner name, the style text and the time zone (`ApplyDeps.owner`, `ApplyDeps.organization`). */
     facts: boolean;
     /** The paths of the `sort` folders (`ApplyDeps.appendFolders`): a move into one is an APPEND transfer. */
     sortFolders: boolean;
   }

   type ApplyRun<P extends unknown[]> = (
     deps: ApplyDeps,
     ctx: TenantContext,
     action: ClaimedAction,
     ...rest: P
   ) => Promise<ApplyOutcome>;

   export type ApplyHandler =
     | { needs: ApplyNeeds & { provider: false }; run: ApplyRun<[]> }
     | { needs: ApplyNeeds & { provider: true }; run: ApplyRun<[provider: MailProvider]> };

   export type ImapHandler = Extract<ApplyHandler, { needs: { provider: true } }>;

   // TypeScript does not narrow a union on a nested field (`needs.provider`); this guard does.
   export const needsImap = (handler: ApplyHandler): handler is ImapHandler => handler.needs.provider;
   ```

   Imports: `MoveTarget`, `OutgoingMessage` (types) from `@ea/core`; `Transaction` (type) from `kysely`; `DB`, `Db`, `TenantContext` (types) from `../../platform/db`; `MailProvider`, `MailSender` (types) from `../mail`; `DelegationHooks` (type) from `./hooks`; `ClaimedAction` (type) from `./repo`. Every import is `import type`.

`apply.ts`:

- Remove the moved types, the local `inTransaction`, and the imports only they used (`OutgoingMessage`, `Db`, `MailSender`, `DelegationHooks`).
- Add `import { inTransaction, needsImap, type ApplyDeps, type ApplyHandler, type ApplyOutcome } from "./apply-shared";`.
- Directly after `export { HARD_ERROR_TRIES, RETRY_WAIT_MS };` add `export type { ApplyDeps, ApplyOutcome, FolderResolver, ResolvableFolderKey } from "./apply-shared";` so `actions/index.ts` and `committer.ts` keep their imports from `./apply`.

`drafts.ts`, `send.ts`: delete the local `inTransaction`; replace `import type { ApplyDeps, ApplyOutcome } from "./apply";` with `import { inTransaction, type ApplyDeps, type ApplyOutcome } from "./apply-shared";`. Remove the imports that become unused (`Transaction` from `kysely` and `DB` from `../../platform/db` if `eslint` reports them unused; the probe found both unused in both files).

**Decisions.** D3 (the shared file ends the cycles), D14 (one `inTransaction`).

**Test.** No new test in this step; step 3 adds them. `apps/server/test/integration/actions-*.test.ts` run unchanged in the proof.

**Check.**

1. `grep -n 'from "./apply"' apps/server/src/modules/actions/drafts.ts apps/server/src/modules/actions/send.ts` prints nothing.
2. `grep -c "function inTransaction" apps/server/src/modules/actions/*.ts | grep -v ":0"` prints only `apps/server/src/modules/actions/apply-shared.ts:1`.
3. `bun run typecheck` passes.

**Done when.** Checks 1–3 hold.

**Out of scope.** Splitting `send.ts` (516 lines, D20). The other `inTransaction`-like helpers in other modules.

## Step 2 — `APPLY_HANDLERS` drives `applyAction` and the committer

**Goal.** One record names, per action type, its handler and what it needs. `applyAction` dispatches through it, and the committer reads `needs` instead of checking `action.type`.

**Files.** `apps/server/src/modules/actions/apply.ts`, `apps/server/src/modules/actions/committer.ts`.

**Interfaces.**

`apply.ts`, directly above the comment `// Applies one claimed action and writes …` of `applyAction`:

```ts
const NEEDS_NOTHING = { provider: false, sender: false, facts: false, sortFolders: false } as const;
const NEEDS_IMAP = { provider: true, sender: false, facts: false, sortFolders: false } as const;

// One handler per action type. A new type fails typecheck here and completeness.test.ts until it has one.
export const APPLY_HANDLERS: Readonly<Record<ActionType, ApplyHandler>> = {
  move: { needs: { ...NEEDS_IMAP, sortFolders: true }, run: applyMove },
  mark_read: { needs: NEEDS_IMAP, run: applyFlag },
  flag: { needs: NEEDS_IMAP, run: applyFlag },
  save_summary: { needs: NEEDS_NOTHING, run: applySummary },
  // A reverse `create_draft` row deletes the draft (the send of the draft ended).
  create_draft: {
    needs: { ...NEEDS_IMAP, facts: true },
    run: (deps, ctx, action, provider) =>
      action.reverses_action_id === null
        ? applyDraft(deps, ctx, action, provider)
        : removeDraft(deps, ctx, action, provider),
  },
  send: { needs: { ...NEEDS_IMAP, sender: true, facts: true }, run: applySend },
};
```

Add `type ActionType` to the `@ea/core` import. The body of `applyAction` becomes (the release block is the existing one, unchanged):

```ts
  const handler = APPLY_HANDLERS[action.type];
  if (!needsImap(handler)) return handler.run(deps, ctx, action);
  if (provider === null) {
    // … the existing block: log.error, releaseAction, return { kind: "retry", soft: true } …
  }
  return handler.run(deps, ctx, action, provider);
```

This keeps today's order: `save_summary` runs without a provider check; every other type with no provider is released for a soft retry; then the handler runs.

`committer.ts`:

- Import `APPLY_HANDLERS` and `type ApplyNeeds` (`ApplyNeeds` from `./apply-shared`, or re-export it from `./apply`; pick one and say which in the final message).
- Replace the arrow `isMailboxChanging` (and its comment line) with:

  ```ts
  // What each row of a batch needs, from the handler table: IMAP, SMTP, the tenant texts, the sort folders.
  const needs = (action: ClaimedAction): ApplyNeeds => APPLY_HANDLERS[action.type].needs;
  ```

- The four checks in `processMailbox`, each with its existing comment kept:

  | Today | After |
  | --- | --- |
  | `batch.some((action) => action.type === "move")` | `batch.some((action) => needs(action).sortFolders)` |
  | `batch.some(isMailboxChanging)` | `batch.some((action) => needs(action).provider)` |
  | `batch.some((action) => action.type === "send" && action.status === "approved")` | `batch.some((action) => needs(action).sender && action.status === "approved")` |
  | `batch.some((action) => action.type === "create_draft" \|\| action.type === "send")` | `batch.some((action) => needs(action).facts)` |

- Remove `MAILBOX_ACTION_TYPES` from the `@ea/core` import if nothing else in the file uses it.
- `if (action.type === "send") counts.sent += 1;` in `applyBatch` stays (a log count, not a dispatch).

Equality with today, per type (the test of step 3 pins this table):

| Type | provider (today: mailbox type, draft or send) | sender (today: `send`) | facts (today: draft or send) | sortFolders (today: `move`) |
| --- | --- | --- | --- | --- |
| `move` | true | false | false | true |
| `mark_read`, `flag` | true | false | false | false |
| `save_summary` | false | false | false | false |
| `create_draft` | true | false | true | false |
| `send` | true | true | true | false |

**Decisions.** D3, D13 (four needs, the committer reads them).

**Test.** Step 3 cases 6 and 7. `apps/server/test/integration/actions-committer.test.ts`, `actions-send.test.ts`, `actions-drafts.test.ts`, `actions-move.test.ts` run unchanged in the proof (they cover the connection opening and each handler).

**Check.**

1. `sed -n '/^export async function applyAction/,/^}/p' apps/server/src/modules/actions/apply.ts | grep -c "action.type ==="` prints `0`.
2. `grep -n 'action.type ===' apps/server/src/modules/actions/committer.ts` prints only the `counts.sent` line.
3. `wc -l apps/server/src/modules/actions/apply.ts` prints a number under 400 (about 375).
4. `mkdir -p /tmp/f091-s03 && bunx madge@8.0.0 --circular --extensions ts --ts-config apps/server/tsconfig.json apps/server/src > /tmp/f091-s03/madge.log 2>&1; grep -cE "actions/apply(-shared)?\.ts" /tmp/f091-s03/madge.log` prints `0`; then `git status --short bun.lock` prints nothing.

**Done when.** Checks 1–4 hold and `bun run typecheck` passes.

**Out of scope.** The handler bodies (`applyMove`, `applyFlag`, `applySummary`, `applyDraft`, `removeDraft`, `applySend`): no line inside them changes. The `counts` logic. `send.ts` and `drafts.ts` beyond step 1.

## Step 3 — `completeness.test.ts`

**Goal.** One unit test fails when an action type lacks a handler, a `createPlanned` entry, an edge, a phrase, or a planner member, and pins the needs table.

**Files.** New: `apps/server/src/modules/actions/completeness.test.ts`.

**Interfaces.** Header comment: `// Every action type is complete. The CHECK list of actions.type is compared in apps/server/test/integration/actions-transitions.test.ts.` Imports: `actionTypes`, `describeAction`, `type ActionType`, `type PlannedAction` from `@ea/core`; `describe`, `expect`, `test` from `bun:test`; `APPLY_HANDLERS` from `./apply`; `ACTION_EDGES`, `ACTION_ENTRIES` from `./transitions`.

```ts
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Typecheck fails here when the planner's union and actionTypes differ.
const plannedMatchesTypes: Same<PlannedAction["type"], ActionType> = true;
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
// A summary is stored, not shown as a line.
const NO_PHRASE: readonly ActionType[] = ["save_summary"];
```

**Decisions.** D4, D15 (the CHECK test exists), D17 (the renderer is `describeAction`).

**Test.** `describe("every action type is complete", …)`:

1. "the planner's union is the type list": `expect(plannedMatchesTypes).toBe(true)`.
2. "each type has one apply handler": `sorted(Object.keys(APPLY_HANDLERS))` equals `sorted(actionTypes)` (6 names).
3. "each type has an entry that createPlanned writes": `sorted(ACTION_ENTRIES.filter((e) => e.writer === "createPlanned").flatMap((e) => e.types))` equals `sorted(actionTypes)`.
4. "each type has at least one edge": `sorted(ACTION_EDGES.flatMap((e) => e.types))` equals `sorted(actionTypes)`.
5. "each type has a digest phrase": first read the parameter type of `describeAction` in `packages/core/src/digest/would-do.ts` (F088 may have narrowed it to `WouldDoAction`); pass only the fields of that type. For each type `t`, `describeAction({ id: "a1", type: t, status: "logged", folder: t === "move" ? "ai_info" : null, reverse: false, reversesActionId: null, appliedAt: null, kind: t === "create_draft" || t === "send" ? "delegation" : null, delegateId: null })`. For `t` in `NO_PHRASE` it is `null`; for every other type it is a string that does not contain `"undefined"`. Expected at `37e7239`: `move` → `"would move to AI/Info"`, `mark_read` → `"would mark read"`, `flag` → `"would flag"`, `create_draft` → `"would draft a delegation to a delegate"`, `send` → `"would ask you to send it"`; assert these five strings exactly.
6. "the needs of each type": `Object.fromEntries(actionTypes.map((t) => [t, APPLY_HANDLERS[t].needs]))` equals the table of step 2 (six entries, four fields each).
7. "only send opens SMTP": `actionTypes.filter((t) => APPLY_HANDLERS[t].needs.sender)` equals `["send"]` (the system never sends without an approved send row; `spec/vision.md`).

**Check.**

1. `bun test apps/server/src/modules/actions/completeness.test.ts`: 7 pass.
2. Mutation (revert at once): add `"follow_up"` to the end of `actionTypes` in `packages/core/src/triage/planners.ts`. `bun test apps/server/src/modules/actions/completeness.test.ts` fails cases 2–7 (cases 6 and 7 throw a `TypeError`: the new type has no entry); `bun run typecheck` fails at least in `completeness.test.ts` (the `Same` line) and `apply.ts` (the record), and also in `would-do.ts`, `policy.ts` and `repo/claims.ts` (`TYPE_RANK`). Revert; `git status --short packages` prints nothing.
3. Mutation (revert at once): change `mark_read: { needs: NEEDS_IMAP, …` to `needs: { ...NEEDS_IMAP, facts: true }`. Case 6 fails. Revert; `git status --short apps` shows only this stage's files.

**Done when.** Checks 1–3 hold.

**Out of scope.** An integration test for the CHECK list (D15: it exists). Draft kinds (stage 04).

## Stage done when

- Steps 1–3 are done, with their checks. Commit per step by explicit paths.
- The Proof of `plan.md` (stages 01–04 form, `NN` = `03`) prints `PROOF_OK`, run after the last commit with nothing after it.
