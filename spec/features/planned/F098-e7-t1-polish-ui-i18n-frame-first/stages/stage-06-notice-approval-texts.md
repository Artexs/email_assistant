# F098 stage 06 — Notice and approval texts in English and Polish

Part of [`../plan.md`](../plan.md). Decisions: P6, P7, the glossary, D9, D10, D11, D16, D19. Needs stage 05 landed. Review job before the land (it reads every Polish text). Two steps.

After this stage every outbox notice kind renders from `packages/core/src/texts/` with the texts of the row's locale, through `textsFor(opts.locale)`. The hold of stage 05 still gives English to everyone, so the sent bytes do not change.

Rules for both steps:

- English entries are today's strings, moved verbatim. Every old test of these render functions keeps its expected text; it changes only by the added `texts` argument (`textTables.en`).
- Polish entries: translate by `plan.md` P6 and the glossary. Keep emoji, line breaks, `·` separators, `/status`, `SEND_SCOPE`, `mailbox:password`, `deploy/README.md`, `48 h`, `UIDPLUS`, folder names and the order of the lines. A name or an address never takes a Polish case ending: put it after a colon or in parentheses (`Zlecenie: Jan Kowalski jan@example.test`, not `Zlecenie dla Jana`). Counts use `pluralCategory` (stage 01) with `one`/`few`/`many` texts.
- The buttons and headings in the table below are fixed; copy them.

| en | pl |
| --- | --- |
| `🔴 Urgent mail` | `🔴 Pilna wiadomość` |
| `From:` / `Subject:` / `Received` | `Od:` / `Temat:` / `Odebrano` |
| `(no subject)` / `(unknown sender)` | `(bez tematu)` / `(nieznany nadawca)` |
| `🧪 test` | `🧪 test` |
| `✅ Right` / `✏️ Change` / `↩️ Undo` | `✅ Dobrze` / `✏️ Zmień` / `↩️ Cofnij` |
| `📤 Send` / `✖️ Reject` | `📤 Wyślij` / `✖️ Odrzuć` |
| `📤 Send all` / `✖️ Skip all` | `📤 Wyślij wszystkie` / `✖️ Pomiń wszystkie` |
| `📤 Send again` / `✅ It went out` / `✅ Done` | `📤 Wyślij ponownie` / `✅ Wysłano` / `✅ Gotowe` |
| `Draft:` / `Quoted original:` | `Szkic:` / `Cytowany oryginał:` |
| `📤 Send? Delegation to <name> <address>` | `📤 Wysłać? Zlecenie: <name> <address>` |
| `📤 Send? Question to the sender <address>` | `📤 Wysłać? Pytanie do nadawcy: <address>` |
| `📤 Send? Reminder to <name> <address>` | `📤 Wysłać? Przypomnienie: <name> <address>` |
| `Mailbox removed. Change its password in your mail provider's settings now.` | `Skrzynka usunięta. Zmień teraz jej hasło w ustawieniach dostawcy poczty.` |

## Step 1 — Common words and the notice kinds

**Goal.** `urgent`, `auth_error`, `sync_stale`, `sync_ok`, `action_failed` and `mailbox_removed` render per locale.

**Files.** New: `packages/core/src/texts/{common,notices}.ts`. Changed: `packages/core/src/texts/index.ts` (`CoreTexts.common`, `CoreTexts.notices`), `packages/core/src/digest/{text,notices}.ts` (+ tests), `packages/core/src/notices/{kinds,renderers}.ts` (+ `registry.test.ts`), `apps/server/src/modules/channels/texts.ts` (drop the `MAILBOX_REMOVED_TEXT` re-export), the tests that import `MAILBOX_REMOVED_TEXT` (`grep -rln MAILBOX_REMOVED_TEXT apps packages`: they read `textTables.en.notices.mailboxRemoved`), and every caller of `cleanSubject` / `senderLabel` that `bun run typecheck` lists.

**Interfaces.**

