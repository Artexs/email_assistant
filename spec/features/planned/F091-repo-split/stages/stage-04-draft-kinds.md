# F091 stage 04 — One list of draft kinds; templates as a record; an exhaustive payload switch

Part of [`../plan.md`](../plan.md). Decisions: D4, D16, D18. Needs stages 01 and 03 landed, and F088 landed (its files hold two of the lists). Three steps. Behaviour stays the same: the same texts, the same payloads, the same parse results.

## Step 1 — `draftKinds` in core and every non-test list uses it

**Goal.** The three draft kinds are written once. A new kind is added in one list, and typecheck or a test points to every other place.

**Files.** `packages/core/src/triage/payloads.ts`, `packages/core/src/digest/would-do.ts`, `apps/server/src/modules/actions/repo/reads.ts`, and the F088 files that hold a literal list (expected: `packages/core/src/notices/views.ts`, `apps/server/src/modules/channels/notices/send-result.ts`; find them with check 1 before the edit).

**Interfaces.**

`payloads.ts`, directly after `draftLanguageSchema`:

```ts
// The kinds of a draft and of its send: one list for the schemas, the templates and every reader.
export const draftKinds = ["delegation", "clarification", "reminder"] as const;
export type DraftKind = (typeof draftKinds)[number];
```

Core re-exports it through `triage/index.ts` → `src/index.ts` (check that `triage/index.ts` has `export * from "./payloads"`; if it lists names, add the two). Then:

- `sendPayloadSchema`: `kind: z.enum(draftKinds)`.
- `draftPayloadSchema` keeps its three `z.literal(...)` members (a discriminated union needs one literal per member); step 3 compares them with `draftKinds`.
- `would-do.ts` `ActionView.kind`: `DraftKind | null` (import the type from `../triage/payloads`).
- `actions/repo/reads.ts`: `const sendKindSchema = z.enum(draftKinds);` (import `draftKinds` from `@ea/core`). This line is a moved body of stage 01; this stage is allowed to change it.
- F088's `views.ts`: `const draftKind = z.enum(draftKinds);` (import from `../triage/payloads`). F088's `send-result.ts`: `const SEND_KINDS: readonly DraftKind[] = draftKinds;` (or use `draftKinds` at its use site; import from `@ea/core`).
- Any other non-test hit of check 1: the same replacement; name it in the final message.

**Decisions.** D16.

**Test.** Step 3. Existing tests unchanged: `payloads.test.ts`, `approvals.test.ts` (it keeps its own `sendKinds` list), `would-do` tests, `actions-*` integration tests.

**Check.**

1. `grep -rn '"delegation", "clarification", "reminder"\|"delegation" | "clarification" | "reminder"' apps/server/src packages/core/src apps/web/src --include=*.ts | grep -v "\.test\.ts"` prints exactly one line: the `draftKinds` line in `payloads.ts`.
2. `bun run typecheck` passes.

**Done when.** Checks 1–2 hold.

**Out of scope.** `triage/eval.ts` and `triage/eval-case.ts` (their own set with `none`, D16). `actions/hooks.ts` (`"reminder" | "delegation"`, a subset). The per-kind `if` lines in `message.ts`, `sender.ts`, `approvals.ts`, `would-do.ts` `draftPhrase`, `actions/approvals.ts`, `actions/expiry.ts`, `delegation/service.ts`: they stay; the stage 05 checklist names them.

## Step 2 — `DRAFT_TEMPLATES` and an exhaustive `payloadOf`

**Goal.** A missing template or payload case is a typecheck error, not a silent fall-through.

**Files.** `packages/core/src/outgoing/templates.ts`, `apps/server/src/modules/triage/service.ts`.

**Interfaces.**

`templates.ts`: replace the `if` chain with a record. The texts stay byte for byte (copy them from the old branches; `reminder` was the fall-through).

