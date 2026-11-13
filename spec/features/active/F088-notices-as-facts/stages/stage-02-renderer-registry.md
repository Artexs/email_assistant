# F088 stage 02 — Core: the renderer registry, `renderNotice`, `renderNoticeEdit`

Part of [`../plan.md`](../plan.md). Decisions: D3, D10, D11, D13, D16 (locale ignored), D17 (edit entry), D22. Needs stage 01 landed (kinds, view schemas, encoder). Core only: no file under `apps/` changes. No DB. Two steps.

## Step 1 — The registry, `renderNotice` and `renderNoticeEdit`

**Goal.** One place that renders a stored view for a channel, a detail level and a locale, and never throws.

**Files.** New: `packages/core/src/notices/renderers.ts`, `packages/core/src/notices/render.ts`, `packages/core/src/notices/registry.test.ts`. Changed: `packages/core/src/notices/index.ts` (also export `renderers.ts` and `render.ts`).

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
  // … one entry per kind: the column "Registry entry calls" of the table in stage 01, step 1
} satisfies { [K in NoticeKind]: NoticeRenderer<z.ZodType> };
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

`index.ts` adds the exports of `renderers.ts` and `render.ts`. Check that no name clashes with an existing export of `@ea/core`.

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

## Step 2 — The core run

**Goal.** Nothing else in core changed.

**Test.**

1. `bun test packages/core` passes (all old core tests unchanged).
2. `git diff --stat` lists only files under `packages/core/src/notices/`.

**Check.** The Proof of `plan.md` with `NN` = `02`.

**Done when.** The Proof ends with `PROOF_OK`.

**Out of scope.** Server code that uses the registry (stages 03–05).
