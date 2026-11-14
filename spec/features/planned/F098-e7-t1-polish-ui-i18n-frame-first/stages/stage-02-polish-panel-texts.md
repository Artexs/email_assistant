# F098 stage 02 — Polish panel texts

Part of [`../plan.md`](../plan.md). Decisions: P1, P6, P8, P9, the glossary, D5, D18. Needs stage 01 landed. Review job before the land (it reads every Polish text). Three steps.

After this stage a user with a Polish browser and no stored choice sees the whole panel in Polish. The Account choice comes in stage 03. The action phrases and AI lines of the activity list stay English until stage 08 (plan D17).

## Step 1 — `pl.ts` and the Polish plural forms

**Goal.** Every key of `en.ts` has a Polish text (D5).

**Files.** New: `apps/web/src/i18n/pl.ts`, `apps/web/src/i18n/i18n.test.ts`. Changed: `apps/web/src/i18n/index.ts` (`dictionaries = { en, pl }`, `plurals.pl = plPlurals`; remove the stage-01 comment).

**Interfaces.**

```ts
import type { PluralKey, TextKey } from "./en";

export const pl: Record<TextKey, string> = { brand: "Email Assistant", … };
export const plPlurals: Record<PluralKey, { one: string; few: string; many: string }> = {
  auth_error_banner: {
    one: "1 skrzynka ma błąd logowania.",
    few: "{count} skrzynki mają błąd logowania.",
    many: "{count} skrzynek ma błąd logowania.",
  },
  ob_mailbox_done: { one: "Połączono 1 skrzynkę.", few: "Połączono {count} skrzynki.", many: "Połączono {count} skrzynek." },
  ob_rules: { one: "1 reguła", few: "{count} reguły", many: "{count} reguł" },
  expired_suffix: {
    one: "Anulowano 1 zaplanowaną akcję.",
    few: "Anulowano {count} zaplanowane akcje.",
    many: "Anulowano {count} zaplanowanych akcji.",
  },
};
```

Keep the key order of `en.ts` and its `// section` comments, so a reviewer can read the two files side by side. Translate by `plan.md` § "Rules for every stage", P6 and the glossary. Rules for this file:

- The brand stays `"Email Assistant"`. `Telegram`, `Gmail`, `Onet`, `Interia`, `WP`, `IMAP`, `SMTP`, `VIP`, `AI`, `CLI` command names (`web:invite`, `mailbox:password`), times, `{placeholders}`, emoji and `→` stay as they are.
- The mail provider help texts (`help_*`) name the provider's own menu items; use the Polish menu names that the English text paraphrases, translated literally when you do not know them, and list those keys in your final message.
- `password_help`, the terms label and every error text are full sentences ending with a full stop, as in English.
- Buttons are short imperatives ("Zapisz", "Anuluj", "Połącz Telegram").

**Decisions.** D5, P6, glossary.

**Test.** `i18n.test.ts`:

1. Placeholders: for every `TextKey`, the set of `{name}` in `pl[key]` equals the set in `en[key]`.
2. Plurals: for every `PluralKey`, the placeholder sets of `plPlurals[key].few` and `.many` equal that of `enPlurals[key].other`, and `.one` equals that of `enPlurals[key].one`.
3. No text is empty or only spaces (both dictionaries, all plural forms).
4. Same text in both: a list `SAME_IN_BOTH: TextKey[]` in the test, each with a short comment (brand, `tg_title` "Telegram", preset names, `sig_counter` "{count} / {max}", `act_cat_info` "Info", `act_cat_spam` "Spam", …). The test fails when `pl[key] === en[key]` for a key not in the list, and when a listed key differs (so the list stays true).
5. Glossary guard: no Polish text contains `delegacj` (it means a business trip, plan glossary) or `tryb cienia`.
6. With the locale set to `pl` (`setLocaleForTest`): `tp("ob_rules", 1)` → `"1 reguła"`, `2` → `"2 reguły"`, `5` → `"5 reguł"`, `22` → `"22 reguły"`, `12` → `"12 reguł"`; `t("rules_delete", { pattern: "firma.pl" })` contains `"firma.pl"`.

