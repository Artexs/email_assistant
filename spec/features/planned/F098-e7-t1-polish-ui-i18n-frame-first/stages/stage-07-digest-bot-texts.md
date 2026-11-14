# F098 stage 07 — Digest and bot texts in English and Polish

Part of [`../plan.md`](../plan.md). Decisions: P2, P6, P7, the glossary, D9, D10, D11, D12. Needs stage 06 landed. Review job before the land (it reads every Polish text). Two steps.

After this stage every text that a user reads in Telegram comes from `packages/core/src/texts/`, and every Telegram path asks `textsFor` with the right locale: the row's locale for notices (stage 06), the chat's locale for replies and taps, the token owner's locale for link replies. The hold of stage 05 still gives English to everyone. `apps/server/src/modules/channels/texts.ts` is gone.

The translation rules and the fixed words of stage 06 (its table) apply here too. More fixed words:

| en | pl |
| --- | --- |
| `📬 Digest <time> · <day>` / `(late)` | `📬 Podsumowanie <time> · <day>` / `(spóźnione)` |
| `📬 Digest now · …` | `📬 Podsumowanie teraz · …` |
| `NEEDS ACTION` / `OTHER MAIL` | `WYMAGA DZIAŁANIA` / `POZOSTAŁE` |
| `Since <t>: <n> mail(s), <k> need action` | `Od <t>: <n> wiadomość/wiadomości/wiadomości, <k> wymaga działania` (one/few/many of `wiadomość`; `<k>` with `wymaga`/`wymagają`/`wymaga` by `pluralCategory(k)`) |
| `No new mail since <t>.` | `Brak nowych wiadomości od <t>.` |
| `Shadow mode: the system changed nothing in your mailbox.` | `Tryb podglądu: system niczego nie zmienił w Twojej skrzynce.` |
| `Commands:` | `Polecenia:` |
| `/digest – the digest now` | `/digest – podsumowanie teraz` |
| `✅ This chat is linked. Digests and urgent notices come here.` | `✅ Ten czat jest połączony. Tu przychodzą podsumowania i pilne powiadomienia.` |
| `Something went wrong. Try again later.` | `Coś poszło nie tak. Spróbuj ponownie później.` |
| `⏸ This account is paused. Nothing changes now. To resume it, contact <who>.` | `⏸ To konto jest wstrzymane. Teraz nic się nie zmienia. Aby je wznowić, skontaktuj się z: <who>.` (no contact: `… skontaktuj się z operatorem.`) |

Telegram command names (`/digest`, `/status`, `/pause`, `/resume`, `/help`) never change.

## Step 1 — The digest

**Goal.** Scheduled digests, `/digest` and the reports digest render per locale.

**Files.** New: `packages/core/src/texts/digest.ts`. Changed: `packages/core/src/texts/index.ts`, `packages/core/src/digest/digest.ts` (+ `digest.test.ts`), `apps/server/src/modules/reports/digest.ts` (`DigestRequest` gains `locale: UserLocale`), `apps/server/src/modules/channels/digest-job.ts` (passes `link.locale`), `apps/server/src/modules/channels/commands.ts` (the `/digest` path passes `link.locale`), `apps/server/test/integration/reports-digest.test.ts` (requests get `locale: "en"`).

**Interfaces.**

```ts
export interface DigestTexts { /* one entry per fixed string or line of digest/digest.ts; counts by pluralCategory */ }
// digest/digest.ts
export function renderDigest(input: DigestInput, texts: CoreTexts): OutMessage;
// reports/digest.ts
export interface DigestRequest { …; locale: UserLocale }
// buildDigestMessage: const texts = textsFor(request.locale); aiTextFor(…, texts); describeActions(…, texts); renderDigest(…, texts)
```

Every `formatClock`/`formatDay`/`categoryTag`/`cleanSubject`/`senderLabel` call in `digest.ts` uses `texts` (remove the stage-05 interim comments and `"en"` arguments in this file). The digest view of the outbox still stores the rendered text and buttons (the notices-as-facts rule for `digest`), now rendered with the member's texts.

**Decisions.** D9, D10, D11.

**Test.** `digest.test.ts`: every old case with `textTables.en`, same text. New `pl` cases with the fixed inputs of an existing case (one scheduled, one `now`, one with no mail, one over the item limit):

1. Scheduled: first line `📬 Podsumowanie 08:00 · <pl day>`; a late slot ends with `(spóźnione)`.
2. Totals 1, 3, 5 mails → `1 wiadomość`, `3 wiadomości`, `5 wiadomości`; the "need action" verb by `pluralCategory` of the action count.
3. No mail → `Brak nowych wiadomości od <t>.`
4. Section titles `WYMAGA DZIAŁANIA` and `POZOSTAŁE`; item lines carry the Polish category tag (`🔴 Pilne`).
5. Over the limit: the pl text is at most `MESSAGE_MAX_CHARS` (the cut logic works on the built text).

`reports-digest.test.ts` and `channels-digest-job.test.ts` pass with only the `locale` argument added.

**Check.** `bun test packages/core/src/digest`; `bun run typecheck`; `bun test apps/server/test/integration/reports-digest.test.ts apps/server/test/integration/channels-digest-job.test.ts apps/server/test/integration/channels-commands.test.ts`.

**Done when.** Cases 1–5 pass; old cases unchanged except the argument.

**Out of scope.** Bot replies (step 2).

## Step 2 — Bot replies, `/status`, pause and resume, tap answers, link replies

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

- `commands.ts`: `runCommand(deps, link, name)` and `createUpdateHandlers` read `const texts = textsFor(link.locale)`; `/help` returns `texts.bot.help`; the suspended answer is `texts.bot.accountPaused(deps.operatorContact)`; `formatClock`/`formatDay` with `texts.locale` (remove the stage-05 interim comments).
- `callbacks.ts`: one `textsFor(link.locale)` per tap; every answer and edit text from `texts.bot.taps` (or `texts.answers`, `texts.common` where stage 05/06 put them).
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

**Done when.** Cases 1–5 pass. `grep -rn "Something went wrong\|Commands:\|Already saved" apps/server/src` finds nothing.

**Out of scope.** Operator notices (`channels/operator.ts`, plan P7). The switch (stage 08).

## Stage done when

- Steps 1–2 are done. `grep -rn '"en"' packages/core/src/digest apps/server/src/modules/channels apps/server/src/modules/reports --include=*.ts | grep -v test` finds no interim locale argument (the activity route's `textsFor("en")` from stage 05 stays until stage 08 and is the only one; it lives in `reports/activity.ts`).
- The Proof chain for stages without page changes in `plan.md` § Proof (with `NN` = 07) prints `PROOF_OK`.
