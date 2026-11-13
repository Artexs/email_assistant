# F088 stage 01 — Core: notice kinds, view schemas, the renderer registry

Part of [`../plan.md`](../plan.md). Decisions: D1, D3, D10–D15, D16 (locale ignored), D17 (edit entry), D22, D23. Core only: no file under `apps/` changes. No DB. Three steps.

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

| Kind | View fields (exact names) | Registry entry calls |
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

`MAILBOX_REMOVED_TEXT` moves from `apps/server/src/modules/channels/texts.ts` to `packages/core/src/notices/renderers.ts` (step 2), with the same string, byte for byte: `"Mailbox removed. Change its password in your mail provider's settings now."`. `channels/texts.ts` keeps its export as `export { MAILBOX_REMOVED_TEXT } from "@ea/core";` (tests import it from there) — this one line under `apps/` is the only server change of this stage.

`encode.ts`:

```ts
export class NoticeViewError extends Error {
  constructor(readonly kind: NoticeKind) { super(`bad notice view for ${kind}`); this.name = "NoticeViewError"; }
}
// The JSON that `outbox.view` stores: dates as ISO strings, no lone surrogate, no NUL (jsonb refuses both).
export function encodeNoticeView<K extends NoticeKind>(kind: K, view: NoticeView<K>): Record<string, unknown>
```

Body: `JSON.stringify(view, (_key, value: unknown) => typeof value === "string" ? wellFormedText(value).replaceAll("\u0000", " ") : value)`, then `JSON.parse`, then `noticeViewSchemas[kind].safeParse(json)`; on failure `throw new NoticeViewError(kind)` (never the Zod error: D24); on success return the JSON (not the parsed value: the row stores strings, not `Date` objects). Define in `views.ts`: `export const noticeViewSchemas = { digest: digestView, urgent: urgentView, … } satisfies Record<NoticeKind, z.ZodType>;` and `export type NoticeView<K extends NoticeKind> = z.output<(typeof noticeViewSchemas)[K]>;`. `encode.ts` imports both from `views.ts` (not from `renderers.ts`, so the two files do not import each other).

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

## Step 2 — The registry, `renderNotice` and `renderNoticeEdit`

**Goal.** One place that renders a stored view for a channel, a detail level and a locale, and never throws.

**Files.** New: `packages/core/src/notices/renderers.ts`, `packages/core/src/notices/render.ts`, `packages/core/src/notices/index.ts`. Changed: `packages/core/src/index.ts` (add `export * from "./notices";` after the `./digest` line).

**Interfaces.** `renderers.ts` (shape checked by probe P3):

```ts
export interface NoticeRenderer<S extends z.ZodType> {
  schema: S;
  // en texts for both locales until E7-T1 adds the pl texts (PD-037).
  telegram: { full: (view: z.output<S>, opts: NoticeRenderOptions) => OutMessage };
}
function defineRenderer<S extends z.ZodType>(renderer: NoticeRenderer<S>): NoticeRenderer<S> { return renderer; }
export const noticeRenderers = {
  digest: defineRenderer({ schema: noticeViewSchemas.digest, telegram: { full: (view) => ({ text: view.text, buttons: view.buttons }) } }),
  urgent: defineRenderer({ schema: noticeViewSchemas.urgent, telegram: { full: (view) => renderUrgentNotice({ … }) } }),
  // … one entry per kind, as the table of step 1 says
} satisfies { [K in NoticeKind]: NoticeRenderer<z.ZodType> };
export const MAILBOX_REMOVED_TEXT = "Mailbox removed. Change its password in your mail provider's settings now.";
```

Keep the import of the render functions from `../digest/…` and `../triage/…`; do not move or change them (D11).

`render.ts`:

```ts
export type NoticeRenderResult = { ok: true; message: OutMessage } | { ok: false };
// Never throws: a view its schema rejects, a renderer that throws, an empty or too long text, bad buttons → { ok: false }.
export function renderNotice(kind: NoticeKind, view: unknown, opts: NoticeRenderOptions): NoticeRenderResult
```

Body: `const renderer: NoticeRenderer<z.ZodType> = noticeRenderers[kind];` → `renderer.schema.safeParse(view)` → `try { renderer[opts.channel][opts.detail](parsed.data, opts) } catch { return { ok: false } }` → check `message.text.length >= 1 && message.text.length <= MESSAGE_MAX_CHARS` and `outButtonsSchema.safeParse(message.buttons).success` → result. (`text.length` counts UTF-16 units, so it is never below Postgres `char_length`; the DB CHECK cannot fail after this check.)

