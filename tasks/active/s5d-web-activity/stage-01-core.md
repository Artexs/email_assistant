# s5d-web-activity — Stage 1

Part of [`../s5d-web-activity.md`](../s5d-web-activity.md). Read that file's "Done when", "Owns", A1–A10, "Facts checked", B1–B15, "Rules for every step", "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 1 — Core: activity schemas, the shared answer words, `describeAction`

Two steps. Pure code in `packages/core` plus one import change in `channels/callbacks.ts`. No behaviour of the server changes.

- [x] **1.1 `packages/core/src/web/activity.ts` (B1)**
  - Goal: one contract for the activity read model and the two write bodies, shared by the server and the browser.
  - Files: create `packages/core/src/web/activity.ts`, `packages/core/src/web/activity.test.ts`; change `packages/core/src/web/index.ts` (add `export * from "./activity";`).
  - Interfaces:

    ```ts
    import { categories, feedbackSources, feedbackVerdicts, type Category } from "../triage/categories";
    import { z } from "./zod";

    export const ACTIVITY_PAGE_SIZE = 50;
    export const ACTIVITY_MAX_LIMIT = 100;
    export const ACTIVITY_MAX_DAYS = 90;
    export const activityRanges = ["24h", "7d", "30d", "90d"] as const;
    export type ActivityRange = (typeof activityRanges)[number];
    export const ACTIVITY_DEFAULT_RANGE: ActivityRange = "7d";
    export const activityRangeMs: Record<ActivityRange, number>; // 24 h, 7, 30, 90 days in ms
    export const NEEDS_ACTION_CATEGORIES = ["urgent", "needs_reply", "unsure"] as const satisfies readonly Category[];
    export const activityDelegationStatuses = ["drafted", "sent", "answered", "overdue", "done", "cancelled"] as const;

    export const activityQuerySchema: z.ZodType<…>; // z.object (not strict), fields of B1
    export type ActivityWebQuery = z.infer<typeof activityQuerySchema>; // categories is Category[] after the transform
    export const activityActionSchema, activityFeedbackSchema, activityDelegationSchema, activityItemSchema, activityPageSchema;
    export type ActivityItem = z.infer<typeof activityItemSchema>;
    export type ActivityWebPage = z.infer<typeof activityPageSchema>;
    export const feedbackBodySchema; // z.object({ emailId: z.uuid(), trueCategory: z.enum(labelCategories) }), labelCategories from "../digest/callback"
    export const feedbackResultSchema, undoBodySchema, undoResultSchema;
    export type FeedbackBody, FeedbackResult, UndoBody, UndoWebResult;
    ```

  - Decisions:
    - The action `type` is `z.string()`: the page shows only the `phrase`, and an import of `../triage/planners` would pull the payload and analysis schemas into the browser bundle. Import only from `../triage/categories`, `../digest/callback` (pure) and `./zod`.
    - `categories` (query): `z.string().max(200).transform((text) => text.split(","))` piped into `z.array(z.enum(categories)).min(1).max(7)` plus a refine "no duplicates". An empty item (`"info,"`) fails.
    - `since`: `z.iso.datetime({ offset: true })` (Zod 4.6.7 is installed). `limit`: `z.coerce.number().int().min(1).max(ACTIVITY_MAX_LIMIT)`.
    - Times in the item are ISO strings (`z.iso.datetime()`); `confidence` `z.number().min(0).max(1)`; `aiText`, `from`, `subject` nullable strings; `phrase` string.
    - `undoResultSchema.kind` = `z.enum(["started", "already", "nothing", "too_old", "held"])`; `created` optional int ≥ 0.
    - No custom error message anywhere in this file (B1).
    - Import `z` only from `./zod` (the `jitless` rule of the folder).
    - The browser needs the category list and types: `activity.ts` re-exports `export { categories, type Category, type FeedbackSource, type FeedbackVerdict } from "../triage/categories";` (the pattern of `settings.ts:8` for `barCategories`).
  - Test (`activity.test.ts`, unit, fixed values):
    1. `activityQuerySchema.parse({})` → all fields undefined.
    2. `{ categories: "urgent,needs_reply" }` → `["urgent", "needs_reply"]`; `"info,"`, `"info,info"`, `"bogus"`, eight items → fail.
    3. `{ limit: "50" }` → 50; `"0"`, `"101"`, `"1.5"` → fail.
    4. `{ since: "2026-11-11T10:00:00.000Z" }` passes; `"yesterday"` fails; `{ notRated: "true" }` passes, `"yes"` fails; `{ before: "" }` fails; an unknown key `{ extra: "1" }` passes (not strict).
    5. `feedbackBodySchema`: `{ emailId: <uuid>, trueCategory: "info" }` passes; `"unsure"` and `"delegation"` fail (only the five label categories, fact 1); a non-UUID fails.
    6. `activityItemSchema` parses a full fixed item (with feedback and delegation) and one with `feedback: null`, `delegation: null`, `from: null`, `subject: null`; `activityRangeMs["7d"]` = 604800000.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`.
  - Done when: the tests pass; `@ea/core/web` exports the names above.
  - Out of scope: the server use (stages 4–6).

- [x] **1.2 `packages/core/src/digest/answers.ts`, `describeAction`, `callbacks.ts` reads the words (B2, B3)**
  - Goal: one source of the Telegram answer words for both channels, and a phrase per action for the panel.
  - Files: create `packages/core/src/digest/answers.ts`, `answers.test.ts`; change `packages/core/src/digest/index.ts` (`export * from "./answers";`), `packages/core/src/digest/would-do.ts`, `would-do.test.ts`, `packages/core/src/web/index.ts` (re-export for the browser: `export { UNDO_TEXTS, rightAnswer, pickedText, pickAnswer, type UndoAnswerKind } from "../digest/answers"; export { categoryLabels, categoryTag } from "../digest/labels"; export { isLabelCategory, labelCategories, type LabelCategory } from "../digest/callback";`: both files import only a type from `../triage/categories`; the same symbol exported by `./digest` and `./web` through `packages/core/src/index.ts` is accepted by TypeScript, as `formatClock` is today), `apps/server/src/modules/channels/callbacks.ts`.
  - Interfaces:

    ```ts
    // digest/answers.ts
    export type UndoAnswerKind = "started" | "already" | "nothing" | "too_old" | "held";
    export const UNDO_TEXTS: Record<UndoAnswerKind, string>; // the five texts of callbacks.ts:56-62, word for word
    export function rightAnswer(saved: boolean, category: Category): string; // "✅ Saved: Info is right." | "Already saved."
    export function pickAnswer(saved: boolean): string; // "Saved." | "Already saved."
    export function pickedText(trueCategory: Category, aiCategory: Category): string; // "✏️ Saved: Reply (AI said Info)."

    // digest/would-do.ts
    export function describeAction(action: ActionView, names?: ReadonlyMap<string, string>): string | null;
    ```

  - Decisions:
    - Copy the five `UNDO_TEXTS` strings byte for byte from `callbacks.ts:56-62` (emoji included). Names come from `categoryLabels[c].name`.
    - `callbacks.ts`: replace the local object with `import { UNDO_TEXTS as SHARED_UNDO_TEXTS } from "@ea/core";` and `export const UNDO_TEXTS: Record<Exclude<UndoResult["kind"], "not_found">, string> = SHARED_UNDO_TEXTS;` (one line gives the re-export that the test imports, the local binding that line 156 uses, and the type check that `UndoAnswerKind` equals the undo kinds; cold review finding 6). The ✅ answer becomes `rightAnswer(saved.saved, callback.category)`, the pick answer `pickAnswer(saved.saved)` and its edit text `pickedText(callback.category, target.category)`. The output strings do not change.
    - `describeAction`: `null` when `action.reverse`; a `send` → `SEND_PHRASES[status] ?? null`; else the tense from `DRAFT_TENSES` (create_draft) or `TENSES`, the text from `phrase()`; `null` when either is missing; else `` `${tense} ${text}` ``. Do not change `describeActions`.
  - Test:
    1. `answers.test.ts`: `UNDO_TEXTS.started` = `"↩️ Undo started: the mail goes back within a minute."` and the other four as in `callbacks.ts`; `rightAnswer(true, "info")` = `"✅ Saved: Info is right."`; `rightAnswer(false, "info")` = `"Already saved."`; `pickedText("needs_reply", "info")` = `"✏️ Saved: Reply (AI said Info)."`; `pickAnswer(true)` = `"Saved."`.
    2. `would-do.test.ts`: for every type in (`flag`, `mark_read`, `move` with folder `ai_notifications`, `create_draft` kind delegation with a name, `send`) and every status of the CHECK list (`ready, applying, applied, awaiting_approval, approved, rejected, expired, undone, logged, failed`): `describeAction(a, names)` equals `describeActions([a], names)` when that text does not start with `stays in`, else `null`; a reverse row → `null`; `save_summary` → `null`. Examples pinned: `move applied` → `"done: move to AI/Notifications"`; `send awaiting_approval` → `"waits for your approval"`.
    3. The existing `channels-callbacks.test.ts` passes unchanged (integration).
  - Check: `bun run lint && bun run typecheck && bun run test:unit`; with the database guard: `bun run test:int` (the callback tests).
  - Done when: the tests pass; `git diff apps/server/test` is empty; `grep -n "Undo started" apps/server/src` finds no string literal (only the core file holds it).
  - Out of scope: the web keys (stage 7).
