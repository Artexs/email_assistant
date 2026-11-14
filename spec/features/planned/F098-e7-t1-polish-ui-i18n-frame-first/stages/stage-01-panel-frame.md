# F098 stage 01 — Panel i18n frame

Part of [`../plan.md`](../plan.md). Decisions: P1, P8, D1–D7. Review job before the land. Four steps.

After this stage the panel has a locale store and the language rule, every island renders on the client and re-renders on a language change, and plurals, dates and titles follow the locale. The Polish dictionary is still the English one (`pl: en`), so no user sees a change. Stage 02 adds the Polish texts.

## Step 1 — The language rule in core

**Goal.** One rule for the panel and the server (D4).

**Files.** New: `packages/core/src/texts/locale.ts`, `packages/core/src/texts/locale.test.ts`. Changed: `packages/core/src/index.ts` (export `./texts/locale`), `packages/core/src/web/index.ts` (export `./../texts/locale` and `userLocales`, `userLocaleSchema`, `type UserLocale` from `../tenancy`).

**Interfaces.**

```ts
import type { UserLocale } from "../tenancy";

// "pl", "pl-PL", "PL" → pl; anything else, empty or missing → en.
export function localeOfLanguageTag(tag: string | null | undefined): UserLocale;
// The stored choice wins; else the language tag decides.
export function resolveLocale(userLocale: UserLocale | null, tag: string | null | undefined): UserLocale;
// The first tag of an Accept-Language header, without its q value: "pl-PL,pl;q=0.9,en;q=0.8" → "pl-PL". Empty → null.
export function firstLanguageTag(acceptLanguage: string | null | undefined): string | null;
export type PluralCategory = "one" | "few" | "many" | "other";
// en: one | other. pl: one | few | many (a fraction, Intl's "other", becomes "many").
export function pluralCategory(locale: UserLocale, count: number): PluralCategory;
```

`pluralCategory` uses `new Intl.PluralRules(locale)`; create the two rule objects once at module level. The file imports nothing that pulls a Node module (the browser imports it through `@ea/core/web`).

**Decisions.** D4, P1.

**Test.** `locale.test.ts`:

