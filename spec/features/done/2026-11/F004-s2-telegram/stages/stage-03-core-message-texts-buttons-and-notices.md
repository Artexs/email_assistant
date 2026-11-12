# s2-telegram — Stage 3

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 3 — Core: message model, text helpers, button data, notice texts

- [x] **3.1 Message model, text helpers, category labels, AI folder names**
  - Goal: one channel-neutral message shape and safe, short texts from untrusted mail fields (D1).
  - Files: create `packages/core/src/digest/message.ts`, `packages/core/src/digest/text.ts`, `packages/core/src/digest/text.test.ts`, `packages/core/src/digest/labels.ts`; change `packages/core/src/digest/index.ts`, `packages/core/src/triage/untrusted-text.ts` (+ its test), `packages/core/src/triage/planners.ts` (+ its test), `apps/server/src/modules/mail/connect.ts`.
  - Interfaces:
    - `message.ts`: `interface OutButton { text: string; data: string }`; `interface OutMessage { text: string; buttons: OutButton[][] }` (rows of buttons; `[]` = no keyboard); `const MESSAGE_MAX_CHARS = 4096`; `const CALLBACK_MAX_BYTES = 64`; `const outButtonsSchema = z.array(z.array(z.object({ text: z.string().min(1), data: z.string().min(1) })))` (stage 10 parses `outbox.buttons` with it).
    - `text.ts`: `cutText(text: string, max: number): string`; `cleanSubject(subject: string | null): string`; `senderLabel(from: string | null): string`.
    - `labels.ts`: `const categoryLabels: Record<Category, { emoji: string; name: string }>` and `categoryTag(category: Category): string` (`` `${emoji} ${name}` ``).
    - `untrusted-text.ts`: `removeLinks(text: string): string` (the existing `URL_PATTERN` → `"[link]"`); `markUntrustedText` does not change.
    - `planners.ts`: `const AI_FOLDER_NAMES: Record<FolderKey, string> = { ai_info: "AI/Info", ai_notifications: "AI/Notifications", ai_spam: "AI/Spam", ai_manual: "AI/Manual" }`.
  - Decisions:
    - `cutText`: (1) every control character `[\u0000-\u001f\u007f-\u009f]` (also new lines and tabs) → one space; (2) remove the bidi and invisible characters `[\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]` (a subject with a right-to-left override could fake the text order); (3) replace every lone surrogate (`/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g`) with `\ufffd` (broken decoding in a mail header; Telegram can refuse such text); (4) collapse whitespace runs to one space and trim; (5) count code points (`Array.from`); more than `max` → the first `max − 1` code points and `…`, so a surrogate pair is never cut in half. Use template literals (no `+`). Every mail-derived text in a message passes `cutText` (directly or through `cleanSubject` / `senderLabel`), so no message holds a NUL byte (Postgres text refuses it) or a control character.
    - `cleanSubject`: `null` or empty after cleaning → `"(no subject)"`; else `cutText(removeLinks(subject), 80)`.
    - `senderLabel`: `null` or empty → `"(unknown sender)"`; else `cutText(from, 40)` (the address stays: the sender is allowed content, ADR 0005).
    - `categoryLabels`: urgent `🔴 Urgent`, needs_reply `✉️ Reply`, delegation `👥 Delegate`, unsure `❓ Unsure`, info `ℹ️ Info`, notification `🔔 Notification`, spam `🚫 Spam`.
    - `connect.ts`: `AI_FOLDERS` becomes `AI_FOLDER_NAMES` from `@ea/core` (same keys and values, one source for the digest texts and the folder map).
  - Test:
    - `text.test.ts`: `cutText("a\nb\tc", 10)` → `"a b c"`; a right-to-left override `\u202e` is removed; `cutText("x".repeat(100), 10)` → 9 × `x` + `…`; a string of 20 emoji cut to 5 → 4 emoji + `…` and no lone surrogate (check with a regex for lone surrogates); `cutText("a\ud800b", 10)` → `"a\ufffdb"`; `cutText("a\u0000b", 10)` → `"a b"`; `cleanSubject(null)` → `"(no subject)"`; `cleanSubject("  ")` → `"(no subject)"`; `cleanSubject("Pay at https://evil.example/x now")` → `"Pay at [link] now"`; `senderLabel(null)` → `"(unknown sender)"`.
    - `untrusted-text.test.ts`: `removeLinks("see www.a.pl and http://b.pl/c")` → `"see [link] and [link]"`.
    - `planners.test.ts`: the keys of `AI_FOLDER_NAMES` equal `folderKeys`.
    - The existing `mail-connect.test.ts` passes without change (same folder map).
  - Check: `bun run lint && bun run typecheck && bun run test:unit`; with DB: `bun run dev:up && bun run db:migrate && bun run test:int` (for `mail-connect.test.ts`).
  - Done when: the tests pass.
  - Out of scope: the digest layout (stage 4).