```ts
// texts/common.ts
export interface CommonTexts {
  from: string;          // "From"
  subject: string;       // "Subject"
  noSubject: string;     // "(no subject)"
  unknownSender: string; // "(unknown sender)"
  test: string;          // "🧪 test"
  right: string; change: string; undo: string; // the three feedback buttons
}
// digest/text.ts
export function cleanSubject(subject: string | null, texts: CoreTexts): string;
export function senderLabel(from: string | null, texts: CoreTexts): string;

// texts/notices.ts — one entry per line that a notice prints; functions for lines with values.
export interface NoticeTexts {
  urgentTitle: string;                                  // "🔴 Urgent mail"
  received: (clock: string) => string;                  // `Received ${clock}`
  authError: { first: (address: string, since: string) => string; noRead: string; fix: (mailboxId: string) => string };
  syncStale: { first: (address: string) => string; last: (last: string) => string; status: string; never: string };
  syncOk: (address: string, last: string) => string;
  actionFailed: {
    first: Record<"move" | "flag" | "mark_read" | "create_draft", { original: string; reverse: string }>;
    toFolder: (folder: string) => string;               // " to <folder>" appended in English; Polish: " do <folder>"
    tried: (count: number) => string;                   // en: `Tried ${n} ${n === 1 ? "time" : "times"}.`; pl: `Próbowano ${n} ${raz|razy|razy}.` by pluralCategory
    notFound: string; badPayload: (folder: string) => string; staysIn: (folder: string) => string;
    staysInAiFolder: (folder: string | null) => string; draftStays: string; status: string;
  };
  mailboxRemoved: string;
}
```

Shape the `actionFailed` entries so `renderActionFailedNotice` keeps its exact English output for every branch (read it: `digest/notices.ts:95-134`); add an entry when a branch needs one, and say so in the final message.

