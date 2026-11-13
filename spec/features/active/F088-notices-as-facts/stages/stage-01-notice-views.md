# F088 stage 01 — Core: notice kinds, view schemas, the encoder

Part of [`../plan.md`](../plan.md). Decisions: D1, D10, D12–D15, D23. Core only: no DB, and no server file changes except one re-export line. Two steps. Stage 02 adds the renderers on top of these schemas.

## Step 1 — Kinds, view schemas and the encoder

**Goal.** One list of notice kinds, channels and detail levels in core, a strict Zod schema per kind for its view, and `encodeNoticeView`, which turns a typed view into the JSON that the outbox row stores.

**Files.** New: `packages/core/src/notices/kinds.ts`, `packages/core/src/notices/views.ts`, `packages/core/src/notices/encode.ts`. Changed: `packages/core/src/digest/would-do.ts` (type only), `packages/core/src/digest/text.ts` (one exported helper).

**Interfaces.**

`kinds.ts`:

```ts
export const noticeKinds = [
  "digest", "urgent", "auth_error", "sync_stale", "sync_ok", "action_failed",
  "approval", "approval_set", "send_result", "delegation_answered", "mailbox_removed",
] as const; // the same order as the CHECK list of `outbox.kind`
export type NoticeKind = (typeof noticeKinds)[number];
export const noticeKindSchema = z.enum(noticeKinds);
export const noticeChannels = ["telegram"] as const; // E4-B adds "mail", E9b "push"
export type NoticeChannel = (typeof noticeChannels)[number];
export const noticeDetails = ["full"] as const; // E9b adds "minimal"
export type NoticeDetail = (typeof noticeDetails)[number];
export interface NoticeRenderOptions { channel: NoticeChannel; detail: NoticeDetail; locale: UserLocale }
```

`text.ts`: export `wellFormedText(text: string): string` = `text.replace(LONE_SURROGATE, "�")`, and use it inside `cutText` in place of the inline `.replace(LONE_SURROGATE, "�")` (same result).

`would-do.ts`: add `export type WouldDoAction = Pick<ActionView, "type" | "status" | "folder" | "reverse" | "kind" | "delegateId">;` and change the parameter of `describeActions`, `describeAction`, `phrase` and `draftPhrase` from `ActionView` to `WouldDoAction` (they read only these fields). `ActionView` stays as it is; every caller still compiles.

`views.ts`: one strict schema per kind (D14). Use `z.strictObject` for every object, nested ones too. Helpers:

```ts
const isoDate = z.iso.datetime().transform((value) => new Date(value));
const id = z.string().min(1);
const draftKind = z.enum(["delegation", "clarification", "reminder"]);
```

| Kind | View fields (exact names) | Registry entry calls (built in stage 02) |
| --- | --- | --- |
| `digest` | `text: z.string().min(1).max(MESSAGE_MAX_CHARS)`, `buttons: outButtonsSchema` | returns `{ text, buttons }` |
| `urgent` | `emailId: id`, `from: string \| null`, `subject: string \| null`, `ai: { reasonCode: string, reason: string \| null }`, `receivedAt: isoDate`, `synthetic: boolean`, `folderTag: string \| null`, `actions: WouldDoAction[]` (schema: `type: z.enum(actionTypes)`, `status: z.string()`, `folder: z.enum(moveTargets).nullable()`, `reverse: z.boolean()`, `kind: draftKind.nullable()`, `delegateId: z.string().nullable()`), `delegateNames: z.record(z.string(), z.string())`, `stayFolder: z.string()`, `now: isoDate`, `timeZone: z.string().min(1)` | `renderUrgentNotice({ emailId, from, subject, aiText: aiTextFor({ category: "urgent", reasonCode: ai.reasonCode, reason: ai.reason, summary: null, modelCategory: null, confidence: 0 }), receivedAt, synthetic, folderTag, wouldDo: describeActions(actions, new Map(Object.entries(delegateNames)), { stayFolder }), now, timeZone })` |
| `auth_error` | `address`, `mailboxId: id`, `since: isoDate`, `now`, `timeZone` | `renderAuthErrorNotice(view)` |
| `sync_stale` | `address`, `lastSyncedAt: isoDate.nullable()`, `now`, `timeZone` | `renderSyncStaleNotice(view)` |
| `sync_ok` | `address`, `lastSyncedAt: isoDate`, `now`, `timeZone` | `renderSyncOkNotice(view)` |
| `action_failed` | `actionType: z.enum(["move", "flag", "mark_read", "create_draft"])`, `reverse: boolean`, `reason: z.enum(["mail_not_found", "bad_payload", "other"])`, `folderName: string \| null`, `sourceFolder: string`, `currentFolder: string`, `from: string \| null`, `subject: string \| null`, `synthetic: boolean`, `attempts: z.number().int().min(0)` | `renderActionFailedNotice(view)` |
| `approval` | `actionId: id`, `view: approvalViewSchema`, `now: isoDate`, `timeZone` | `renderApprovalRequest(view)` |
| `approval_set` | `setId: id`, `items: z.array(item).min(1).max(CHASER_SET_LIMIT)` with item `n: int ≥ 1`, `delegateName`, `address`, `subject: string \| null`, `dueAt: isoDate.nullable()`, `reminder: z.union([z.literal(1), z.literal(2)])`, `task`; `timeZone` | `renderApprovalSetRequest(view)` |
| `send_result` | `actionId: id`, `sendKind: draftKind`, `result: sendResultKindSchema`, `recipient: { name: string \| null, address: string \| null }`, `subject: string`, `synthetic: boolean` | `renderSendResult({ ...view, recipient: { name, address: address ?? "(unknown)" } })` |
| `delegation_answered` | `delegationId: id`, `delegateName`, `subject: string \| null`, `receivedAt: isoDate`, `now`, `timeZone`, `synthetic` | `renderDelegationAnswered(view)` |
| `mailbox_removed` | none: `z.strictObject({})` | `{ text: MAILBOX_REMOVED_TEXT, buttons: [] }` |

