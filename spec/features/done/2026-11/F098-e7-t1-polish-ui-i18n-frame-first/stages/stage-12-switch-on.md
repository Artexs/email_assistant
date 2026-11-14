# F098 stage 12 — Switch on: every Telegram path in the user's language

Part of [`../plan.md`](../plan.md). Decisions: P2, D10, D12, D15, D16. Needs stage 11 landed. Review job before the land (the switch: every Telegram path, English byte-identical). Two steps.

After this stage Telegram speaks the user's language (`users.locale`, null → Polish).

## Step 1 — Drop the hold; English fixtures

**Goal.** `textsFor(locale)` returns the table of the locale (D10); old tests keep their English meaning (D15).

**Files.** `packages/core/src/texts/index.ts` (+ `index.test.ts`), `packages/core/src/notices/registry.test.ts` (the hold cases of stages 08 and 09), `apps/server/test/integration/fixtures.ts`, and any integration test that the run shows failing on a Polish text.

**Interfaces.**

- Delete `POLISH_MESSAGES_ON` and its comment; `textsFor = (locale) => textTables[locale]`.
- `createOrgWithMailbox` passes `locale: "en"` to `createOrganizationWithOwner`; `addMember` passes `locale: "en"` to `insertUser`. Comment once: `// Fixture users read English, so the text assertions keep their meaning; channels-locale.test.ts covers pl and null.`
- Run `bun run test:int:ci`. A test that now fails on a Polish text: give the user it creates `locale: "en"` at creation (one argument) and list the file in the final message. Never change an expected text.
- A test that asserts the null → `pl` rule of `LinkedChat` (`channels-linking.test.ts`, the cases near lines 201 and 270 at `3bdb753`, added by the notices-as-facts ticket): before its assert, set that user's `locale` to null with `db.updateTable("users")`, so it still proves the rule.

**Decisions.** D10, D15.

**Test.**

1. `texts/index.test.ts`: `textsFor("pl") === textTables.pl`; `textsFor("en") === textTables.en`.
2. `registry.test.ts`: for every kind, the `locale: "pl"` render differs from the `locale: "en"` render, and the `en` render equals the expectation of stages 08 and 09.

**Check.** `bun test packages/core/src`; `bun run test:int:ci`.

**Done when.** Both cases pass and the integration suite passes.

**Out of scope.** New locale tests (step 2). The activity route (stage 13).

## Step 2 — Every Telegram path in the user's language

**Goal.** Proof of Done when 6 in `plan.md`, end to end through the server.

**Files.** New: `apps/server/test/integration/channels-locale.test.ts`.

**Interfaces.** No production code. The test builds users with `locale` `'pl'`, null and `'en'` (`insertUser` with and without `locale`, or an update after `createOrgWithMailbox`), links their chats (`linkChat` of `fixtures.ts`), and drives the paths with the helpers that the existing files use: `channels-notices.test.ts` (detectors and `queueNotice`), `channels-sender.test.ts` (send and the stored `outbox.text`), `channels-digest-job.test.ts`, `channels-commands.test.ts`, `channels-callbacks.test.ts`, `telegram-router.test.ts` (the grammY bot with recorded calls). Copy their setup; do not invent new helpers when one exists.

**Decisions.** P2, D12, D16.

**Test.** `channels-locale.test.ts`, one `describe` per path; each case runs for the three users and expects `pl`, `pl`, `en`:

1. An urgent notice: after the send, `outbox.text` starts with `🔴 Pilna wiadomość` (pl) or `🔴 Urgent mail` (en); `outbox.locale` is `pl`, `pl`, `en`.
2. An approval request: the first line starts with `📤 Wysłać?` or `📤 Send?`; after an approve tap, the edited text is the stored card plus a Polish or English status line.
3. A scheduled digest: the queued view text starts with `📬 Podsumowanie` or `📬 Digest`.
4. `/help`: the reply equals `textTables[<expected>].bot.help`.
5. A tap on an undo button with nothing to undo: the answer equals `textTables[<expected>].answers.undo.nothing`.
6. `/start <used token>` from an unlinked chat (the token of the user): the reply equals `textTables[<expected>].bot.linkUsed`; `/start <expired token>`: `linkExpired`; `/start <new token>`: `linked`.
7. A suspended organization: `/status` answers `textTables[<expected>].bot.accountPaused(null)` (or with the configured contact).

**Check.** `bun test apps/server/test/integration/channels-locale.test.ts`.

**Done when.** Cases 1–7 pass for the three users.

**Out of scope.** Operator notices (P7).

## Stage done when

- Steps 1–2 are done. `grep -rn "POLISH_MESSAGES_ON" apps packages` finds nothing.
- The Proof chain for stages without page changes in `plan.md` § Proof (with `NN` = 12) prints `PROOF_OK`.
