# F098 stage 06 — Core texts registry: clock, categories, answers, AI line

Part of [`../plan.md`](../plan.md). Decisions: P6, P7, the glossary, D6, D9, D10, D11. Needs stage 02 landed (the Polish panel words that the tie tests compare). May run next to stages 03–05. Review job before the land (every render signature changes; new Polish texts). Two steps.

After this stage the shared words of Telegram and the activity list (clock, category names, tap answers, the AI line) live in `packages/core/src/texts/` in English and Polish. Every function that prints them takes a `texts: CoreTexts` argument. `textsFor(locale)` still returns English for every locale (the hold, D10), so no user sees a change. The panel's clock follows the panel locale at once (D6). Stage 07 adds the action phrases.

Size note: most of the diff is one added argument at about 150 call sites (`bun run typecheck` lists them). Do those edits mechanically; do not refactor the callers.

## Step 1 — The registry and the hold

**Goal.** One place for message texts per locale, with type-enforced parity (D9, D10).

**Files.** New: `packages/core/src/texts/{index,clock,categories,answers,ai-text}.ts`, `packages/core/src/texts/index.test.ts`. Changed: `packages/core/src/index.ts` (export `./texts`), `packages/core/src/web/index.ts` (export `textTables`, `type CoreTexts`, `categoryEmoji`, `categoryTag`, `formatClock`; remove the exports this stage deletes).

**Interfaces.**

```ts
// texts/index.ts
import type { UserLocale } from "../tenancy";
export interface CoreTexts {
  locale: UserLocale;
  clock: ClockTexts;
  categories: CategoryTexts;
  answers: AnswerTexts;
  aiText: AiTextTexts;
  // Stage 07 adds wouldDo; stages 08–11 add common, notices, approvals, digest, bot.
}
export const textTables: Record<UserLocale, CoreTexts> = {
  en: { locale: "en", clock: clockTexts.en, categories: categoryTexts.en, answers: answerTexts.en, aiText: aiTextTexts.en },
  pl: { locale: "pl", … .pl },
};
// Telegram and the panel phrases switch to Polish together in stage 12 of the plan in the ticket folder
// F098-e7-t1-polish-ui-i18n-frame-first (D10); until then every locale gets English.
const POLISH_MESSAGES_ON = false;
export function textsFor(locale: UserLocale): CoreTexts {
  return POLISH_MESSAGES_ON ? textTables[locale] : textTables.en;
}
```

Each section file: `export interface <Section>Texts {…}` and `export const <section>Texts = { en: {…}, pl: {…} } satisfies Record<UserLocale, <Section>Texts>;`. Text values that take arguments are functions. Stages 07–11 add sections the same way.

**Decisions.** D9, D10.

**Test.** `texts/index.test.ts`:

1. `textsFor("en") === textTables.en`; `textsFor("pl") === textTables.en` (the hold; stage 12 changes this case); `textTables.pl.locale === "pl"`; `textTables.en.locale === "en"`.
2. A walk over `textTables.pl` and `textTables.en`: every string value (also in arrays) is non-empty; every function returns a non-empty string for the sample arguments the step tests use.

**Check.** `bun test packages/core/src/texts`; `bun run typecheck`.

**Done when.** Cases 1–2 pass.

**Out of scope.** Action phrases (stage 07), notices and approvals (stages 08, 09), digest and bot (stages 10, 11).

## Step 2 — Clock, categories, answers, AI line

**Goal.** These four groups print through the registry (D6, D9).

**Files.** `packages/core/src/digest/{local-time,labels,answers,ai-text}.ts` and their tests, `packages/core/src/texts/{clock,categories,answers,ai-text}.ts`, every caller that `bun run typecheck` lists: `packages/core/src/digest/{notices,approvals,digest}.ts`, `packages/core/src/notices/renderers.ts`, `packages/core/src/outgoing/quote.ts`, `apps/server/src/modules/channels/{callbacks,commands}.ts`, `apps/server/src/modules/reports/{activity,digest}.ts`, `apps/web/src/components/activity/{ActivityPanel,ActivityRow}.tsx`, `apps/web/src/components/mailboxes/MailboxCard.tsx`, `apps/web/src/components/telegram/TelegramLink.tsx`, `apps/web/src/islands/{ActivityPage,MailboxesPage,RulesPage}.tsx`, `apps/web/src/lib/activity-text.test.ts`.