- [x] **3.2 Button data, "would do" text, AI text**
  - Goal: pure rules for the ✅ / ✏️ button data (≤ 64 bytes), the "what the system would do" line, and the AI text of a line (P5, D10).
  - Files: create `packages/core/src/digest/callback.ts`, `packages/core/src/digest/callback.test.ts`, `packages/core/src/digest/would-do.ts`, `packages/core/src/digest/would-do.test.ts`, `packages/core/src/digest/ai-text.ts`, `packages/core/src/digest/ai-text.test.ts`; export from `packages/core/src/digest/index.ts`.
  - Interfaces:
    - `callback.ts`:
      - `const labelCategories = ["urgent", "needs_reply", "info", "notification", "spam"] as const` (the categories a user may pick; the same five as `triage:label`); `type LabelCategory`; `isLabelCategory(category: Category): category is LabelCategory`.
      - `type FeedbackCallback = { kind: "right"; category: LabelCategory; emailId: string } | { kind: "edit"; emailId: string } | { kind: "pick"; category: LabelCategory; emailId: string } | { kind: "cancel"; emailId: string }`.
      - `encodeCallback(callback: FeedbackCallback): string`; `parseCallback(data: string): FeedbackCallback | null`.
    - `would-do.ts`: `interface ActionView { type: ActionType; status: string; folder: FolderKey | null }`; `describeActions(actions: readonly ActionView[]): string`.
    - `ai-text.ts`: `interface AiTextInput { category: Category; reasonCode: string; reason: string | null; summary: string | null; modelCategory: Category | null; confidence: number }`; `aiTextFor(input: AiTextInput): string | null`.
  - Decisions:
    - Button data formats (ASCII; the e-mail id is a lower-case canonical uuid, 36 characters): right `fr:<code>:<emailId>`, edit `fe:<emailId>`, pick `fc:<code>:<emailId>`, cancel `fx:<emailId>`. Codes: urgent `u`, needs_reply `r`, info `i`, notification `n`, spam `s`. Longest = 41 bytes. `encodeCallback` throws a plain `Error("bad email id")` when the id is not a lower-case canonical uuid. `parseCallback` accepts only `^(fr|fc):([urins]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$` and `^(fe|fx):(<same uuid>)$`; everything else → null (old or forged data).
    - `describeActions`: ignore `save_summary`. Phrase: `flag` → `"flag"`; `mark_read` → `"mark read"`; `move` → `` `move to ${AI_FOLDER_NAMES[folder]}` `` (folder null → `"move"`). Tense from the status: `logged` → `"would"`; `ready`, `applying`, `awaiting_approval`, `approved` → `"will"`; `applied` → `"done:"`; `undone` → `"undone:"`; `failed` → `"failed:"`; `rejected`, `expired` and unknown statuses → left out. Group the phrases by tense in first-seen order: `` `${tense} ${phrases.join(", ")}` ``, groups joined with `"; "`. No phrase at all → `"stays in INBOX"`.
    - `aiTextFor`, the first rule that fits wins: (1) `reasonCode` `triage_error` → `"AI triage failed 3 times."`; (2) `llm_blocked` → `"The AI safety filter blocked this mail."`; (3) `blocklist` → `"The sender is on your blocklist."`; (4) `category` `unsure` and `modelCategory` not null (below the threshold) → `` `${reason ?? "No reason given."} (AI guess: ${categoryLabels[modelCategory].name}, ${Math.round(confidence * 100)}%)` ``; (5) `info` → `summary ?? reason`; (6) else → `reason`. No cut here (the renderers cut). The summary and the reason are already marked by `markUntrustedText` (S1b classifier).
  - Test:
    - `callback.test.ts`: encode → parse round trip for all four kinds and all five codes; every encoded value is ≤ `CALLBACK_MAX_BYTES` bytes (`Buffer.byteLength`); `parseCallback` returns null for `""`, `"fr:x:<uuid>"`, `"fr:u:<UPPER-CASE uuid>"`, `"fe:<uuid>:x"`, `"zz:<uuid>"`; `encodeCallback` with `"not-a-uuid"` throws.
    - `would-do.test.ts`: `[flag logged]` → `"would flag"`; `[save_summary ready, move ai_info logged]` → `"would move to AI/Info"`; `[mark_read logged, move ai_notifications logged]` → `"would mark read, move to AI/Notifications"`; `[]` → `"stays in INBOX"`; `[flag applied, move ai_info logged]` → `"done: flag; would move to AI/Info"`; `[move (folder null) logged]` → `"would move"`; `[flag rejected]` → `"stays in INBOX"`.
    - `ai-text.test.ts`: each of the six rules with one case; rule 4 with reason null → `"No reason given. (AI guess: Info, 55%)"` for confidence 0.55; rule 5 with summary null → the reason.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass.
  - Out of scope: writing feedback (stage 16).

