# F088 stage 05 — The text is made at send time; the tap edit through the registry [risky]

Part of [`../plan.md`](../plan.md). `[risky]`: from this stage on, every notice that a user receives is rendered by the sender (stage 03 taught the sender to do it; this stage stops the queue from storing the text). Decisions: D2, D15, D17, D18, D24. Needs stage 04 landed. Review job before the land; after the land, the group review of stages 03–05 and owner checkpoint C1. Two steps.

## Step 1 — The queue stops storing the text

**Goal.** A new row has `text` null and `buttons` `[]` until it is sent (D2).

**Files.** `apps/server/src/modules/channels/repo.ts`, `apps/server/src/modules/channels/notice-queue.ts`, the test code that calls `insertOutbox` with `message` (`bun run typecheck` lists it: `channels-outbox`, `channels-sender`, `channels-callbacks`, `delegation-schema`, `delete-mailbox`, `mail-remove`, `mailbox-rows.ts:61,70`), and new helpers in `apps/server/test/integration/fixtures.ts`.

**Interfaces.**

- `NewOutboxRow` loses `message`. `insertOutbox` no longer writes `text` and `buttons` (the DB gives `null` and `'[]'`). Remove the `outButtonsSchema.parse` and its comment from `insertOutbox` (the renderer check of `renderNotice` covers the buttons now).
- `queueNotice` keeps the check render (D15) and drops `message` from its `insertOutbox` call.
- `fixtures.ts`:

```ts
// The message a row stands for: its sent text, or the render of its view (as the sender makes it).
export function renderedOf(row: {
  kind: string; view: unknown; channel: string; detail: string; locale: string; text: string | null; buttons: unknown;
}): OutMessage
```

  Body: `text !== null` → `{ text, buttons: outButtonsSchema.parse(buttons) }`; else `renderNotice(noticeKindSchema.parse(kind), view, { channel: z.enum(noticeChannels).parse(channel), detail: z.enum(noticeDetails).parse(detail), locale: userLocaleSchema.parse(locale) })`, and throw `new Error("view does not render")` when it is not `ok`.