```ts
import type { DraftKind } from "../triage/payloads";

// TemplateFields stays as it is.

type Language = "pl" | "en";
type TemplateText = Required<TemplateFields>;

// One body per draft kind. A new kind fails typecheck here until it has its text.
export const DRAFT_TEMPLATES: Readonly<Record<DraftKind, (pl: boolean, fields: TemplateText) => string>> = {
  delegation: (pl, { task, dueDate, senderLabel, dateLabel, signature }) => {
    const due = /* the existing `due` line of the delegation branch */;
    return /* the existing pl ? … : … of the delegation branch */;
  },
  clarification: (pl, { question, signature }) => /* the existing clarification text */,
  reminder: (pl, { task, dueDate, signature }) => {
    const due = /* the existing `due` line of the reminder branch */;
    return /* the existing reminder text */;
  },
};

export function renderTemplate(kind: DraftKind, language: Language, fields: TemplateFields): string {
  const { task = "", question = "", ...rest } = fields;
  return DRAFT_TEMPLATES[kind](language === "pl", { ...rest, task, question });
}
```

The signature of `renderTemplate` keeps its meaning (`DraftKind` = `DraftPayload["kind"]`); `message.ts` does not change. The probe of the planning job wrote this record and `templates.test.ts` passed unchanged.

`triage/service.ts` `payloadOf`: replace

```ts
    default:
      return {};
```

with

```ts
    case "mark_read":
    case "flag":
      return {};
```

No `default`. A missing type is TS2366 ("Function lacks ending return statement"); the planning job checked it by removing `flag`.

**Decisions.** D4 (record), D18.

**Test.** `packages/core/src/outgoing/templates.test.ts` (6 cases, exact texts) and `apps/server/test/integration/triage-service.test.ts` pass unchanged.

**Check.**

1. `bun test packages/core/src/outgoing` passes.
2. `grep -n "default:" apps/server/src/modules/triage/service.ts` prints no line inside `payloadOf`.
3. `bun run typecheck` passes.

**Done when.** Checks 1–3 hold.

**Out of scope.** The template texts. `decidePolicy` (already exhaustive with `never`).

## Step 3 — `draft-kinds.test.ts`

**Goal.** One core test fails when a draft kind lacks a payload member, a send kind or a template.

**Files.** New: `packages/core/src/triage/draft-kinds.test.ts`.

**Interfaces.** Imports `draftKinds`, `draftPayloadSchema`, `sendPayloadSchema` from `./payloads`; `DRAFT_TEMPLATES` from `../outgoing/templates`; `describe`, `expect`, `test` from `bun:test`. Header comment: `// Every draft kind is complete. A new kind starts in draftKinds (payloads.ts); docs/code-patterns.md has the checklist.`

**Decisions.** D4, D16.

**Test.** `describe("every draft kind is complete", …)` with `const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();`:

1. "the draft payload union has one member per kind": `sorted(draftPayloadSchema.options.map((option) => option.shape.kind.value))` equals `sorted(draftKinds)` (`["clarification", "delegation", "reminder"]`).
2. "the send payload accepts each kind and no other": for each kind, `sendPayloadSchema.safeParse({ kind, to: ["a@example.com"] }).success` is `true`; for `"follow_up"` it is `false`.
3. "each kind has a template": `sorted(Object.keys(DRAFT_TEMPLATES))` equals `sorted(draftKinds)`.
4. "each template fills its fields": for each kind, `DRAFT_TEMPLATES[kind](false, { task: "T1", question: "Q1", dueDate: null, senderLabel: "s@example.com", dateLabel: "Fri 6 Nov", signature: "Sig" })` ends with `"Sig"` and contains `"T1"` (delegation, reminder) or `"Q1"` (clarification).

**Check.**

1. `bun test packages/core/src/triage/draft-kinds.test.ts`: 4 pass.
2. Mutation (revert at once): add `"follow_up"` to `draftKinds`. `bun test packages/core/src/triage/draft-kinds.test.ts` fails cases 1–4 (case 2: `follow_up` parses; case 4: `DRAFT_TEMPLATES[kind]` is not a function); `bun run typecheck` fails in `templates.ts`. Revert; `git status --short packages` shows only this stage's files.

**Done when.** Checks 1–2 hold.

**Out of scope.** Converting the per-kind `if` lines of other files (step 1 § Out of scope).

## Stage done when

- Steps 1–3 are done, with their checks. Commit per step by explicit paths.
- The Proof of `plan.md` (stages 01–04 form, `NN` = `04`) prints `PROOF_OK`, run after the last commit with nothing after it.
