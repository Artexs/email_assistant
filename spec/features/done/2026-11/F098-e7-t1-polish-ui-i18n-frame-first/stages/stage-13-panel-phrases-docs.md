# F098 stage 13 — Activity phrases per request, docs and the note

Part of [`../plan.md`](../plan.md). Decisions: P1, P7, D13, D18. Needs stages 05 and 12 landed. Review job before the land. Two steps.

After this stage the activity list of the panel shows its phrases in the panel's language, and the docs hold the rule for every later text.

## Step 1 — Activity phrases in the panel's language

**Goal.** `/api/activity` renders the AI line and the action phrases in the language of the panel (D13).

**Files.** `apps/server/src/modules/reports/{routes,activity}.ts`, `apps/server/test/integration/web-activity.test.ts`.

**Interfaces.**

- `activityRoutes` reads `const profile = await getUserAuthProfile(deps.db, c.get("session").userId)` (from `../tenancy`) and `const locale = resolveLocale(profile?.locale ?? null, firstLanguageTag(c.req.header("accept-language")))`, and passes `textsFor(locale)` to `listActivity` (a new last parameter `texts: CoreTexts`). Remove the stage-06 `textsFor("en")` and its comment from `activity.ts`.
- The answer shape does not change.

**Decisions.** D13, P1.

**Test.** `web-activity.test.ts`, new cases with one triaged mail that has no actions (its `phrase` is the "stays in" text) and a session user:

1. User locale null, header `accept-language: pl-PL,pl;q=0.9` → `items[0].phrase === "zostaje w INBOX"` (or the stay folder the fixture gives, through `textTables.pl.wouldDo.staysIn`).
2. User locale null, no header → the English phrase.
3. User locale `en`, header `pl-PL` → English. User locale `pl`, header `en-US` → Polish.

**Check.** `bun test apps/server/test/integration/web-activity.test.ts apps/server/test/integration/reports-activity.test.ts`.

**Done when.** Cases 1–3 pass; old cases pass unchanged.

**Out of scope.** Other routes (none returns our phrases, `plan.md` D13).

## Step 2 — Docs and the note

**Goal.** The next ticket finds the rule (D18).

**Files.** `docs/code-patterns.md`, `.agents/limen/styleguide.md`, `docs/architecture.md`, `docs/modules.md`, the capability pages that `docs/capabilities/README.md` lists for the web panel and for digests and notices (Telegram), new `notes/<build day>-polish-ui.md`.

**Interfaces.**

- `docs/code-patterns.md`: a new section "Texts carry a locale" with: the two null rules (panel: browser; Telegram and auth mails: Polish); the web dictionaries (`en.ts`, `pl.ts`, `enPlurals`, `plPlurals`, `t`, `tp`, `useLocale()` on the first line of every island, `client:only="react"`); the core registry (`packages/core/src/texts/<section>.ts`, en and pl side by side, `textsFor(locale)`, render functions take `texts` last); where each Telegram path takes its locale (row, link, token owner); `resolveLocale` + `firstLanguageTag` for any route that returns our phrases to the panel; names and addresses never take a Polish case ending; the consent version bump (`TELEGRAM_CONSENT_VERSION`) when the Telegram content changes. And a checklist "Add a user-visible text" (panel key in both files; core section entry in both languages; a test with a fixed Polish value). Replace the line "Texts are `en` today…" in § Notices are facts and extend the web line ("Every user-visible string is a key in `apps/web/src/i18n/en.ts`") with `pl.ts`.
- `.agents/limen/styleguide.md`: the Web bullet says "every visible string is a key in `apps/web/src/i18n/en.ts` and `pl.ts` through `t()` or `tp()`"; one Prefer bullet: "Texts carry a locale: `docs/code-patterns.md` § Texts carry a locale."
- Capability pages (PD-009): on the web panel page, rules "The panel language is `users.locale`, else the browser language", "The Account card sets `users.locale` (`PATCH /api/me/locale`)", "A Telegram link needs the consent of version `TELEGRAM_CONSENT_VERSION`"; on the digest-and-notices (Telegram) page, "Every Telegram text follows `users.locale`; null → Polish"; entry points and tests of this ticket; refresh the "Checked against" line. If a page does not exist yet, skip it and name it in the final message. `bun test apps/server/src/capability-map.test.ts` must pass.
- `docs/architecture.md`: the `users` row: `locale` is set by `org:invite` and the Account choice (`PATCH /api/me/locale`); the `audit_log` web events include `web.telegram_consent` (stage 05 may have added it; check).
- `docs/modules.md`: the `channels` section loses `texts.ts` and names `packages/core/src/texts/`; the `tenancy` routes list `PATCH /me/locale`; the `reports` activity route reads the request locale.
- The note: what a later agent needs and cannot see in the code quickly — why the islands are client-only (hydration), the `useLocale()` first-line test, the D19 placeholder mapping, the glossary's home (`spec/features/…/F098-…/plan.md` until a docs page takes it), and the deploy effect (null-locale users get Polish Telegram after this stage).

**Decisions.** D18.

**Test.** None (docs). `bun run lint` passes (Markdown is not linted; the check is that no code changed in this step).

**Check.** `git diff --stat` of this step lists only docs, the styleguide and the note; `bun test apps/server/src/capability-map.test.ts`.

**Done when.** The files are written and the capability map test passes.

**Out of scope.** `spec/build.md`, `docs/product/stage-2/*` (the coordinator owns them).

## Stage done when

- Steps 1–2 are done. `grep -rn 'textsFor("en")' apps packages --include=*.ts | grep -v '\.test\.ts'` finds nothing.
- The Proof chain for page stages in `plan.md` § Proof (with `NN` = 13) prints `PROOF_OK`.
