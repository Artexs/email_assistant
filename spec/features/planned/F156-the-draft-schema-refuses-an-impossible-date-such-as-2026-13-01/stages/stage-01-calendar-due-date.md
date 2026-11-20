# F156 stage 01 — the due date of a draft is a calendar date

Needs: nothing outside this stage. May run next to any stage that does not edit `packages/core/src/triage/payloads.ts`, `triage/planners.ts` or `apps/server/src/modules/delegation/chaser.ts`.

Part of [`../plan.md`](../plan.md). Not `[risky]`.

## Step 1 — the schema refuses an impossible date

- **Goal:** `draftPayloadSchema` refuses a `due_date` that is not `""` and not a real calendar date (P1).
- **Where:** `packages/core/src/triage/payloads.ts`.
- **Interfaces (new, exported from `@ea/core`):**
  - `dueDateSchema` = `z.union([z.literal(""), z.iso.date()])` (D1). Replace the comment "The regex checks the shape only" with one line that says the rule.
  - `dueDateOrNone(value: unknown): string` — `value` when `dueDateSchema` accepts it, else `""` (D4). `unknown`, because the chaser reads it from a stored JSON payload.
- **Decisions:** P1, D1, D4.

## Step 2 — the planner and the chaser write no impossible date

- **Goal:** a draft that the system writes always passes Step 1.
- **Where:** `planDelegation` in `packages/core/src/triage/planners.ts` (D2) and the reminder payload builder in `apps/server/src/modules/delegation/chaser.ts` (D3). Both call `dueDateOrNone`; it replaces the chaser's own `typeof … === "string"` guard.
- **Decisions:** D2, D3. Do not change `triage/analysis.ts` (the LLM schema) or `delegation/service.ts dueInstant`.

## Step 3 — capability pages

- `docs/capabilities/drafts-and-send.md`, the `payload` of a draft line: `due_date` is `""` or a real calendar date `YYYY-MM-DD`.
- `docs/capabilities/delegation.md`: the planner and the chaser write `""` for a date that does not exist (D2, D3); the message then has no due line (D6).

## Tests

All values fixed. Files: the existing test files next to the code (`payloads.test.ts`, `planners.test.ts`, `apps/server/test/integration/delegation-chaser.test.ts`).

- **T1 (flip, payloads.test.ts).** Replace the line that expects `due_date: "2026-13-01"` → `success: true`. New assert for the `delegation` fixture with `due_date: "2026-13-01"`: `success` is `false`, and `error.issues` mapped to `{ code, path }` equals `[{ code: "invalid_format", path: ["due_date"] }]` (Facts checked in `plan.md`). This is the "exact refusal" of the ticket Acceptance.
- **T2 (`test.each`, payloads.test.ts).** For both the `delegation` and the `reminder` fixture, `draftPayloadSchema.safeParse({ ...fixture, due_date })`:

  | due_date | success |
  |---|---|
  | `2026-11-10` | true |
  | `""` | true |
  | `2028-02-29` | true |
  | `2000-02-29` | true |
  | `2026-13-01` | false |
  | `2026-02-30` | false |
  | `2026-02-29` | false |
  | `1900-02-29` | false |
  | `2026-04-31` | false |
  | `2026-00-10` | false |
  | `10.11.2026` | false |

  Fold the old "accepts a date and an empty string, refuses another shape" test into this table; do not keep both.
- **T3 (payloads.test.ts).** The stored shapes still parse: the existing `delegation` fixture (`due_date: "2026-11-10"`) and the `reminder` fixture (`due_date: ""`) give `success: true` unchanged. Keep the existing cases that already assert this; add nothing if they do.
- **T4 (planners.test.ts).** `planActions("delegation", null, delegationInput({ dueDate: "2026-02-30" }))`: the `create_draft` has `draft.due_date === ""`, and `draftPayloadSchema.safeParse(draft).success` is `true`. The existing case with `dueDate: "2026-11-10"` keeps `"2026-11-10"`.
- **T5 (payloads.test.ts, `test.each`).** `dueDateOrNone`: `"2026-11-10"` → `"2026-11-10"`; `""` → `""`; `"2026-13-01"` → `""`; `null` → `""`; `undefined` → `""`; `42` → `""`.
- **T6 (delegation-chaser.test.ts, next to case 14).** An original draft stored with `due_date: "2026-02-30"` (insert the row directly, as the old schema allowed): the chaser's reminder draft payload has `due_date: ""`. Name it like the others, e.g. `(14b) an original draft with an impossible due date: the reminder due_date is empty`.
- **T7 (break check).** Put the old regex back once: T1, T2 (`2026-13-01` rows) and T4 fail. Restore. Say in the final message that you saw it.

## Done when

- T1–T7 hold; `bun test` of each changed test file passes while you work.
- No other schema changed: `analysis.ts`, the web query schemas and `web/activity.test.ts` have no diff.
- The two capability pages say the rule (Step 3).
- Final proof: the last line of `bun run check:job` (`check:job PASS master=… tip=…`), run once, with nothing after it.

## Out of scope

- A data migration of stored drafts (D5; the coordinator's count after the release decides a follow-up).
- `follow_up.sent_at`, the classifier analysis schema, `dueInstant`, `changelog.ts validDate`.