- Every render function in `digest/notices.ts` takes `texts: CoreTexts` last and uses `formatClock(…, texts.locale)` and `cleanSubject`/`senderLabel` with `texts`; `feedbackButtons(emailId, category, texts)` reads the button texts from `texts.common` (the `undo` button stays opt-in: a third argument `{ undo: boolean }` or the existing shape; keep the callers' behaviour).
- `kinds.ts`: `MAILBOX_REMOVED_TEXT` is removed.
- `renderers.ts`: each entry calls `const texts = textsFor(opts.locale);` and passes it; remove the comment "en texts for both locales until E7-T1…".
- Callers outside this step's files that print `cleanSubject`/`senderLabel` (`digest/digest.ts`, `digest/approvals.ts`, `channels/callbacks.ts`) pass `textTables.en` or `textsFor(link.locale)` (callbacks) until their stage.

**Decisions.** D9, D10, D11.

**Test.**

1. `digest/notices.test.ts`: every old case with `textTables.en`, same expected text.
2. New `pl` cases with fixed inputs (`timeZone: "Europe/Warsaw"`, `now = 2026-11-14T11:00:00Z`, `receivedAt = 2026-11-14T10:15:00Z`): `renderUrgentNotice` pl → first line `🔴 Pilna wiadomość`, a line `Od: …`, a line `Temat: …`, a line `Odebrano 11:15`; buttons `✅ Dobrze`, `✏️ Zmień` with the same callback data as the en buttons. `renderSyncStaleNotice` pl with `lastSyncedAt: null` contains the `never` text and `/status`. `renderActionFailedNotice` pl for `move` original, attempts 1, 2, 5 → the lines hold `Próbowano 1 raz.`, `Próbowano 2 razy.`, `Próbowano 5 razy.` (fix these three texts). `renderAuthErrorNotice` pl contains `mailbox:password` and the mailbox id.
3. `registry.test.ts`: for every kind, `renderNotice(kind, <its sample view>, { channel: "telegram", detail: "full", locale: "pl" })` equals the `locale: "en"` result while the hold is on (stage 08 turns this case around). And a direct call of each entry with `textTables.pl` returns `ok` text of at most `MESSAGE_MAX_CHARS`.
4. `text.test.ts`: `cleanSubject(null, textTables.pl)` → `"(bez tematu)"`; `senderLabel("", textTables.pl)` → `"(nieznany nadawca)"`.

**Check.** `bun test packages/core/src`; `bun run typecheck`; `bun test apps/server/test/integration/channels-notices.test.ts apps/server/test/integration/channels-sender.test.ts apps/server/test/integration/mail-remove.test.ts apps/server/test/integration/delete-mailbox.test.ts`.

**Done when.** Cases 1–4 pass; the integration files pass unchanged except the `MAILBOX_REMOVED_TEXT` import.

**Out of scope.** Approvals (step 2), the digest (stage 07).

## Step 2 — Approvals, the reminder set, send results, answered delegations, the tap edit

**Goal.** `approval`, `approval_set`, `send_result`, `delegation_answered` and the status line after a tap render per locale (D16, D19).

**Files.** New: `packages/core/src/texts/approvals.ts`. Changed: `packages/core/src/texts/index.ts`, `packages/core/src/digest/approvals.ts` (+ `approvals.test.ts`), `packages/core/src/notices/{renderers,render}.ts`, `apps/server/src/modules/channels/callbacks.ts` (the `renderNoticeEdit` call keeps passing the row's `locale`; nothing else here).

**Interfaces.**

- `texts/approvals.ts`: an `ApprovalTexts` interface with one entry per fixed string or line of `digest/approvals.ts` (titles, `inactive`, `externalSender`, `due`, `draft`, `bodyCut`, `quoted`, `linksHidden`, `quoteCut`, `sendLine`, the set header by count, `reminderOf`, `task`, the set footer lines, the buttons of the table above, `CLOSINGS`, the five cause lines, every `first` line of `renderSendResult`, the `rest` lines, `HELD_TEXTS`, the four status lines of `approvalEdit`, and the answered-delegation lines). Group them as you like; one entry per sentence.
- Every exported render function of `digest/approvals.ts` takes `texts: CoreTexts` last: `renderApprovalRequest(input, texts)`, `renderApprovalSetRequest(input, texts)`, `renderSendResult(input, texts)`, `renderDelegationAnswered(input, texts)`, `approvalEdit(input, texts)`. `formatClock`/`formatDay` get `texts.locale`.
- `cutLinks` prints `texts.common.noSubject` for an empty subject.
- `renderers.ts`: `textsFor(opts.locale)` for these kinds; `send_result` maps a null address to `texts.common.unknownSender` wrapped as today (`"(unknown)"` stays the English value: add `common.unknownAddress` = `"(unknown)"` / `"(nieznany)"`).
- `render.ts`: `noticeEditRenderers.telegram.full = (input, opts) => approvalEdit(input, textsFor(opts.locale))`.
- D19 (the stored English sender placeholder): an approval view stores `sender.label` from `senderLabel(…, textTables.en)` at queue time (`outgoing/sender.ts:47`), so an unknown sender is the English `"(unknown sender)"` inside the view. `renderApprovalRequest` prints `texts.common.unknownSender` when `view.sender.label === textTables.en.common.unknownSender`. The view schema does not change (rows of the last 24 h must still render). Comment: `// The view stores the English placeholder (plan D19); the renderer prints it in the row's language.`
- The `MESSAGE_MAX_CHARS` shrink loop of `renderApprovalRequest` works on the built text, so a longer Polish text only shrinks the quote earlier; keep the loop as it is.
- The `SENDER_LINE` pattern already knows `Od:`; do not change it.

**Decisions.** D9, D10, D11, D16, D19.

**Test.** `approvals.test.ts`:

1. Every old case with `textTables.en`, same expected text and buttons.
2. `pl` approval request (kind `delegation`, recipient name `Jan Kowalski`, address `jan@example.test`, a 200-character body, a quote): first line `📤 Wysłać? Zlecenie: Jan Kowalski jan@example.test`; lines `Szkic:` and `Cytowany oryginał:`; buttons `📤 Wyślij`, `✖️ Odrzuć` with the en callback data.
3. `pl` approval request with a body and a quote whose en text is exactly `MESSAGE_MAX_CHARS` long after the shrink: the pl text is at most `MESSAGE_MAX_CHARS` and holds the quote-cut note.
4. `pl` approval request with `sender.label = "(unknown sender)"` → the line `Od: (nieznany nadawca)`; en → `From: (unknown sender)` (unchanged).
5. `pl` reminder set with 1, 3 and 5 items → the first lines `📤 Wysłać 1 przypomnienie?`, `📤 Wysłać 3 przypomnienia?`, `📤 Wysłać 5 przypomnień?` (fix these three texts); buttons `📤 Wyślij wszystkie`, `✖️ Pomiń wszystkie`.
6. `pl` send result for each `result.kind` (and each `expired` reason) → a non-empty first line that starts with the same emoji as the en line; `outcome_unknown` for a delegation has the buttons `📤 Wyślij ponownie` and `✅ Wysłano`.
7. `approvalEdit` pl for each outcome → the stored text plus one Polish status line; the en case unchanged.
8. `notices/registry.test.ts`: the hold case of step 1 also covers these kinds and `renderNoticeEdit`.

**Check.** `bun test packages/core/src`; `bun run typecheck`; `bun test apps/server/test/integration/channels-callbacks.test.ts apps/server/test/integration/channels-notices.test.ts apps/server/test/integration/channels-sender.test.ts`.

**Done when.** Cases 1–8 pass; the integration files pass unchanged.

**Out of scope.** Tap answers and bot replies (stage 07). The outgoing mail templates (P7).

## Stage done when

- Steps 1–2 are done. `grep -n 'From: \|Subject: \|Draft:\|Received ' packages/core/src/digest/notices.ts packages/core/src/digest/approvals.ts` finds only comments (every English line comes from `texts`).
- The Proof chain for stages without page changes in `plan.md` § Proof (with `NN` = 06) prints `PROOF_OK`.
- The final message lists any `ApprovalTexts` or `NoticeTexts` entry you added beyond the interfaces above.
