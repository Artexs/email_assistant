# F098 stage 11 — Bot replies, taps, link replies and the command menu in English and Polish

Part of [`../plan.md`](../plan.md). Decisions: P2, P6, P7, the glossary, D9, D10, D11, D12, D20. Needs stage 10 landed. Review job before the land (it reads every Polish text). Two steps.

The translation rules and fixed words of stages 08 and 10 apply here. After this stage every text that a user reads in Telegram comes from `packages/core/src/texts/`, and every Telegram path asks `textsFor` with the right locale: the row's locale for notices, the chat's locale for replies and taps, the token owner's locale for link replies. The hold of stage 06 still gives English to everyone. `apps/server/src/modules/channels/texts.ts` is gone.

## Step 1 — Bot replies, `/status`, pause and resume, tap answers, link replies

**Goal.** Every direct reply of the bot comes from `texts.bot` in the chat's locale (D12).

**Files.** New: `packages/core/src/texts/bot.ts`, `packages/core/src/texts/bot.test.ts`. Changed: `packages/core/src/texts/index.ts`; `apps/server/src/modules/channels/{commands,callbacks,linking}.ts`, `apps/server/src/modules/channels/telegram/bot.ts`; deleted: `apps/server/src/modules/channels/texts.ts` and `texts.test.ts` (their cases move to `bot.test.ts`); tests that import the old constants (`telegram-router.test.ts`, `channels-commands.test.ts`, `channels-callbacks.test.ts`: read `textTables.en.bot.*` instead; nothing else changes).

**Interfaces.**

```ts
// texts/bot.ts
export interface BotTexts {
  help: string;                                  // today's helpText() lines joined with "\n"
  linked: string; alreadyLinked: string;          // today's LINKED_TEXT, ALREADY_LINKED_TEXT (they end with help)
  linkUsed: string; linkExpired: string; error: string;
  accountPaused: (operatorContact: string | null) => string;
  status: { … };      // every line of statusMessage, approval lines, mailbox state words, SCOPE_TEXTS of commands.ts
  switch: { … };      // pause/resume: OWNER_ONLY_TEXT, already, login error, the two explanation lines, "No mailbox connected."
  taps: { … };        // APPROVAL_TEXTS of callbacks.ts, the picker text and buttons, "✏️ Cancelled.", "This button is not valid any more.", the reminder-set answers
}
```

Move each English string verbatim; one entry per sentence; functions for strings with values; counts by `pluralCategory`.

- `commands.ts`: `runCommand(deps, link, name)` and `createUpdateHandlers` read `const texts = textsFor(link.locale)`; `/help` returns `texts.bot.help`; the suspended answer is `texts.bot.accountPaused(deps.operatorContact)`; `formatClock`/`formatDay` with `texts.locale` (remove the stage-06 interim comments).
- `callbacks.ts`: one `textsFor(link.locale)` per tap; every answer and edit text from `texts.bot.taps` (or `texts.answers`, `texts.common` where stages 06–09 put them).
- `linking.ts`: `ConsumeResult` becomes `{ kind: "linked"; orgId; userId } | { kind: "used"; userId: string } | { kind: "expired"; userId: string } | { kind: "unknown" }` (`findLinkToken` in `channels/repo.ts:116` selects `used_at` and `expires_at` only: add `user_id` to its select and its return type `userId`).
- `telegram/bot.ts` (D12):
  - `linked`: `textsFor(await localeOfUser(result.userId)).bot.linked`.
  - `used`: the chat is linked → `textsFor(link.locale).bot.alreadyLinked`; else `textsFor(await localeOfUser(result.userId)).bot.linkUsed`.
  - `expired`: `textsFor(await localeOfUser(result.userId)).bot.linkExpired`.
  - `/start` without a payload or with an unknown token in a linked chat: `textsFor(link.locale).bot.help`.
  - Command and tap failures: `textsFor(linkOf(ctx).locale).bot.error`; any other message of a linked chat: `.bot.help`.
  - `localeOfUser(userId)` = `(await getUserAuthProfile(db, userId))?.locale ?? "pl"` (import from `../../tenancy`; the `pl` default is plan P2). A failed read falls back to `"pl"` and logs `log.warn("telegram_locale_read_failed", { user_id: userId, ...errorFields(error) })` (the form of `platform/http.ts` `tenant_multi_membership`; `docs/code-patterns.md` § Logs).

**Decisions.** D9, D10, D11, D12, P2.