The edit entry (D17):

```ts
export type NoticeEditInput = Parameters<typeof approvalEdit>[0]; // { original, outcome, heldBy?, at, timeZone, actionId?, counts? }
export const noticeEditRenderers: { telegram: { full: (input: NoticeEditInput, opts: NoticeRenderOptions) => OutMessage } } = {
  telegram: { full: (input) => approvalEdit(input) },
};
// The edited message after a tap: the stored text of the card plus one status line. Throws like approvalEdit.
export function renderNoticeEdit(input: NoticeEditInput, opts: NoticeRenderOptions): OutMessage
```

`index.ts` exports everything public from `kinds.ts`, `views.ts` (`noticeViewSchemas`, `approvalViewSchema`, `sendResultKindSchema`, `type WouldDoAction` comes from digest already), `encode.ts`, `renderers.ts`, `render.ts`. Check that no name clashes with an existing export of `@ea/core` (`bun run --filter @ea/core typecheck` reports a duplicate `export *` name as an error).

**Decisions.** D10, D11, D16, D17.

**Test.** `packages/core/src/notices/registry.test.ts`:

1. Completeness: `Object.keys(noticeRenderers).sort()` equals `[...noticeKinds].sort()`; `Object.keys(noticeViewSchemas).sort()` equals the same.
2. Byte-identical, one case per kind (11 cases, a `test.each` over a fixture table in the test file). For each kind, a fixed input of today's render function and the matching view; `renderNotice(kind, encodeNoticeView(kind, view), { channel: "telegram", detail: "full", locale: "en" })` is `{ ok: true, message }` and `message` deep-equals the direct call of today's function with today's input. For `urgent`, today's input has `aiText: aiTextFor({ category: "urgent", reasonCode: "llm", reason: "Deadline today", summary: null, modelCategory: null, confidence: 0.91 })` and `wouldDo: describeActions(actions, names, { stayFolder: "INBOX" })` with `actions` = one `create_draft` (`status: "ready"`, `kind: "delegation"`, `delegateId: <uuid 2>`) and one `move` (`status: "logged"`, `folder: "ai_info"`), `names = new Map([[<uuid 2>, "Anna Nowak"]])`. Use the `receivedAt` `2026-11-12T22:15:00.000Z` with `now` `2026-11-13T10:07:33.123Z` so the clock prints a date. For `send_result`, one case with `result: { kind: "failed", cause: "tries", code: "ETIMEDOUT", tries: 5 }`. For `approval_set`, two items.
3. Locale: for `urgent`, `locale: "pl"` gives the same message as `locale: "en"`.
4. A `send_result` view with `recipient.address: null` renders the text with `(unknown)`, as today's call with `address: "(unknown)"`.
5. `renderNotice("urgent", { …valid view…, emailId: "e1" }, opts)` is `{ ok: false }` (the renderer throws, probe P4).
6. `renderNotice("sync_ok", { address: "x" }, opts)` is `{ ok: false }` (schema).
7. `renderNotice("digest", { text: "x".repeat(4097), buttons: [] }, opts)` is `{ ok: false }` (the schema caps it); `renderNotice("digest", { text: "", buttons: [] }, opts)` is `{ ok: false }`.
8. `renderNoticeEdit({ original: "📤 Send 1 reminder?", outcome: "rejected_set", at: new Date("2026-11-13T10:00:00.000Z"), timeZone: "Europe/Warsaw", counts: { done: 1, skipped: 0 } }, opts).text` equals `"📤 Send 1 reminder?\n\n✖️ Skipped 11:00: 1 rejected, 0 skipped."` (the assertion of `channels-callbacks.test.ts:587`).

**Check.** `bun test packages/core/src/notices` and `bun run --filter @ea/core typecheck`.

**Done when.** Tests 1–8 pass.

**Out of scope.** `pl` texts (E7-T1). Mail and push renderers. Any change of a render function's text.

## Step 3 — Exports and the full core run

**Goal.** The server can import the registry from `@ea/core`, and nothing else in core changed.

**Files.** None new. Check only.

**Test.**

1. `bun test packages/core` passes (all old core tests unchanged).
2. `git diff --stat` lists only files under `packages/core/src/` and `apps/server/src/modules/channels/texts.ts`.

**Check.** The Proof of `plan.md` with `NN` = `01`.

**Done when.** The Proof ends with `PROOF_OK`.

**Out of scope.** Server code that uses the registry (stage 03).
