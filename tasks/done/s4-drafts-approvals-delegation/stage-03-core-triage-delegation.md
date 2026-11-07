# s4-drafts-approvals-delegation — Stage 3

Part of [`../s4-drafts-approvals-delegation.md`](../s4-drafts-approvals-delegation.md). Read that file's "Input" and "Rules for every step" first.

## Stage 3 — Core: `delegation` in the rules, the analysis schema, the planner, the policy [risky]

Why risky: these pure functions decide which mail becomes a draft to a person and under which gate. A wrong `allowed` list lets the LLM pick `delegation` without delegates; a wrong policy branch sends without approval.

- [x] **3.1 Hard rules and the analysis schema (D3)**
  - Goal: `delegation` is an allowed category only when the organization has active delegates; the LLM output schema carries the delegate id (from a given list), the task and the clarification.
  - Files: change `packages/core/src/triage/rules.ts`, `rules.test.ts`, `analysis.ts`, `analysis.test.ts`, `categories.ts`.
  - Interfaces:

    ```ts
    // categories.ts
    export const classifierCategories: readonly Category[] = ["urgent", "needs_reply", "info", "notification", "spam"]; // unchanged
    export const DELEGATION_CATEGORY: Category = "delegation";
    // rules.ts
    export interface HardRuleOptions {
      delegation?: boolean; // true = the organization has at least one active delegate
    }
    export function applyHardRules(
      fromAddress: string | null,
      rules: readonly SenderRule[],
      opts?: HardRuleOptions
    ): HardRuleResult;
    // analysis.ts
    export const TASK_MAX_CHARS = 300;
    export const CLARIFICATION_MAX_CHARS = 200;
    export function buildTriageAnalysisSchema(allowed: readonly Category[], delegateIds?: readonly string[]);
    // fields: { due_date, language, delegate_id: string | null, task: string | null, clarification: string | null }
    export type TriageAnalysis = z.infer<ReturnType<typeof buildTriageAnalysisSchema>>;
    ```

  - Decisions:
    - `applyHardRules`: `allowed` = `classifierCategories` (minus `spam` for a whitelisted sender, as today) plus `delegation` at the end when `opts?.delegation` is true. The blocklist rule is unchanged (a blocklisted sender never reaches the LLM). A noreply sender keeps `delegation` in the list (the planner refuses a clarification to a noreply address, D4; a delegation draft to a delegate is fine).
    - `buildTriageAnalysisSchema(allowed, delegateIds = [])`: `delegate_id` = `z.enum(delegateIds as [string, ...string[]]).nullable()` when the list is not empty, else `z.null()`; `task` = `z.string().max(TASK_MAX_CHARS).nullable()`; `clarification` = `z.string().max(CLARIFICATION_MAX_CHARS).nullable()`. With `delegation` not in `allowed`, the three fields still exist (null expected): one schema shape per request keeps the provider's structured-output cache warm and the eval state file names stable.
    - The JSON schema that `z.toJSONSchema` makes for a nullable enum is `anyOf: [{ enum }, { type: "null" }]`; stage 8 checks it on both providers.
  - Test: `rules.test.ts`: without options `allowed` has 5 categories; with `{ delegation: true }` it has 6 with `delegation` last; whitelisted + delegation → no `spam`, with `delegation`; a blocklisted sender → `spam` regardless of the option. `analysis.test.ts`: the schema with `delegateIds: ["a", "b"]` accepts `delegate_id: "a"` and `null`, refuses `"c"`; with no ids it refuses `"a"` and accepts `null`; `task` of 301 characters is refused; `clarification` of 201 is refused; the v1 fields still parse; `z.toJSONSchema` of the schema has `fields.properties.delegate_id.anyOf` with the enum and the null type (a snapshot-free assertion on the shape).
  - Check: `bun run lint && bun run typecheck && bun run test:unit`.
  - Done when: the tests pass; `apps/server` still compiles (the classifier passes no `delegateIds` yet: stage 8).
  - Out of scope: the prompt text (stage 8), the server's delegates list (stage 9).

