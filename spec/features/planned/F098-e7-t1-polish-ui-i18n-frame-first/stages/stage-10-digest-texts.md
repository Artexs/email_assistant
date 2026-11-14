# F098 stage 10 — Digest texts in English and Polish

Part of [`../plan.md`](../plan.md). Decisions: P6, P7, the glossary, D9, D10, D11. Needs stage 09 landed. Review job before the land (it reads every Polish text). One step.

After this stage scheduled digests, `/digest` and the reports digest render from `packages/core/src/texts/digest.ts` with the member's texts. The hold of stage 06 still gives English to everyone.

The translation rules and the fixed words of stage 08 (its introduction and table) apply here too. More fixed words (the bot rows are for stage 11; they sit here so one table holds the words of both stages):

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
| `✅ This chat is linked. Digests and urgent notices come here.` | `✅ Ten czat jest połączony. Tu przychodzą podsumowania i pilne komunikaty.` |
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

Every `formatClock`/`formatDay`/`categoryTag`/`cleanSubject`/`senderLabel` call in `digest.ts` uses `texts` (remove the stage-06 interim comments and `"en"` arguments in this file). The digest view of the outbox still stores the rendered text and buttons (the notices-as-facts rule for `digest`), now rendered with the member's texts.

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

**Out of scope.** Bot replies (stage 11).

## Stage done when

- Step 1 is done.
- The Proof chain for stages without page changes in `plan.md` § Proof (with `NN` = 10) prints `PROOF_OK`.
