# F147 stage 02 — one locale type and its lint rule

Needs: nothing (reads `userLocales`, `UserLocale`, `userLocaleSchema` of `packages/core/src/tenancy.ts`, which exist). May run next to 01: if `apps/server/src/modules/operator/slo-texts.ts` still exists, change its `AlertLocale` line to `= UserLocale`; stage 01 deletes the file (on a conflict keep the delete).
Part of [`../plan.md`](../plan.md).

## Goal

Every type, list or schema whose meaning is "the language of a text the product shows" is the core `UserLocale` (D10, D11). A lint rule stops a new copy (D12).

## Step 1 — replace the copies

- Known copies at the plan base (the worker greps for more): `DocsLocale` (`packages/core/src/site.ts`), `ShotLocale` and `SHOT_LOCALES` (`apps/docs/src/shots.ts`), `Lang` (`apps/docs/src/pricing.ts`, `apps/docs/src/security/subprocessor-view.ts`), `DemoLang` (`apps/docs/src/demo-video.ts`), the inline `Record<"en" | "pl", …>` in `apps/docs/src/ui-text.ts` and `flagged-text.ts`, the `lang` props of the docs components (`Subprocessors`, `ClaimsTable`, `PricePlan`, `DemoVideo`, `CostTable`) and of `apps/web/src/layouts/Public.astro`, `legalLangs` and `LegalLang` (`apps/web/src/lib/legal.ts`), `OPERATOR_LOCALE` (`z.enum(["en", "pl"])` in `platform/config-ops.ts` → `z.enum(userLocales)`, default `en`), the push payload `lang` (`packages/core/src/notices/push.ts` → `userLocaleSchema`).
- Remove each alias type; import `UserLocale` at each use. No alias such as `type DocsLocale = UserLocale` stays (one name).
- D11: `legalLangs` equals `userLocales` in order (`["pl", "en"]`), so it becomes `userLocales`. `SHOT_LOCALES` (`["en", "pl"]`) keeps its order, typed `readonly UserLocale[]`. A docs or web file imports from the core entry it already uses (`@ea/core` or `@ea/core/web`).
- Not in scope (D10, mail language): `packages/core/src/{sim,testmail,outgoing,replies,triage}/`, `apps/server/src/modules/{loops,replies,actions,triage}/`, test code and `apps/web/e2e/`.

## Step 2 — lint rule (D12)

- **File** `tools/eslint-rules/no-locale-union.js`, registered in the local plugin `ea` (`tools/eslint-rules/index.js`) as `ea/no-locale-union`. It reports:
  - a `TSUnionType` of exactly two `TSLiteralType` members with the values `"en"` and `"pl"` (any order);
  - an array of exactly the two string literals `"en"` and `"pl"` (any order) under `as const`;
  - a call `z.enum([...])` (callee property `enum`) whose array, with or without `as const`, has exactly those two strings.
  - Message: `Use UserLocale, userLocales or userLocaleSchema from @ea/core (packages/core/src/tenancy.ts).`
  - A union with a third member (`"pl" | "en" | "other"`) is not reported.
- `eslint.config.js`: the rule at `error` for `apps/docs/src/**`, `apps/web/src/**`, `apps/server/src/**`, `packages/core/src/**` (`ts`, `tsx`, `astro`), with `ignores` for test code (`**/*.test.{ts,tsx}`, `**/*.test-helper.ts`), for `packages/core/src/tenancy.ts` (the one list) and for the mail-language folders of step 1. The `.astro` block registers `plugins: { ea }` itself (the existing `ea` block covers no `.astro`). A mail-language site outside those folders uses a named mail-language type or `// eslint-disable-next-line ea/no-locale-union -- mail language` (D12).
- `docs/code-patterns.md` § Texts carry a locale: one sentence: "The language of a product text is `UserLocale`; the lint rule `ea/no-locale-union` bans a copy. The language of a mail or a draft is another concept."

## Test

1. Rule test `apps/server/src/platform/locale-lint.test.ts` (the harness of `time-lint.test.ts`, the test of `no-time-literals`): invalid `type L = "en" | "pl";`, `type L = "pl" | "en";`, `const l = ["pl", "en"] as const;`, `const s = z.enum(["pl", "en"]);`, `const s = z.enum(["en", "pl"] as const);`; valid `type L = "pl" | "en" | "other";`, `type L = UserLocale;`, `const s = z.enum(userLocales);`, `const order: readonly UserLocale[] = ["en", "pl"];`, `const l = ["pl", "en", "de"] as const;`.
2. Config: the `OPERATOR_LOCALE` cases of `config.test.ts` pass unchanged (`en` default, empty → `en`, `pl` accepted, `de` refused with the key named).
3. Push payload (`notices/push.test.ts`): the existing cases pass unchanged; add one case if none exists: `lang: "de"` is refused by the payload schema.
4. Mutation in a covered file: add `export type X = "en" | "pl";` to `apps/docs/src/shots.ts`; `bun run lint` fails with `ea/no-locale-union`. Revert.
5. Mutation in an `.astro` file: give `Public.astro` a prop `lang?: "en" | "pl"`; `bun run lint` fails. Revert.
6. Mutation in an ignored folder: the same line in `packages/core/src/replies/` passes lint. Revert.
7. `bun run typecheck` (it runs `astro check` for docs) passes.

## Done when

- `bun run lint` passes with the rule at `error` on every covered file (so no copy is left).
- Cases 1–7 hold; cases 4–6 are named in the final message.
- Proof: `plan.md` § Proof with `NN=02`.

## Out of scope

The operator texts and renderers (stage 01); renaming `UserLocale`; mail-language types; i18n keys.