- [x] **3.2 Planner and policy for `create_draft` and `send` (D2, D4, D5)**
  - Goal: a `delegation` mail plans a draft and a send (or a clarification pair, or nothing); the policy gives `apply` to a draft only in `assist` with the switch, and `await_approval` to a send only when its draft applies.
  - Files: change `packages/core/src/triage/planners.ts`, `planners.test.ts`, `policy.ts`, `policy.test.ts`; create `packages/core/src/triage/payloads.ts`, `payloads.test.ts`; change `packages/core/src/triage/index.ts` (export the new file); change `apps/server/src/modules/actions/repo.ts` (`PlannedActionInput.payload` widens from `Record<string, string>` (`repo.ts:22`) to `Record<string, unknown>`: D2; `ActionRow.payload` is `unknown` already (`repo.ts:37`): leave it, M17; `TYPE_RANK: Record<ActionType, number>` (`repo.ts:175`) gets `create_draft: 4, send: 5`, D17, M16) and `apps/server/src/modules/triage/service.ts` (`payloadOf`, `service.ts:89`, returns `Record<string, unknown>` with the two new cases); change `packages/core/src/digest/would-do.ts` (`phrase()`, `:24-35`, is a switch on `ActionType` with no default and returns `string | null`: add `case "create_draft":` and `case "send":` that return `null` until stage 14 writes the phrases; M16) and `apps/server/src/modules/channels/notices.ts` (`detectActionFailed` passes `actionType: action.type` (`:130`) to `renderActionFailedNotice`, whose `actionType` is `"move" | "flag" | "mark_read"`, narrowed today only by `action.type !== "save_summary"` (`:120`): narrow with `MAILBOX_ACTION_TYPES` instead, so a row of another type is only marked notified, with no notice, as `save_summary` is today; M16). The three sites break under `strict` as soon as `actionTypes` has the two new types.
  - Interfaces:

    ```ts
    // planners.ts
    export const actionTypes = ["move", "mark_read", "flag", "save_summary", "create_draft", "send"] as const;
    export const MAILBOX_ACTION_TYPES = ["move", "mark_read", "flag"] as const; // unchanged (S3 D21 scope)
    export interface DelegationInput {
      delegateId: string | null;
      delegateName: string | null;
      to: string | null; // the delegate's address from the delegates row
      task: string | null;
      clarification: string | null;
      dueDate: string | null; // YYYY-MM-DD
      language: "pl" | "en" | "other";
      senderAddress: string | null;
    }
    export type PlannedAction =
      | { type: "move"; folder: FolderKey }
      | { type: "mark_read" }
      | { type: "flag" }
      | { type: "save_summary"; summary: string }
      | { type: "create_draft"; draft: DraftPayload }
      | { type: "send"; send: SendPayload; dependsOn: "create_draft" };
    export function planActions(
      category: Category,
      summary: string | null,
      delegation?: DelegationInput
    ): PlannedAction[];
    // payloads.ts (Zod; the readers parse with them)
    export const ADDRESS_PATTERN = /^[^\s@<>,;"'\r\n]+@[^\s@<>,;"'\r\n]+$/; // one strict rule for every recipient in a payload (D2)
    export const addressSchema = z.string().regex(ADDRESS_PATTERN);
    export const draftLanguageSchema = z.enum(["pl", "en"]);
    export const draftPayloadSchema = z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("delegation"),
        delegate_id: z.string().uuid(),
        delegate_name: z.string().min(1),
        to: z.array(addressSchema).length(1),
        task: z.string().min(1).max(300),
        due_date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
        language: draftLanguageSchema,
      }),
      z.object({
        kind: z.literal("clarification"),
        to: z.array(addressSchema).length(1),
        question: z.string().min(1).max(200),
        language: draftLanguageSchema,
      }),
      z.object({
        kind: z.literal("reminder"),
        delegate_id: z.string().uuid(),
        delegate_name: z.string().min(1),
        to: z.array(addressSchema).length(1),
        task: z.string().min(1).max(300),
        due_date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
        language: draftLanguageSchema,
        delegation_id: z.string().uuid(),
        reminder: z.union([z.literal(1), z.literal(2)]),
        thread: z.object({ in_reply_to: z.string().nullable(), references: z.array(z.string()) }),
      }),
    ]);
    export type DraftPayload = z.infer<typeof draftPayloadSchema>;
    export const sendPayloadSchema = z.object({
      kind: z.enum(["delegation", "clarification", "reminder"]),
      to: z.array(addressSchema).length(1),
      delegate_id: z.string().uuid().optional(),
      delegation_id: z.string().uuid().optional(),
      reminder: z.union([z.literal(1), z.literal(2)]).optional(),
      set_id: z.string().uuid().optional(),
    });
    export type SendPayload = z.infer<typeof sendPayloadSchema>;
    export function sendPayloadFor(draft: DraftPayload): SendPayload; // kind, to, delegate_id, delegation_id, reminder copied from the draft
    // policy.ts
    export function decidePolicy(action: PlannedAction, input: PolicyInput): PolicyDecision; // new branches below
    ```

  - Decisions:
    - `planActions("delegation", summary, delegation)`: no `delegation` input → `[]`. `delegateId && task && to && delegateName` → `[{ type: "create_draft", draft: { kind: "delegation", delegate_id, delegate_name, to: [to], task, due_date: dueDate ?? "", language } }, { type: "send", send: sendPayloadFor(draft), dependsOn: "create_draft" }]`; else `clarification && senderAddress && ADDRESS_PATTERN.test(senderAddress) && !isNoreplyAddress(senderAddress)` → the clarification pair with `to: [senderAddress]`, `question: clarification`; else `[]`. Every `to` in both payload schemas is `z.array(addressSchema).length(1)` (a sender address with a space, a `<`, a comma or a line break never becomes a recipient). `language` `other` → `en`. The task and the question are taken as given (the classifier marked them, D3); the planner cuts them to the schema limits (`cutText` is in `digest/text.ts`; use `slice`: the limits are characters, and the schema already enforces them upstream). No `save_summary` for `delegation` (the task is the summary; the digest shows the task from the draft payload: stage 14).
    - `decidePolicy`: `create_draft` → `mode === "assist" && toolSwitches.create_draft ? "apply" : "log_only"` (VIP included: architecture §4.3 row "Create draft"); `send` → `decidePolicy({ type: "create_draft", draft: <any> }, input) === "apply" ? "await_approval" : "log_only"` (the draft decision of the same input; the send never applies on its own: `actionStatusFor("await_approval")` = `awaiting_approval`). `movesSupported` plays no role for drafts.
    - `draftPayloadSchema` and `sendPayloadSchema` are the single source of the payload shapes (D2); `apps/server` parses `actions.payload` with them in stages 9–17. `due_date` `""` means none.
    - Build step 0 (M16): adding `create_draft` and `send` to `actionTypes` breaks three S3 sites under `strict`: `TYPE_RANK` (`actions/repo.ts:175`), `phrase()` (`digest/would-do.ts:24-35`) and the `actionType` of `detectActionFailed` (`channels/notices.ts:130`). Fix all three in this step (Files above), so `bun run typecheck` passes for the whole repo.
  - Test: `planners.test.ts`: (1) `delegation` with a delegate and a task → two actions: the draft with `kind: "delegation"`, `to: [address]`, `due_date: ""` when none, and the send with `dependsOn: "create_draft"` and `delegate_id`; (2) with a due date → `due_date` copied; (3) no delegate but a clarification and a sender → the clarification pair with `to: [sender]`; (4) a clarification and a noreply sender → `[]`; (4b) a clarification and a sender `"x@y.test, evil@z.test"` or `"<x@y.test>"` → `[]`; (5) no delegate, no clarification → `[]`; (6) no input → `[]`; (7) `language: "other"` → `en`; (8) the other categories are unchanged (one assertion each). `payloads.test.ts`: each payload kind parses; a `to` with two addresses is refused; `due_date` `"2026-11-10"` and `""` pass and `"10.11.2026"` fails (the regex checks the shape only: a bad month such as `2026-13-01` passes, and the builder prints it as text); a `to` entry `"x@y.test, evil@z.test"` or `"<x@y.test>"` is refused in all four schemas; `sendPayloadFor` copies the fields. `policy.test.ts`: (1) `create_draft` in `assist` with the switch → `apply`; switch off → `log_only`; `shadow` → `log_only`; VIP with the switch → `apply`; (2) `send` with the draft `apply` → `await_approval`; with the draft `log_only` → `log_only`; (3) `actionStatusFor("await_approval")` → `awaiting_approval`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`. `apps/server` compiles: `triage/service.ts` `payloadOf` gets the two new cases (`create_draft` → `action.draft`, `send` → `action.send`), the `PlannedActionInput` payload type is `Record<string, unknown>`, `TYPE_RANK`, `phrase()` and `detectActionFailed` have the M16 changes, and `createPlanned` ignores `dependsOn` until stage 9 (a TODO comment named "stage 9" is allowed here, nowhere else).
  - Done when: the tests pass and the whole repo typechecks.
  - Out of scope: the texts (stage 4), `createPlanned` with `dependsOn` (stage 9), the digest phrases (stage 14).