Plain `string` fields above are `z.string()`. `approvalViewSchema` mirrors `ApprovalView` (`packages/core/src/outgoing/sender.ts:18`): `kind: draftKind`, `recipient: { name: z.string().nullable(), address: z.string() }`, `sender: { label: z.string(), external: z.boolean() }.nullable()`, `recipientInactive`, `subject`, `dueDate: z.string().nullable()`, `body`, `quote: { text: z.string(), cut: z.boolean() }.nullable()`, `synthetic`. `sendResultKindSchema` is a `z.discriminatedUnion("kind", …)` that mirrors `SendResultKind` (`digest/approvals.ts`), one member per variant, with the same literal lists for `cause` and `reason`.

Two compile-time guards in `views.ts`, so a later change of the TypeScript type breaks the build until the schema follows:

```ts
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const approvalViewMatches: Same<z.output<typeof approvalViewSchema>, ApprovalView> = true;
const sendResultMatches: Same<z.output<typeof sendResultKindSchema>, SendResultKind> = true;
void approvalViewMatches; void sendResultMatches;
```

`MAILBOX_REMOVED_TEXT` moves from `apps/server/src/modules/channels/texts.ts` to `packages/core/src/notices/kinds.ts`, with the same string, byte for byte: `"Mailbox removed. Change its password in your mail provider's settings now."`. `channels/texts.ts` keeps its export as `export { MAILBOX_REMOVED_TEXT } from "@ea/core";` (tests import it from there) — this one line under `apps/` is the only server change of this stage.

`encode.ts`:

```ts
export class NoticeViewError extends Error {
  constructor(readonly kind: NoticeKind) { super(`bad notice view for ${kind}`); this.name = "NoticeViewError"; }
}
// The JSON that `outbox.view` stores: dates as ISO strings, no lone surrogate, no NUL (jsonb refuses both).
export function encodeNoticeView<K extends NoticeKind>(kind: K, view: NoticeView<K>): Record<string, unknown>
```

Body: `JSON.stringify(view, (_key, value: unknown) => typeof value === "string" ? wellFormedText(value).replaceAll("\u0000", " ") : value)`, then `JSON.parse`, then `noticeViewSchemas[kind].safeParse(json)`; on failure `throw new NoticeViewError(kind)` (never the Zod error: D24); on success return the JSON (not the parsed value: the row stores strings, not `Date` objects). Define in `views.ts`: `export const noticeViewSchemas = { digest: digestView, urgent: urgentView, … } satisfies Record<NoticeKind, z.ZodType>;` and `export type NoticeView<K extends NoticeKind> = z.output<(typeof noticeViewSchemas)[K]>;`. `encode.ts` imports both from `views.ts`.

**Decisions.** D10, D13, D14, D15, D23.

**Test.** `packages/core/src/notices/encode.test.ts` (fixed values; ids are the uuid `11111111-1111-4111-8111-111111111111` and `22222222-2222-4222-8222-222222222222`; `now = new Date("2026-11-13T10:07:33.123Z")`, `timeZone = "Europe/Warsaw"`):

1. `encodeNoticeView("sync_ok", { address: "box@example.test", lastSyncedAt: new Date("2026-11-13T09:00:00.000Z"), now, timeZone })` returns an object whose `lastSyncedAt` is the string `"2026-11-13T09:00:00.000Z"`.
2. A subject `"A\ud800B"` in an `urgent` view encodes to `"A�B"`; a subject `"A\u0000B"` encodes to `"A B"`.
3. An `urgent` view with an extra key `body: "x"` throws `NoticeViewError`; its `message` is `"bad notice view for urgent"` and does not contain `"x"`.
4. An `auth_error` view without `mailboxId` throws `NoticeViewError` (call it through a cast `as never`).
5. `encodeNoticeView("mailbox_removed", {})` returns `{}`.
6. `describeActions` gets a `WouldDoAction[]` without `id`: `describeActions([{ type: "flag", status: "logged", folder: null, reverse: false, kind: null, delegateId: null }])` returns `"would flag"`.

**Check.** `bun test packages/core/src/notices packages/core/src/digest` and `bun run --filter @ea/core typecheck`.

**Done when.** Tests 1–6 pass; `digest/*.test.ts` pass unchanged.

**Out of scope.** Any server file except the one re-export line in `channels/texts.ts`.

## Step 2 — Exports and the core run

**Goal.** The server can import the kinds, the schemas and the encoder from `@ea/core`; nothing else in core changed.

**Files.** New: `packages/core/src/notices/index.ts` (exports `kinds.ts`, `views.ts`, `encode.ts`). Changed: `packages/core/src/index.ts` (add `export * from "./notices";` after the `./digest` line).

**Interfaces.** Check that no exported name clashes with an existing export of `@ea/core` (`bun run --filter @ea/core typecheck` reports a duplicate `export *` name as an error).

**Test.**

1. `bun test packages/core` passes (all old core tests unchanged).
2. `git diff --stat` lists only files under `packages/core/src/` and `apps/server/src/modules/channels/texts.ts`.

**Check.** The Proof of `plan.md` with `NN` = `01`.

**Done when.** The Proof ends with `PROOF_OK`.

**Out of scope.** The renderers (stage 02). Server code that uses the views (stage 04).