1. `localeOfLanguageTag`: `"pl"` → pl, `"pl-PL"` → pl, `"PL"` → pl, `" pl-pl "` → pl (trim), `"en-US"` → en, `"de"` → en, `""` → en, `null` → en, `undefined` → en, `"plx"` → pl (starts with `pl`; same as today's `legalLang`).
2. `resolveLocale("en", "pl-PL")` → en; `resolveLocale("pl", "en-US")` → pl; `resolveLocale(null, "pl-PL")` → pl; `resolveLocale(null, undefined)` → en.
3. `firstLanguageTag("pl-PL,pl;q=0.9,en;q=0.8")` → `"pl-PL"`; `"en;q=0.5, pl"` → `"en"`; `"  "` → null; `""` → null; `undefined` → null; `"*"` → `"*"`.
4. `pluralCategory("pl", n)` for n = 0, 1, 2, 4, 5, 12, 14, 21, 22, 25, 112, 1.5 → many, one, few, few, many, many, many, many, few, many, many, many. `pluralCategory("en", n)` for 0, 1, 2 → other, one, other.

**Check.** `bun test packages/core/src/texts`; `bun run typecheck`.

**Done when.** Tests 1–4 pass.

**Out of scope.** Message texts (stage 05).

## Step 2 — The locale store, `t` and `tp`

**Goal.** Every web text goes through a store that knows the current locale (D1, D5).

**Files.** New: `apps/web/src/i18n/index.ts`, `apps/web/src/i18n/index.test.ts`. Changed: `apps/web/src/i18n/en.ts` (remove the `t` function at its end; move the plural pairs to `enPlurals`), `apps/web/src/i18n/en.test.ts` (import `t` from `./index`), every file that imports `../i18n/en` or `../../i18n/en` for `t` or `TextKey` (about 55 `.ts`/`.tsx` files: `grep -rln "i18n/en\"" apps/web/src --include=*.ts --include=*.tsx`), and the four plural call sites: `components/shell/AuthErrorBanner.tsx:10`, `islands/OnboardingPage.tsx:41,94`, `islands/SettingsPage.tsx` (`expired_suffix`). `apps/web/e2e/tests/onboarding.spec.ts` uses `en.ob_mailbox_done_one`: change it to `enPlurals.ob_mailbox_done.one`.

**Interfaces.**

```ts
// en.ts (keeps `export const en = {…} as const` and `export type TextKey = keyof typeof en`)
export const enPlurals = {
  auth_error_banner: { one: "1 mailbox has a login error.", other: "{count} mailboxes have a login error." },
  ob_mailbox_done: { one: "1 mailbox connected.", other: "{count} mailboxes connected." },
  ob_rules: { one: "1 rule", other: "{count} rules" },
  expired_suffix: { one: "1 planned action was cancelled.", other: "{count} planned actions were cancelled." },
} as const;
export type PluralKey = keyof typeof enPlurals;
```

The `other` texts are the old `_many` / `expired_suffix` texts byte for byte; the six keys `auth_error_banner_one`, `auth_error_banner_many`, `ob_mailbox_done_one`, `ob_mailbox_done_many`, `ob_rules_one`, `ob_rules_many` and `expired_suffix` leave `en`. `expired_suffix.one` is new (today a count of 1 printed "1 planned actions were cancelled.").

```ts
// index.ts
import { localeOfLanguageTag, pluralCategory, type UserLocale } from "@ea/core/web";
import { en, enPlurals, type PluralKey, type TextKey } from "./en";

export type { PluralKey, TextKey };
export type Dictionary = Record<TextKey, string>;
export interface PluralTables { en: Record<PluralKey, { one: string; other: string }>; pl: Record<PluralKey, { one: string; few: string; many: string }> }
// Stage 02 of the Polish UI plan replaces the pl entries with the Polish tables.
const dictionaries: Record<UserLocale, Dictionary> = { en, pl: en };
const plurals: PluralTables = { en: enPlurals, pl: { /* each key: { one: en.one, few: en.other, many: en.other } */ } };

export const LOCALE_STORAGE_KEY = "ea.locale";
export function getLocale(): UserLocale;
export function setLocale(locale: UserLocale): void; // D1: no-op when equal; else set, persist (try/catch), set <html lang>, notify
export function initLocale(): UserLocale;            // D1: stored "pl"/"en", else localeOfLanguageTag(navigator.language)
export function subscribeLocale(listener: () => void): () => void;
export function useLocale(): UserLocale;              // useSyncExternalStore(subscribeLocale, getLocale, () => "en")
export function t(key: TextKey, vars?: Record<string, string | number>): string;   // same fill rule as today
export function tp(key: PluralKey, count: number, vars?: Record<string, string | number>): string; // {count} plus vars
export function dateLocale(): "pl-PL" | "en-GB";
// Tests only: set the locale without storage or DOM.
export function setLocaleForTest(locale: UserLocale): void;
```

At the end of `index.ts`: `if (typeof window !== "undefined") initLocale();`. `setLocale` and `initLocale` guard `localStorage` and `document` with `typeof … !== "undefined"` and a `try` (a blocked storage throws in some browsers). `tp` picks `pluralCategory(getLocale(), count)`; for `en`, `one` → `one`, else `other`; for `pl`, `one`/`few`/`many`, `other` → `many`.

The `t` fill rule stays exactly as in `en.ts` today (`/\{(\w+)\}/g`, unknown names stay as written).

Call sites: `count === 1 ? t("x_one") : t("x_many", { count })` becomes `tp("x", count)`. `SettingsPage`'s suffix becomes `tp("expired_suffix", change.expired)`.

**Decisions.** D1, D5.

**Test.** `index.test.ts` (uses `setLocaleForTest`):

1. `t("rules_delete", { pattern: "firma.pl" })` → `"Delete the rule firma.pl"` (the old `en.test.ts` case moves here or stays and imports from `./index`).
2. `tp("ob_rules", 1)` → `"1 rule"`; `tp("ob_rules", 0)` → `"0 rules"`; `tp("ob_rules", 5)` → `"5 rules"`; `tp("expired_suffix", 1)` → `"1 planned action was cancelled."`.
3. With `setLocaleForTest("pl")`: `getLocale()` → `"pl"`, `dateLocale()` → `"pl-PL"`; `tp("ob_rules", 2)` uses the `few` entry (until stage 02 it equals the English `other` text).
4. `subscribeLocale` listener: `setLocale("pl")` from `en` calls it once; `setLocale("pl")` again does not call it.
5. `initLocale()` without `window`/`localStorage`/`navigator` (Bun test) → `"en"` and no throw.

**Check.** `bun test apps/web/src/i18n apps/web/src/lib`; `bun run typecheck`; `bun run lint`.

**Done when.** Tests pass; `grep -rn "i18n/en\"" apps/web/src --include=*.tsx --include=*.ts` lists only `index.ts`, the test files and files that import `en` or `enPlurals` themselves (not `t`).

**Out of scope.** Polish texts. The Account choice.

## Step 3 — Client-only islands that follow the locale

**Goal.** The islands never hydrate server HTML, and a locale change re-renders them (D2, D3).

**Files.** The 8 pages `apps/web/src/pages/{activity,forgot,login,mailboxes,onboarding,rules,settings,setup}.astro`; the 8 islands `apps/web/src/islands/*.tsx`; new `apps/web/src/i18n/islands.test.ts`.

**Interfaces.**

- Each page: `<XPage client:only="react" />` instead of `client:load`.
- Each island's default export starts with `useLocale();` as its first statement (import from `../i18n`), with the comment `// A language change re-renders the whole island (plan of spec/features/…/F098-…, D3).` on the first island only; the others need no comment.
- `islands.test.ts` reads every file in `apps/web/src/islands/` (`readdirSync`, `.tsx` only) and asserts that the text of each contains `export default function` and that the first statement after the opening brace of that function is `useLocale();` (a regex over the source is enough). It also reads every `apps/web/src/pages/*.astro` that imports from `../islands/` and asserts `client:only="react"` and no `client:load`.

**Decisions.** D2, D3.

**Test.** `islands.test.ts` cases 1 (every island) and 2 (every page). Also the existing e2e suite must pass: it signs in through the islands, and its `cspErrors` helper fails on a CSP report (Not verified 1 in `plan.md`).

**Check.** `bun test apps/web/src/i18n`; `bun run web:build`; the e2e run of the Proof.

**Done when.** Both cases pass; `bun run web:build` and the full e2e suite pass.

**Out of scope.** The sync with `me.user.locale` (stage 03).

## Step 4 — Titles, `<html lang>`, dates, legal links, the last literals

**Goal.** Every remaining English-only spot follows the locale (D6, D7, P8).

**Files.** `apps/web/src/layouts/{App,Public}.astro`, the 11 `.astro` pages that pass a title, `components/shell/AppShell.tsx`, `components/auth/AuthCard.tsx`, `lib/trial-date.ts` (+ its test), `components/settings/AccountCard.tsx:21`, `lib/legal.ts` (+ `legal.test.ts`), `components/shell/TermsDialog.tsx:33`, `islands/SetupPage.tsx:115`, `components/ui/dialog.tsx:65,100`, `components/ui/sheet.tsx:68`, `i18n/en.ts` (one new key `close: "Close"`).

**Interfaces.**

- Layouts: prop `titleKey: TextKey` replaces `title: string`; the static `<title>` stays `{en[titleKey]} · {en.brand}` (English in the HTML file). Pages pass `titleKey="title_settings"` etc. The legal page passes its own title text (step 4 of stage 02 changes it); keep a `title` prop there or give `Public.astro` an optional `title?: string` that wins over `titleKey` — choose the smaller change and say which in the final message.
- `AppShell` (its `title: TextKey` prop) and `AuthCard` (`title: TextKey`): `const locale = useLocale(); useEffect(() => { document.title = `${t(title)} · ${t("brand")}`; }, [title, locale]);`.
- `trialDateText(iso, timeZone)` uses `dateLocale()` instead of `"en-GB"`; its test sets the locale with `setLocaleForTest`.
- `AccountCard`: the module-level `dateFormat` becomes a call inside render with `new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium" })`.
- `lib/legal.ts`: `legalLang` is removed; callers use `getLocale()` (a `LegalLang` is a `UserLocale`). `legal.test.ts` drops its `legalLang` cases and keeps the path cases.
- `dialog.tsx` and `sheet.tsx`: `Close` → `{t("close")}`.

**Decisions.** D6, D7, P8.

**Test.**

1. `trial-date.test.ts`: `en` → today's expected text (unchanged); new case with `setLocaleForTest("pl")`: `trialDateText("2026-12-01T10:00:00.000Z", "Europe/Warsaw")` → `"1 grudnia 2026"` (fact 1 of `plan.md`).
2. `legal.test.ts`: the path cases pass.

**Check.** `bun test apps/web/src/lib apps/web/src/i18n`; `bun run typecheck`; `bun run lint`; `bun run web:build`.

**Done when.** Tests pass; `grep -rn '"en-GB"\|Intl.DateTimeFormat(undefined' apps/web/src` finds only `i18n/index.ts`.

**Out of scope.** `formatClock` (core, stage 05). The Polish dictionary (stage 02).

## Stage done when

- Steps 1–4 are done; the panel looks and behaves as before in English (the full e2e suite passes unchanged except the one `ob_mailbox_done` reference).
- The Proof chain for page stages in `plan.md` § Proof (with `NN` = 01) prints `PROOF_OK`.
