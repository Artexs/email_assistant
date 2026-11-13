# F088 stage 04 — The sender renders at send time [risky]

Part of [`../plan.md`](../plan.md). `[risky]`: it changes what every user receives and the send path. Decisions: D2, D15, D17, D18, D24. Needs stage 03 landed. Review job before the land; after the land, the group review of stages 02–04 and owner checkpoint C1. Three steps.

## Step 1 — The queue stops storing the text

**Goal.** A new row has `text` null and `buttons` `[]` until it is sent (D2).

**Files.** `apps/server/src/modules/channels/repo.ts`, `apps/server/src/modules/channels/notice-queue.ts`, the test files that call `insertOutbox` with `message` (`bun run typecheck` lists them: `channels-outbox`, `channels-sender`, `channels-callbacks`, `delegation-schema`, `delete-mailbox`, `mail-remove`), and a new helper in `apps/server/test/integration/fixtures.ts`.

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
  - `delete-mailbox.test.ts` (line 48), `delegation-schema.test.ts`, `channels-outbox.test.ts` `rowFor` (line 39): `view` and `locale` instead of `message`; a digest row gets `view: { text: <its old text>, buttons: [] }`, other kinds `view: {}` (these tests check constraints and status changes, not texts). Where a test then reads `text` of a pending row (`delete-mailbox` `outboxText` line 129: `"Digest of B"`), read `renderedOf(row).text` instead.
- Test helpers that read texts of queued rows: `channels-notices.test.ts` `rows` (line 100) and `channels-digest-job.test.ts` `outbox` (line 81) select `kind`, `view`, `channel`, `detail`, `locale`, `text`, `buttons`, and map each row to `{ ...row, ...renderedOf(row) }`, so `row.text` and `row.buttons` keep their meaning for every existing assertion.

**Decisions.** D2, D15.

**Test.** All existing assertions of `channels-notices`, `channels-digest-job`, `channels-callbacks`, `channels-sender`, `mail-remove`, `delete-mailbox` hold with only the helper changes above. New case in `channels-outbox.test.ts`: a `queueNotice` row has `text` null and `buttons` `[]`.

**Check.** `bun test apps/server/test/integration/channels-*.test.ts apps/server/test/integration/mail-remove.test.ts apps/server/test/integration/delete-mailbox.test.ts apps/server/test/integration/delegation-schema.test.ts` after step 2 (the sender must render before these tests can send).

**Done when.** Step 2 is done and the check passes.

**Out of scope.** Old rows with text (step 2 sends them as they are).

## Step 2 — The sender renders; `bad_view`

**Goal.** The sender renders a row from `view`, `channel`, `detail` and `locale`; the stored text equals the sent text; a row that does not render fails as `bad_view` (ticket acceptance lines 2 and 3).

**Files.** `apps/server/src/modules/channels/sender.ts`, `apps/server/test/integration/channels-sender.test.ts`.

**Interfaces.** In `run()`, replace the stage 02 guard (`if (row.text === null) { … "no text" … }`) with:

```ts
// A row from before send-time rendering keeps its text; every other row is rendered now (ADR 0032 point 5).
let message: OutMessage;
if (row.text !== null) {
  message = { text: row.text, buttons: row.buttons };
} else {
  const rendered = renderNotice(row.kind, row.view, { channel: row.channel, detail: row.detail, locale: row.locale });
  if (!rendered.ok) {
    await fail(row, "bad_view");
    log.error(`outbox ${row.id}: bad view (${row.kind})`);
    continue;
  }
  message = rendered.message;
}
```

Place: right after the 24 h `expired` check, before the time zone lookup and the quiet hours (D18). Then `channel.send(link.chatId, message)` and `markOutboxSent(trx, ctx, row.id, row.lockedAt, { messageId, at: now, message })`. Nothing else in the sender changes: the claim, the quiet hours, the per-user limit, the error handling and the digest mark stay as they are. Do not log `message`, `row.view` or the render result.

**Decisions.** D18, D24.

**Test.** `channels-sender.test.ts`, new cases (use the `allLines()` log capture the file already has):

1. A `queueNotice` urgent row (`subject: "MARKER-F088"`): after one run, the fake channel got one message; the row is `sent`; `outbox.text` equals the sent `message.text` and `outbox.buttons` deep-equals the sent `message.buttons`; no log line contains `MARKER-F088`.
2. A row inserted with `view: {}` and kind `urgent` (it has no fields of the urgent view): after one run it is `failed` / `bad_view`; nothing was sent; exactly one log line contains `bad view (urgent)` and the row id; no line contains `{` from the view.
3. Compatibility: a row whose `text` and `buttons` are set by a raw `UPDATE` (`text = 'Old text'`, `buttons = '[[{"text":"OK","data":"ok"}]]'`) and whose `view` is `{}` → sent with exactly that text and button; the row stays `text = 'Old text'`.
4. A stale `sending` row with `text` null and a valid view (claim it once, set `locked_at` older than `SENDER_STALE_MS` by a raw `UPDATE`, as the test "a stale sending row is sent again" at line 396 does) → sent; the warning line of a stale send appears; the stored text equals the sent text.
5. A `pl` row (`locale = 'pl'`) renders the same English text as an `en` row with the same view (D16, until E7-T1).
6. A row held by the quiet hours (reuse the setup of line 203) is released with `text` still null; at the end of the quiet hours it is rendered and sent.

**Check.** `bun test apps/server/test/integration/channels-sender.test.ts`.

**Done when.** Cases 1–6 and the old cases pass.

**Out of scope.** Choosing the channel or detail level from the user's settings (E9b). Send-time `now` (D12).

## Step 3 — The tap edit through the registry

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

**Done when.** The cases pass; `grep -n "approvalEdit(" apps/server/src` prints nothing; the Proof of `plan.md` with `NN` = `04` ends with `PROOF_OK`.

**Out of scope.** Editing other message kinds. F039 (edit of the approval message in place of a result notice).
