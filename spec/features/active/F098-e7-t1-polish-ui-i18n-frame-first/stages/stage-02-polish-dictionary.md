# F098 stage 02 — The Polish panel dictionary

Part of [`../plan.md`](../plan.md). Decisions: P6, P9, the glossary, D5, D18. Needs stage 01 landed. Review job before the land (it reads every Polish text). One step.

After this stage a user with a Polish browser and no stored choice sees the panel in Polish. Stage 03 adds the static pages and the Playwright proof; stage 04 adds the Account choice. The action phrases and AI lines of the activity list stay English until stage 13 (plan D17).

Size note: `pl.ts` is about 480 lines of translation data (one line per key of `en.ts`), plus one test file. The code change is three lines in `index.ts`.

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
- Numbers: a text with a number that is not in the plural tables (`gate_go`, `gate_no_go`, `gate_too_few` with `{kept}`, `retention_line` with `{days}`, `digest_help` with `{max}`, `times_too_many`, `style_too_long` and any other `{count}`/`{n}`/number key; `grep -n '{[a-z]*}\|[0-9]' apps/web/src/i18n/en.ts` lists them) uses a Polish form that needs no agreement with the number: the number after a colon or a dash (`Limit: {max}`, `Przechowywanie: {days} dni` only when the value is never 1), or a noun that does not change with it. Never move such a key to the plural tables (the English text must not change). List these keys in the final message.

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

**Out of scope.** Core texts (stages 06–11). Static pages and the Playwright spec (stage 03). Legal texts (the papers ticket, E7-T4).

## Stage done when

- Step 1 is done.
- The Proof chain for page stages in `plan.md` § Proof (with `NN` = 02) prints `PROOF_OK`.
- The final message lists the `SAME_IN_BOTH` keys, the `help_*` keys with literal menu translations, and the keys with a number that you rephrased (rule 'Numbers' in step 1).
