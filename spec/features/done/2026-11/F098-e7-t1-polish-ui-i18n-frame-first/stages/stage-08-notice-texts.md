# F098 stage 08 — Notice texts in English and Polish

Part of [`../plan.md`](../plan.md). Decisions: P6, P7, the glossary, D9, D10, D11. Needs stage 07 landed. Review job before the land (it reads every Polish text). One step.

After this stage and stage 09 every outbox notice kind renders from `packages/core/src/texts/` with the texts of the row's locale, through `textsFor(opts.locale)`. The hold of stage 06 still gives English to everyone, so the sent bytes do not change.

Rules for this stage and stage 09:

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
3. `registry.test.ts`: for every kind, `renderNotice(kind, <its sample view>, { channel: "telegram", detail: "full", locale: "pl" })` equals the `locale: "en"` result while the hold is on (stage 12 turns this case around). And a direct call of each entry with `textTables.pl` returns `ok` text of at most `MESSAGE_MAX_CHARS`.
4. `text.test.ts`: `cleanSubject(null, textTables.pl)` → `"(bez tematu)"`; `senderLabel("", textTables.pl)` → `"(nieznany nadawca)"`.

**Check.** `bun test packages/core/src`; `bun run typecheck`; `bun test apps/server/test/integration/channels-notices.test.ts apps/server/test/integration/channels-sender.test.ts apps/server/test/integration/mail-remove.test.ts apps/server/test/integration/delete-mailbox.test.ts`.

**Done when.** Cases 1–4 pass; the integration files pass unchanged except the `MAILBOX_REMOVED_TEXT` import.

**Out of scope.** Approvals (stage 09), the digest (stage 10).

## Stage done when

- Step 1 is done. `grep -n 'From: \|Subject: \|Received ' packages/core/src/digest/notices.ts` finds only comments.
- The Proof chain for stages without page changes in `plan.md` § Proof (with `NN` = 08) prints `PROOF_OK`.
- The final message lists any `NoticeTexts` entry you added beyond the interface.
