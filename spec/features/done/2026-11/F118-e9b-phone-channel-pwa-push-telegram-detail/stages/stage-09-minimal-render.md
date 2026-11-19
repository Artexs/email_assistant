# F118 stage 09 — Minimal Telegram render `[risky]`

Part of [`../plan.md`](../plan.md). Needs 08b. No migration; nothing selects `minimal` yet (stage 10 does).

Carry-over reads: `plan.md` D12, D17; `interfaces.md` (`noticeFactsOf`, `renderNotice` minimal); `docs/code-patterns.md` § Notices are facts; `packages/core/src/notices/{kinds,renderers,render,views}.ts`, `registry.test.ts`; `packages/core/src/texts/`; `docs/capabilities/digest-and-notices.md` rules 4, 5, 13, 14.

## Step 1 — Every kind renders `minimal`

- **Goal:** `renderNotice(kind, view, { channel: "telegram", detail: "minimal", locale, webBaseUrl })` works for every kind of `noticeKinds`, with no view string in the text and no button.
- **Files:** `noticeDetails` gains `minimal`; the `NoticeRenderer` type makes `telegram.minimal` required (a later kind without one fails typecheck); `noticeFactsOf` covers every kind; one generic builder `minimalText(kind, facts, locale, webBaseUrl)` and a phrase table `packages/core/src/texts/minimal.ts` (one entry per kind, en and pl, with count plurals); `noticeEditRenderers` uses the full edit for `minimal` too (the edit line holds no view text).
- **Decisions (D12):**
  - Text = one emoji and the kind phrase with the count ("🔴 1 urgent mail", "📝 2 drafts wait for you"), then a line with the link `webBaseUrl + noticePath(kind, itemId)`; no `webBaseUrl` → the line "Open the panel" with no URL.
  - `digest`: header with the clock (a view fact), then counts per category of `NEEDS ACTION` and `OTHER MAIL`, the count of mailboxes with a problem, and the count of open loops when the brief is in the view; no item line, no footer text that quotes mail; then the link to `/activity`. `weekly_report`: the numbers only, then `/stats` (D17).
  - No button for any kind. `buttons: []`.
  - The `approval_edit` row of a `minimal` card: the stored text plus the status line, as today.
  - `loop_consent`: its own text is already minimal; the minimal render may equal it.
- **Test (unit, `registry.test.ts`):**
  1. Canary over every kind: fill every string field that the view schema allows with `CANARY<field>` (email ids and action ids stay UUIDs); render `minimal` in `en` and `pl` → the text holds no `CANARY`, no `@`, and `buttons` is `[]`. This is the F075 done-when line.
  2. The same fixtures render `full` exactly as before (snapshot of today's texts, byte for byte).
  3. `approval` minimal with `webBaseUrl` `https://ea.example.ts.net/` → the last line is `https://ea.example.ts.net/approvals?id=<action id>` (no double slash).
  4. `digest` minimal with 3 urgent and 2 info items → the counts 3 and 2, no subject, no sender, link `/activity`.
  5. `pl` minimal of `urgent` for counts 1, 2, 5 → three Polish plural forms.
  6. A test that lists `noticeKinds` against the phrase table: every kind has en and pl.
- **Mutation guard:** let one renderer print `view.subject` in `minimal`; test 1 fails; restore.

## Step 2 — Direct answers in minimal

- **Goal:** the bot's direct answers follow the detail too. The function that decides the detail of a chat (`telegramDetailOf`) returns `full` in this stage (stage 10 makes it real), so this step adds the branches and their tests with a fake detail.
- **Decisions:** `/digest` in `minimal` → the minimal digest text and no keyboard. `/review` in `minimal` → "The review is in the panel: <link to /review>" (en, pl), no items. `/status` in `minimal` names the mailboxes "Mailbox 1", "Mailbox 2" (in the order it lists them today) instead of their addresses, also in the approvals line; the rest stays (D12, Q4). A tap on an old `full` card answers as today: its text is already in that chat (D12).
- **Test (integration, fake detail `minimal`):**
  1. `/digest` → no subject or sender of the seeded mail, no keyboard.
  2. `/review` → the panel line, no AI summary.
  3. `/status` with two mailboxes → "Mailbox 1" and "Mailbox 2", no `@`; with the fake detail `full` → today's text byte for byte.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the column, the send-time choice (10), the setting (11, 12).