- Test rows with a fixed text: the files that insert a row only to read or send a given text change like this:
  - `fixtures.ts` also gets `testNoticeView(kind: "urgent" | "digest" | "approval" | "approval_set", input: { marker: string; emailId?: string; at: Date }): Record<string, unknown>`, which returns `encodeNoticeView(kind, …)` of these views (`timeZone: "Europe/Warsaw"`, ids from `crypto.randomUUID()` unless given):
    - `urgent`: `{ emailId: input.emailId, from: "sender@example.test", subject: input.marker, ai: { reasonCode: "llm", reason: null }, receivedAt: input.at, synthetic: false, folderTag: null, actions: [], delegateNames: {}, stayFolder: "INBOX", now: input.at, timeZone }` (throws when `emailId` is missing);
    - `digest`: `{ text: input.marker, buttons: [[{ text: "OK", data: "ok" }]] }`;
    - `approval`: `{ actionId, view: { kind: "delegation", recipient: { name: null, address: "delegate@example.test" }, sender: null, recipientInactive: false, subject: input.marker, dueDate: null, body: "Body", quote: null, synthetic: false }, now: input.at, timeZone }`;
    - `approval_set`: `{ setId, items: [{ n: 1, delegateName: "Anna", address: "delegate@example.test", subject: input.marker, dueAt: null, reminder: 1, task: "Task" }], timeZone }`.
  - `channels-sender.test.ts` `addRow` (line 80): pass `view: testNoticeView(kind, { marker: \`${SECRET} ${counter}\`, emailId, at: T })` and `locale: "en"` instead of `message` (the helper already creates the e-mail id for `urgent`, `approval`, `approval_set`). The two assertions at lines 135–136 become `expect(s.channel.sent[0]?.message.text).toContain(SECRET)` and `expect(s.channel.sent[0]?.message.buttons[0]?.[0]?.text).toBe("✅ Right")` (the urgent card's first button). These two lines are the only assertion changes in this file.
  - `channels-callbacks.test.ts` `queueFor` (line 388): insert with `view: {}` and `locale: "en"`, then set the card text as the sender would after the send: `await trx.updateTable("outbox").set({ text }).where("dedup_key", "=", \`${kind}:${key}\`).where("user_id", "=", userId).execute();`.
  - `mail-remove.test.ts` helper at line 106 (a digest): `view: { text, buttons: [] }`, `locale: "en"`. The expectation at line 195 (`text: MAILBOX_REMOVED_TEXT` on a pending row) becomes `text: null` plus `renderedOf(row).text` equal to `MAILBOX_REMOVED_TEXT` (select the extra columns). Lines 419–420 (`claimed.some((row) => row.text === …)`) compare `renderedOf(row).text`.
  - `delete-mailbox.test.ts` (line 48), `delegation-schema.test.ts`, `channels-outbox.test.ts` `rowFor` (line 39), `mailbox-rows.ts` (lines 61, 70): drop `message` (they got `view` and `locale` in stage 04); a digest row gets `view: { text: <its old text>, buttons: [] }`, other kinds `view: {}` (these tests check constraints and status changes, not texts). Where a test then reads `text` of a pending row (`delete-mailbox` `outboxText` line 129: `"Digest of B"`), read `renderedOf(row).text` instead.
- Test helpers that read texts of queued rows: `channels-notices.test.ts` `rows` (line 100) and `channels-digest-job.test.ts` `outbox` (line 81) select `kind`, `view`, `channel`, `detail`, `locale`, `text`, `buttons`, and map each row to `{ ...row, ...renderedOf(row) }`, so `row.text` and `row.buttons` keep their meaning for every existing assertion.

**Decisions.** D2, D15.

**Test.** All existing assertions of `channels-notices`, `channels-digest-job`, `channels-callbacks`, `channels-sender`, `mail-remove`, `delete-mailbox` hold with only the helper changes above. New case in `channels-outbox.test.ts`: a `queueNotice` row has `text` null and `buttons` `[]`.

**Check.** `bun test apps/server/test/integration/channels-*.test.ts apps/server/test/integration/mail-remove.test.ts apps/server/test/integration/delete-mailbox.test.ts apps/server/test/integration/delegation-schema.test.ts` (the sender renders since stage 03).

**Done when.** The check passes. In `channels-sender.test.ts`, the stage 03 cases that made a row without text by a raw `UPDATE` may now use `addRow` directly; keep their assertions.

**Out of scope.** Old rows with text (the sender sends them as they are since stage 03).

## Step 2 — The tap edit through the registry

**Goal.** The edit after a tap is the stored card plus one status line, rendered by the registry's edit entry for the row's channel, detail and locale (D17).

**Files.** `apps/server/src/modules/channels/callbacks.ts`, `apps/server/test/integration/channels-callbacks.test.ts`.

**Interfaces.** The closure `edit` in `handleApprovalCallback`:

```ts
// The card as the user got it (the stored text) plus one status line (docs/architecture.md §4.5). A row that was never
// sent has no text: no edit, only the answer.
const row = await findOutboxByDedup(deps.db, ctx, link.userId, dedupKey);
if (row === undefined || row.text === null || row.text === "") return undefined;
return renderNoticeEdit(
  { original: row.text, outcome, at: now, timeZone, ...extra },
  { channel: row.channel, detail: row.detail, locale: row.locale }
);
```

Remove the `approvalEdit` import from `@ea/core` in this file (it is used through `renderNoticeEdit` now).

**Decisions.** D17.

**Test.** `channels-callbacks.test.ts`: every existing edit assertion holds (`tap.edit?.text` at lines 468, 487, 587, 968, 985) with the `queueFor` change of step 1. New cases:

1. A tap on an approval whose outbox row has `text` null (inserted by `insertOutbox` with a view and never sent) → the answer as today, `edit` is `undefined`.
2. A tap on a card whose stored text is `"📤 Send? Card"` → `edit.text` starts with `"📤 Send? Card\n\n"` (the card bytes are kept, nothing is rendered from the view).

**Check.** `bun test apps/server/test/integration/channels-callbacks.test.ts`.

**Done when.** The cases pass; `grep -n "approvalEdit(" apps/server/src` prints nothing; the Proof of `plan.md` with `NN` = `05` ends with `PROOF_OK`.

**Out of scope.** Editing other message kinds. F039 (edit of the approval message in place of a result notice).