**Interfaces.**

```ts
// texts/clock.ts
export interface ClockTexts { months: readonly string[]; weekdays: readonly string[] } // 12 and 7 entries, index 0 = Sunday
// en: months Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec; weekdays Sun Mon Tue Wed Thu Fri Sat (today's tables)
// pl: months sty lut mar kwi maj cze lip sie wrz paź lis gru; weekdays niedz. pon. wt. śr. czw. pt. sob.

// digest/local-time.ts — a required locale; the shapes stay (plan D6)
export function formatClock(at: Date, timeZone: string, now: Date, locale: UserLocale): string;
export function formatDay(at: Date, timeZone: string, locale: UserLocale): string;
```

`local-time.ts` keeps its private `WEEKDAYS` array: `localParts` parses the `en-US` short weekday with it. Only the display uses `clockTexts[locale]`. `formatClock` and `formatDay` are not held (the panel calls them with its own locale).

```ts
// texts/categories.ts
export type CategoryTexts = Record<Category, string>;
// en: Urgent, Reply, Delegate, Unsure, Info, Notification, Spam (today's names)
// pl: Pilne, Odpowiedz, Przekaż, Niepewne, Info, Powiadomienie, Spam (glossary)

// digest/labels.ts — `categoryLabels` is replaced by:
export const categoryEmoji: Record<Category, string>; // 🔴 ✉️ 👥 ❓ ℹ️ 🔔 🚫 as today
export function categoryTag(category: Category, texts: CoreTexts): string; // `${emoji} ${texts.categories[category]}`

// texts/answers.ts
export interface AnswerTexts {
  undo: Record<UndoAnswerKind, string>;               // en: today's UNDO_TEXTS
  right: (saved: boolean, category: string) => string; // en: saved ? `✅ Saved: ${category} is right.` : "Already saved."
  pick: (saved: boolean) => string;                    // en: saved ? "Saved." : "Already saved."
  picked: (saved: boolean, trueCategory: string, aiCategory: string) => string; // en: `✏️ ${saved ? "Saved" : "Already saved"}: ${t} (AI said ${a}).`
}
// digest/answers.ts — UNDO_TEXTS is removed (callers read texts.answers.undo); the functions take texts last:
export function rightAnswer(saved: boolean, category: Category, texts: CoreTexts): string;
export function pickAnswer(saved: boolean, texts: CoreTexts): string;
export function pickedText(trueCategory: Category, aiCategory: Category, saved: boolean, texts: CoreTexts): string;

// texts/ai-text.ts
export interface AiTextTexts {
  triageError: string;  // en: "AI triage failed 3 times."
  llmBlocked: string;   // en: "The AI safety filter blocked this mail."
  blocklist: string;    // en: "The sender is on your blocklist."
  noReason: string;     // en: "No reason given."
  guess: (reason: string, guess: string, percent: number) => string; // en: `${reason} (AI guess: ${guess}, ${percent}%)`
}
// digest/ai-text.ts
export function aiTextFor(input: AiTextInput, texts: CoreTexts): string | null;
```

The Polish answer texts are the Polish panel texts, so the tie test of the panel holds: `undo.*` = `pl.ts` `undo_started`, `undo_already`, `undo_nothing`, `undo_too_old`, `undo_held`; `right(true, c)` = `pl.act_toast_right` with `{category}` = c; `right(false, …)` and `pick(false)` = `pl.act_toast_same`; `picked(true, t, a)` = `pl.act_toast_picked` with `{category}` = t and `{ai}` = a. Read those keys in `apps/web/src/i18n/pl.ts` and build the functions from them; `pick(true)` and `picked(false, …)` you translate (glossary). `aiText` pl: triageError "Klasyfikacja AI nie powiodła się 3 razy.", llmBlocked "Filtr bezpieczeństwa AI zablokował tę wiadomość.", blocklist "Nadawca jest na Twojej liście blokowanych.", noReason "Brak uzasadnienia.", guess `${reason} (AI zgaduje: ${guess}, ${percent}%)`.

Callers:

- Core render functions that this stage does not move to `texts` yet (`digest/notices.ts`, `digest/approvals.ts`, `digest/digest.ts`) call `formatClock(…, "en")`, `formatDay(…, "en")` and `categoryTag(c, textTables.en)` with the comment `// The next stage of the Polish UI plan passes the texts of the row.` Stages 08–10 replace these.
- `notices/renderers.ts` (urgent): `aiTextFor(…, textsFor(opts.locale))`.
- `outgoing/quote.ts:23`: `formatDay(at, timezone, "en")` (the outgoing quote keeps its own Polish branch, plan P7).
- `channels/callbacks.ts`: `textsFor(link.locale)` once per tap, passed to `categoryTag`, `rightAnswer`, `pickAnswer`, `pickedText`, the undo answer (`texts.answers.undo[kind]`), and `formatClock(…, texts.locale)`.
- `channels/commands.ts`: `formatClock(…, "en")`, `formatDay(…, "en")` with the same comment (stage 11 moves `/status`).
- `reports/activity.ts` (`aiTextFor`): `textsFor("en")` with the comment `// Stage 13 of the Polish UI plan uses the request locale.`; `reports/digest.ts` (`aiTextFor`): `textTables.en` with the comment of the first bullet (stage 10 replaces it).
- The panel: every `formatClock(…)` gets `getLocale()` from `../i18n` (or `useLocale()` where a component already calls it). `MailboxCard`, `TelegramLink`, `ActivityRow`, `ActivityPanel`, `ActivityPage`, `MailboxesPage`, `RulesPage`.

**Decisions.** D6, D9, D11, P7.

**Test.**

1. `local-time.test.ts`, new cases (zone `Europe/Warsaw`, `now = 2026-11-14T11:00:00Z`): `formatClock(2026-11-14T11:30:00Z, …, "pl")` → `"12:30"`; `formatClock(2026-11-13T11:30:00Z, …, "pl")` → `"13 lis 12:30"`; `formatClock(2025-11-13T11:30:00Z, …, "pl")` → `"13 lis 2025 12:30"`; `formatDay(2026-11-14T11:30:00Z, …, "pl")` → `"sob. 14 lis"`; the same with `"en"` → `"13 Nov 12:30"`, `"Sat 14 Nov"`. Old cases get `"en"` and keep their expected texts.
2. `labels`: `categoryTag("urgent", textTables.pl)` → `"🔴 Pilne"`; `categoryTag("delegation", textTables.en)` → `"👥 Delegate"`.
3. `ai-text.test.ts`: old cases get `textTables.en`, same outputs. New: `pl` with `reasonCode: "triage_error"` → `"Klasyfikacja AI nie powiodła się 3 razy."`; `category: "unsure"`, `modelCategory: "info"`, `confidence: 0.62`, `reason: "marker"` → `"marker (AI zgaduje: Info, 62%)"`; same with `reason: null` → `"Brak uzasadnienia. (AI zgaduje: Info, 62%)"`.
4. `answers.test.ts`: old cases with `textTables.en`; new: `rightAnswer(true, "spam", textTables.pl)` contains `"Spam"`; `pickedText("info", "spam", true, textTables.pl)` starts with `"✏️"`.
5. `apps/web/src/lib/activity-text.test.ts`: the "tied to the Telegram source" cases run for both locales: with `setLocaleForTest(locale)`, `undoToast(kind)` = `textTables[locale].answers.undo[kind]`, `categoryName(c)` = `textTables[locale].categories[c]`, `categoryTagText(c)` = `categoryTag(c, textTables[locale])`, and the feedback toasts equal `rightAnswer` / `pickedText` with `textTables[locale]`. If a Polish panel text differs from the core text, change the core text to the panel text (the panel text was reviewed in stage 02), never the other way, and list the key in the final message.

**Check.** `bun test packages/core/src apps/web/src/lib apps/web/src/i18n`; `bun run typecheck`; `bun test apps/server/test/integration/channels-callbacks.test.ts apps/server/test/integration/channels-commands.test.ts apps/server/test/integration/reports-digest.test.ts`.

**Done when.** Cases 1–5 pass; every old test passes with only the added `texts`/locale argument.

**Out of scope.** Moving whole render functions (stages 07–11).

## Stage done when

- Steps 1–2 are done; `grep -rn "categoryLabels\|UNDO_TEXTS" apps packages --include=*.ts --include=*.tsx` finds nothing.
- The Proof chain for page stages in `plan.md` § Proof (with `NN` = 06) prints `PROOF_OK`. (the panel's clock changed, so the build and the e2e suite run).