- [x] **3.3 Notice texts**
  - Goal: the exact texts and buttons of the four notice kinds (urgent, `auth_error`, sync late, sync works again).
  - Files: create `packages/core/src/digest/notices.ts`, `packages/core/src/digest/notices.test.ts`; export from `packages/core/src/digest/index.ts`.
  - Interfaces:
    - `feedbackButtons(emailId: string, category: Category, texts: { right: string; edit: string }): OutButton[]` — `[right, edit]` when `isLabelCategory(category)`, else only `[edit]`; right data = `encodeCallback({ kind: "right", category, emailId })`, edit data = `encodeCallback({ kind: "edit", emailId })`.
    - `renderUrgentNotice(input: { emailId: string; from: string | null; subject: string | null; aiText: string | null; receivedAt: Date; synthetic: boolean; wouldDo: string; now: Date; timeZone: string }): OutMessage`
    - `renderAuthErrorNotice(input: { address: string; mailboxId: string; since: Date; now: Date; timeZone: string }): OutMessage`
    - `renderSyncStaleNotice(input: { address: string; lastSyncedAt: Date | null; now: Date; timeZone: string }): OutMessage`
    - `renderSyncOkNotice(input: { address: string; lastSyncedAt: Date; now: Date; timeZone: string }): OutMessage`
  - Decisions (exact texts; lines joined with `\n`; `clock(x)` = `formatClock(x, timeZone, now)`; `address` = `cutText(address, 60)`):
    - Urgent (buttons: one row `feedbackButtons(emailId, "urgent", { right: "✅ Right", edit: "✏️ Change" })`):
      ```
      🔴 Urgent mail            (+ " · 🧪 test" when synthetic)
      From: <senderLabel(from)>
      Subject: <cleanSubject(subject)>
      💬 <cutText(aiText, 200)>   (line left out when aiText is null)
      Received <clock(receivedAt)>
      → <wouldDo>
      ```
    - `auth_error` (no buttons):
      ```
      ❌ Login to <address> failed at <clock(since)>.
      The system does not read this mailbox now. No mail is lost: it stays on the mail server.
      To fix it: check the password, then run mailbox:password for mailbox <mailboxId> (runbook: deploy/README.md).
      ```
    - Sync late (no buttons): `⚠️ Mail sync is late for <address>.` / `Last good sync: <clock(lastSyncedAt) or "never">. The system tries again every 5 minutes.` / `/status shows the state.`
    - Sync works again (no buttons): `✅ Mail sync works again for <address>. Last sync <clock(lastSyncedAt)>.`
    - The mailbox address is the user's own address, not mail content (allowed). No mail body ever.
  - Test (`notices.test.ts`, `Europe/Warsaw`, now `2026-11-06T07:00Z`): the urgent text has the 6 lines in this order and `Received 07:42` for `receivedAt` `06:42Z`; aiText null → no `💬` line; synthetic → first line ends with `· 🧪 test`; buttons `[[{ text: "✅ Right", data: "fr:u:<id>" }, { text: "✏️ Change", data: "fe:<id>" }]]`; a 10 000-character subject and from give a text ≤ 4096 characters and a subject line of at most 80 code points after `Subject: `; `feedbackButtons(id, "unsure", …)` → only the edit button; the `auth_error` text contains the address, the mailbox id and `at 07:40`; sync late with `lastSyncedAt` null → `Last good sync: never.`; sync works again contains `Last sync 07:55`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass.
  - Out of scope: when a notice is made and to whom (stage 12); sending (stage 11).