**Test.**

`bot.test.ts` (core):

1. `textTables.en.bot.help` equals today's `helpText()` output byte for byte (copy the old `texts.test.ts` expectations); `linked`, `alreadyLinked` end with `help`.
2. `textTables.pl.bot.help` names `/digest`, `/status`, `/pause`, `/resume`, `/help`, each once; starts with `Polecenia:`.
3. `accountPaused(null)` and `accountPaused("ops@example.test")` for en (today's texts) and pl (the table above).

Integration:

4. `channels-linking.test.ts`: `consumeLinkToken` of a used token → `{ kind: "used", userId: <owner> }`; of an expired token → `{ kind: "expired", userId: <owner> }`; unknown → `{ kind: "unknown" }`. Old cases that compared `{ kind: "used" }` or `{ kind: "expired" }` get the `userId`; nothing else.
5. `telegram-router.test.ts`, `channels-commands.test.ts`, `channels-callbacks.test.ts`: every old case passes with the English texts (the hold).

**Check.** `bun test packages/core/src/texts`; `bun run typecheck`; `bun test apps/server/test/integration/channels-linking.test.ts apps/server/test/integration/telegram-router.test.ts apps/server/test/integration/channels-commands.test.ts apps/server/test/integration/channels-callbacks.test.ts apps/server/test/integration/channels-digest-job.test.ts`. `channels` imports `tenancy` already (`commands.ts:32`), so the module graph does not change.

**Done when.** Cases 1–5 pass. `grep -rn '"Commands:\|Something went wrong\|Already saved' apps/server/src --include=*.ts | grep -v '\.test\.ts'` finds nothing (`polling.test.ts` has `setMyCommands:`, which is not a text).

**Out of scope.** Operator notices (`channels/operator.ts`, plan P7). The switch (stage 12). The command menu (step 2).

## Step 2 — The command menu per Telegram language

**Goal.** The "/" menu of the bot shows Polish descriptions to Polish Telegram apps (D20).

**Files.** `apps/server/src/modules/channels/telegram/polling.ts` (+ `polling.test.ts`), `packages/core/src/texts/bot.ts`.

**Interfaces.**

- `texts.bot.commands: Record<CommandName, string>`: en = today's `BOT_COMMANDS` descriptions (`"The digest now"`, `"Mailboxes, last sync, LLM calls"`, `"Stop reading and triage"`, `"Start reading and triage again"`, `"The command list"`); pl = `"Podsumowanie teraz"`, `"Skrzynki, ostatnia synchronizacja, wywołania AI"`, `"Wstrzymaj czytanie i klasyfikację"`, `"Wznów czytanie i klasyfikację"`, `"Lista poleceń"`. `CommandName` stays in `apps/server/src/modules/channels/port.ts`; in core, key the record by the literal list `"digest" | "status" | "pause" | "resume" | "help"` and keep a type test in the server that both lists match.
- `BOT_COMMANDS` is built from `textTables.en.bot.commands` in the order of today's list (same bytes). At start, polling calls `setMyCommands(BOT_COMMANDS)` as today (the default menu, English) and then `setMyCommands(<pl list from textTables.pl>, { language_code: "pl" })`. This menu does not use the hold: Telegram picks it by the user's app language, not by `users.locale`, and it changes no message. A failure of either call logs today's warning once per call and polling goes on.

**Decisions.** D20.

**Test.** `polling.test.ts`:

1. The fake records two `setMyCommands` calls: the first with today's `commands` and no `language_code`; the second with the five Polish descriptions and `language_code: "pl"`.
2. The existing "goes on when setMyCommands fails" case still passes (both calls fail: the warning appears for each, polling goes on); update its expected warning count from 1 to 2 and say so in the final message.

**Check.** `bun test apps/server/src/modules/channels/telegram/polling.test.ts`; `bun run typecheck`.

**Done when.** Cases 1–2 pass.

**Out of scope.** A per-chat menu by `users.locale` (`BotCommandScopeChat`; not needed while the menu lists five commands).

## Stage done when

- Steps 1–2 are done. `grep -rn '"en"' packages/core/src/digest apps/server/src/modules/channels apps/server/src/modules/reports --include=*.ts | grep -v '\.test\.ts'` finds no interim locale argument except the activity route's `textsFor("en")` in `reports/activity.ts` (stage 13 removes it).
- The Proof chain for stages without page changes in `plan.md` § Proof (with `NN` = 11) prints `PROOF_OK`.