**Check.** `bun test apps/web/src/i18n`; `bun run typecheck` (a missing or extra key in `pl` fails here).

**Done when.** Tests 1–6 pass; `bun run typecheck` passes.

**Out of scope.** Core texts (stages 05–07). Legal texts (the papers ticket, E7-T4).

## Step 2 — Static pages in both languages

**Goal.** The pages without an island read right for both languages (P8).

**Files.** `apps/web/src/pages/404.astro`, `apps/web/src/pages/index.astro`, `apps/web/src/pages/legal/[lang]/[doc].astro`, `apps/web/src/layouts/Public.astro` (an optional `lang` prop, default `"en"`, printed in `<html lang>`), `apps/web/e2e/tests/legal.spec.ts`.

**Interfaces.**

- `404.astro`: the heading, the text and the link each in Polish, then the same line in English inside an element with `lang="en"` (for example `<p>{pl.not_found_text}</p><p lang="en">{en.not_found_text}</p>`). The `<title>` stays `{en.title_not_found} · {en.brand}`.
- `index.astro`: the "continue" link text is `{pl.continue} / {en.continue}`.
- The legal page picks `const texts = lang === "pl" ? pl : en;` for the title, the stub text and the "go to sign in" link, and passes `lang` to `Public`.
- `legal.spec.ts`: the expected title, stub text and link text come from `pl` for `/legal/pl/*` and from `en` for `/legal/en/*`.

**Decisions.** P8.

**Test.** `legal.spec.ts` (6 cases × 2 projects) with the per-language texts.

**Check.** `bun run web:build`; the e2e run of the Proof.

**Done when.** The legal spec passes for both languages.

**Out of scope.** The legal texts themselves.

## Step 3 — The Polish browser spec

**Goal.** Proof that a Polish browser gets a Polish panel that fits a phone screen (Done when 3).

**Files.** New: `apps/web/e2e/tests/polish.spec.ts`. Changed: `apps/web/e2e/helpers.ts` (`signIn` and `signInAs` take an optional last parameter `texts: { email_label: string; password_label: string; sign_in: string } = en`).

**Interfaces.** `polish.spec.ts`:

- `test.use({ locale: "pl-PL" });` and the address block `onMobile ? 20 : 120` with `nextAddress` (the pattern of `account.spec.ts`).
- `beforeEach`: `cspErrors(page)`; `afterEach`: the CSP list is empty.
- It signs in as `readSeed().owner` (a null-locale user; never change this user's locale in any spec) with `signInAs(page, owner, pl)`.
- It never changes data.

**Decisions.** P1, D2, D7.

**Test.** `polish.spec.ts`:

1. `/login` before the sign-in: the heading `pl.login_title` is visible; the label `pl.email_label` exists; `document.documentElement.lang` is `"pl"`.
2. `/forgot`: the heading `pl.forgot_title` is visible.
3. After the sign-in, for each of `/activity`, `/mailboxes`, `/settings`, `/rules`: the level-1 heading (the one `AppShell` prints for its `title`; read `AppShell.tsx`) equals `pl.title_<page>`; `document.title` starts with `pl.title_<page>`; the navigation shows `pl.nav_activity` (desktop: the sidebar; mobile: the bottom tabs); `await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)` is true.
4. `/onboarding`: read `OnboardingPage.tsx` for what an owner with this seed sees (the page or a redirect to `/activity`); assert the Polish heading when it stays, else the redirect. Say in the final message which path the run took.

**Check.** The e2e run of the Proof (it runs every spec, so the English specs prove that an `en-US` browser still gets English).

**Done when.** `polish.spec.ts` passes in both projects, and every other spec passes.

**Out of scope.** The Account choice (stage 03).

## Stage done when

- Steps 1–3 are done.
- The Proof chain for page stages in `plan.md` § Proof (with `NN` = 02) prints `PROOF_OK`.
- The final message lists the `SAME_IN_BOTH` keys and the `help_*` keys with literal menu translations.
