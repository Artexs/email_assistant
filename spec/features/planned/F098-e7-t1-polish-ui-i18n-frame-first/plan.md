# F098 plan — Polish UI (i18n frame first)

> **Status 2026-11-14 — planned.** Eight stages written; cold review in § "Cold review". Build after the public login ticket (F082, done).

Workers read `ticket.md`, this file and their one stage file. A gap or a deviation is a question in the final message, not a choice: the coordinator decides from § Input or asks the owner.

## Input

### Owner's words and the decisions they set (word for word)

- PD-037 (`docs/product/stage-2/decisions.md`): "E7 Polish UI stays: panel, auth mails and Telegram texts follow `users.locale`; the i18n frame (`pl.ts` key check, language rule, Account choice) is the first E7 ticket after F082, so E4 pages ship pl and en." Owner: "Okay, so go with the default values".
- Epic decision 1 (`epics/E07-platform-and-trust.md` § Discovery): "Polish UI: keep; also Telegram texts by `users.locale`; the i18n frame is the first ticket after F082 so E4 builds both languages. [yes]"
- Ticket split (`epics/E07-discovery-notes.md` §11): "E7-T1 Polish UI | i18n frame first (type check, language rule, Account choice), panel texts, auth mails check, Telegram texts per `users.locale`, Telegram consent text | 6 | F082 | S6c D12, D27".
- S6 master plan D12 (`tasks/active/s6-pre-sale.md`): "`apps/web/src/i18n/pl.ts` with the same keys as `en.ts` (a type check and a unit test fail on a missing key). The language: `users.locale` (`pl`, `en` or null); null → the browser language (`navigator.language` starts with `pl` → Polish), else English. The Account card has the choice. Auth mails use `users.locale`, else the `--lang` of the invite." (Its last sentence "Telegram texts stay as they are (P12)" is replaced by PD-037.)
- S6 master plan D27: "The Telegram link step in the panel shows a consent text per user that names what goes to Telegram (sender, subject, AI summary, draft text); the link is refused without it". P19: "the Telegram consent text is the agent's draft."
- Architecture review §3.10 (`docs/product/stage-2/06-architecture-review.md`): "one `Locale` type in core, a texts registry per surface (`core/texts/<surface>/{en,pl}.ts`) with a key-parity test, and the outbox renderer takes the locale from the row. The web keeps `en.ts`/`pl.ts` with the same parity test." Standard 7: "Every text a user reads comes from a locale table in core or in `apps/web/src/i18n`, with a key-parity test between `en` and `pl`."
- The public login ticket, B1 (`spec/features/done/2026-11/F082-s6b-public-login/plan.md`): "A user without `users.locale` gets Polish mails. `org:invite --lang` defaults to `pl`."
- Notices as facts, D16 (`spec/features/done/2026-11/F088-notices-as-facts/plan.md`): "A user without `users.locale` gets `pl`… Until E7-T1 adds `pl` texts, every renderer prints its `en` text for both locales and ignores `opts.locale`."
- Owner rules for this planning job (2026-11-14): "no owner checkpoints for confirmation; an owner step only for what needs the owner's hands (real secrets, real money); small questions get a default in questions.md."

### Product decisions

- **P1 Panel language rule.** `users.locale` when set; else the browser language (`navigator.language` starts with `pl`, any case → `pl`), else `en` (D12). Reason: owner decision D12. Rejected: Polish for null as on Telegram (the panel can see the browser; the server cannot).
- **P2 Telegram and auth mail language rule.** `users.locale`, null → `pl` (F082 B1, F088 D16). The auth mails already follow it (`localeOf` in `apps/server/src/web.ts:308`); this ticket only proves that the Account choice reaches them (stage 03).
- **P3 Account choice (default).** A select with two options, "Polski" and "English" (each in its own language). Saving writes `users.locale`. There is no "browser language" option: a null value cannot be set again. Reason: two stored values cover every case; a third option needs a nullable write and a text that explains Telegram's different null rule.
- **P4 Telegram consent (default text, P19).** The link block shows the consent text (stage 04 holds the exact pl and en texts) and a checkbox; the "Link Telegram" button is off until the box is ticked. The server refuses a link request without the current consent version. Each accepted link request writes one audit row. Chats linked before this ticket keep their link (default). The operator CLI `telegram:link` stays as it is (default: an operator tool for the operator's own account).
- **P5 No feature flag for the language (default).** ADR 0027 point 6 says "Flags are not product settings"; the language is a user setting with its own switch (the Account choice), which is also the kill path. Rejected: a `polish_ui` flag per organization (public pages have no organization; Telegram producers read chats across organizations).
- **P6 Polish register and glossary (default).** Informal second person, imperative for actions ("Wpisz", "Zapisz"), short sentences, no English loan words where a common Polish word exists. One word per idea, from the glossary below. The same glossary binds the panel (stage 02) and Telegram (stages 05–07).
- **P7 Out of the frame.** Operator notices (`modules/channels/operator.ts`), CLI output, log lines, `deploy/` docs, outgoing mails to delegates (`packages/core/src/outgoing/templates.ts` keeps its own pl and en branches) and IMAP folder names (`MOVE_TARGET_NAMES`, `INBOX`, `Drafts` in the mailbox) stay as they are.
- **P8 Public pages (default).** `/login`, `/setup`, `/forgot` use this browser's stored choice (`localStorage`, written by the panel after a sign-in or a choice), else the browser language. The static pages `/` and `/404` show their few lines in both languages (Polish line, then English line). The legal stubs `/legal/<lang>/<doc>` render in their `<lang>`.
- **P9 Text review.** No owner reading step (owner rule). The review jobs of stages 02, 06 and 07 read every new Polish text against the glossary and P6.

### Glossary (P6; default, owner may change it in `questions.md` item 1)

| English | Polish | Note |
| --- | --- | --- |
| mailbox | skrzynka | "skrzynka pocztowa" only where it is ambiguous |
| mail (one message) | wiadomość | plural "wiadomości" |
| digest | podsumowanie | |
| notice | powiadomienie | |
| sync | synchronizacja | |
| AI triage | klasyfikacja AI | |
| category Urgent / Reply / Delegate / Unsure / Info / Notification / Spam | Pilne / Odpowiedz / Przekaż / Niepewne / Info / Powiadomienie / Spam | `act_cat_*`, Telegram labels |
| delegation | zlecenie | "delegacja" means a business trip |
| delegate (person) | wykonawca | |
| reminder | przypomnienie | |
| draft | szkic | the IMAP folder name "Drafts" stays as it is |
| approval / approve | zatwierdzenie / zatwierdź | |
| send | wyślij | |
| reject | odrzuć | |
| undo | cofnij | |
| shadow mode / assist mode | tryb podglądu / tryb asystenta | |
| owner / assistant (role) | właściciel / asystent | |
| organization | organizacja | |
| account paused | konto wstrzymane | |
| quiet hours | cisza nocna | |
| rule / VIP / blocklist | reguła / VIP / lista blokowanych | |
| sign in / sign out | zaloguj się / wyloguj się | |
| password | hasło | |
| link (Telegram) | połącz | "połączono" for linked |

### Design decisions

- **D1 Panel locale store** (`apps/web/src/i18n/index.ts`, stage 01). Module state `current: UserLocale` (start `en`), `getLocale()`, `setLocale(locale)` (sets `current`, writes `localStorage["ea.locale"]` in a `try`, sets `document.documentElement.lang`, notifies subscribers; no-op when equal), `initLocale()` (stored value if it is `pl` or `en`, else `localeOfLanguageTag(navigator.language)`; runs once at module load when `typeof window !== "undefined"`), `useLocale()` (`useSyncExternalStore`), `t(key, vars)`, `tp(key, count, vars)`, `dateLocale()` (`"pl-PL"` or `"en-GB"`). Reason: `t()` is called in about 67 files as a plain function; a module store keeps every call site. Rejected: a React context for `t` (every call site changes).
- **D2 Islands render on the client only** (`client:only="react"`, stage 01). The static build cannot know the user's language; a server-rendered English island hydrated with Polish text is a hydration mismatch. Rejected: one build per language (`/pl/...` routes, two copies of every page); render English first and switch after mount (a flash on every load and hydration errors).
- **D3 A language change re-renders the island.** Every island's default export calls `useLocale()` on its first line, so a `setLocale` re-renders the whole tree with the state kept; a unit test checks each `src/islands/*.tsx`. Rejected: `location.reload()` (loops when storage is blocked); a `key` remount (drops form state and misses texts computed in the island body).
- **D4 One language rule in core** (`packages/core/src/texts/locale.ts`, stage 01): `localeOfLanguageTag(tag)`, `resolveLocale(userLocale, tag)`, `firstLanguageTag(acceptLanguage)`, `pluralCategory(locale, count)`. The panel calls `resolveLocale(me.user.locale, navigator.language)`; the server calls `resolveLocale(users.locale, firstLanguageTag(Accept-Language))` for panel answers (D13). Exported from `@ea/core` and `@ea/core/web`, with `userLocales`, `userLocaleSchema`, `UserLocale`.
- **D5 Dictionaries.** `en.ts` keeps `export const en = {…} as const` and `TextKey`; `pl.ts` is `export const pl: Record<TextKey, string>` (a missing or an extra key fails `bun run typecheck`). Plural texts leave the flat tables: `enPlurals` (`{ one, other }`) and `plPlurals` (`{ one, few, many }`), keyed by `PluralKey`; `tp` picks the form with `pluralCategory` (Polish `other`, for fractions, uses `many`). A unit test checks: same `{placeholder}` names per key and per plural form; no empty text. Stage 01 sets `dictionaries = { en, pl: en }` (no visible change); stage 02 adds the real `pl`.
- **D6 Dates.** The panel's `Intl` formats use `dateLocale()`. `formatClock(at, timeZone, now, locale)` and `formatDay(at, timeZone, locale)` in core take a required locale and fixed word tables (stage 05): en as today; pl months `sty lut mar kwi maj cze lip sie wrz paź lis gru`, weekdays `niedz. pon. wt. śr. czw. pt. sob.` (index 0 = Sunday). Shapes stay: `HH:MM`, `D Mon HH:MM`, `D Mon YYYY HH:MM`, `Wkd D Mon`.
- **D7 Titles and `<html lang>`.** The Astro layouts get a `titleKey` and print the English title in the static HTML (crawlers and the first paint). On the client, `AppShell` and `AuthCard` set `document.title` to `<t(title)> · <t("brand")>` in an effect that depends on the locale; `setLocale` sets `lang`.
- **D8 Locale API** (stage 03). `meSchema.user` gains `locale: z.enum(userLocales).nullable()`. `PATCH /api/me/locale` with body `{ locale: "pl" | "en" }` (`localeBodySchema` in `@ea/core/web`) → `setUserLocale(db, userId, locale)` → 204. Any member, own user only. Allowed while the organization is suspended (`SUSPENDED_WRITE_ALLOW`; like the terms, it changes no mail and no organization data). No audit row (a display setting; the digest times write none either).
- **D9 Core texts registry** (`packages/core/src/texts/`, stages 05–07). One file per section; each holds the section interface and `export const <section>Texts = { en: {…}, pl: {…} } satisfies Record<UserLocale, <Section>Texts>`, so en and pl sit side by side for review and TypeScript enforces parity. `index.ts`: `interface CoreTexts { locale: UserLocale; <section>: <Section>Texts; … }`, `textTables: Record<UserLocale, CoreTexts>`, `textsFor(locale)`. Render functions take `texts: CoreTexts` as their last, required parameter. One surface folder, not `texts/telegram/`: the same phrases serve Telegram and the activity list of the panel. Rejected: a `locale` parameter with a lookup inside each function (the Polish tables could not be unit-tested while D10 holds them); texts kept inline per render file (Polish spread over 10 files; the review asks for a registry).
- **D10 One switch for Telegram.** Until stage 08, `textsFor(locale)` returns `textTables.en` for every locale (`const POLISH_MESSAGES_ON = false` with a comment naming this plan). Stage 08 deletes the constant. Reason: stages 05–07 land one by one; a deploy of `master` between them (any ticket may deploy) would send mixed-language chats. Core unit tests use `textTables.pl` directly. `formatClock` in the panel takes the panel locale and is not held.
- **D11 Polish sentences are whole.** A Polish text never reuses English word order or English fragments. Where English composes a phrase (`describeActions`: tense word + verb), the texts interface keys the phrase by tense (stage 05 gives the interface). Counts use `pluralCategory`.
- **D12 Bot replies** (stage 07). A linked chat answers in `link.locale` (`LinkedChat.locale`, F088 D16). `/start` with a used or expired token answers in the token owner's locale: `consumeLinkToken` returns `userId` with `used` and `expired`, and the bot reads `users.locale ?? "pl"` through `findUserLocale(db, userId)` in the channels repo. An unknown token gets no answer (as today).
- **D13 Server phrases in the panel** (stage 08). The activity route renders `aiText` and the action phrases with `textsFor(requestLocale(c, users.locale))`, where `requestLocale` = `resolveLocale(users.locale, firstLanguageTag(Accept-Language))` (browsers send `Accept-Language` with every `fetch`). No other route returns our phrases (checked: `packages/core/src/web/*.ts` has `phrase` and `aiText` only in `activity.ts`).
- **D14 Consent** (stage 04). `TELEGRAM_CONSENT_VERSION = "2026-11-14"` and `telegramLinkBodySchema = z.object({ consentVersion: z.string().min(1).max(32) })` in `packages/core/src/web/telegram.ts`. `POST /api/channels/telegram/link`: no or bad body → 400 (`parseBody`); a version other than the current → 409 `telegram_consent_outdated`; else one transaction: `recordAudit` (`web.telegram_consent`, actor the user, data `{ via: "web", version }`) and `createLinkToken(trx, …)`. A later change of the consent text bumps the version (comment next to it).
- **D15 Test fixtures** (stage 08). `createOrgWithMailbox` and `addMember` in `apps/server/test/integration/fixtures.ts` create users with `locale: "en"`, so the existing English assertions keep their meaning; new cases cover null → `pl` and `pl`. The e2e seed keeps null users (an English browser gives the English panel; no e2e asserts a Telegram text).
- **D16 Old cards (accepted gap).** Rows queued since the notices-as-facts deploy carry `locale = 'pl'` for null users while their stored text is English. After stage 08, a tap on such an approval card appends a Polish status line to the English card (F088 D17 keeps the stored bytes). Cards expire within 48 h.
- **D17 Between stages (accepted).** After stage 02 a Polish panel shows English action phrases and AI lines in the activity list until stage 08 (D10, D13).
- **D18 Seams for later tickets.** A new panel text is a key in `en.ts` and `pl.ts` (typecheck); a new notice kind or bot text adds an entry to a section of `packages/core/src/texts/` with en and pl; a route that returns our phrases to the panel uses `requestLocale`. Stage 08 writes this as `docs/code-patterns.md` § "Texts carry a locale".

## Facts checked

1. Bun 1.4.4 (`.bun-version` 1.4.4), probe 2026-11-14: `new Intl.PluralRules("pl").select(n)` gives `0:many 1:one 2:few 4:few 5:many 12:many 14:many 21:many 22:few 25:many 112:many 1.5:other`; `en` gives `0:other 1:one 2:other`. `Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric" })` gives `1 grudnia 2026`; `dateStyle: "medium"` gives `1 gru 2026` (en-GB: `1 Dec 2026`).
2. `apps/web/src/i18n/en.ts`: 431 keys, one `t()` at the end of the file; 67 files import `../i18n/en` (12 of them `.astro`); every island is `client:load` (8 pages). Plural pairs: `auth_error_banner_one/_many`, `ob_mailbox_done_one/_many`, `ob_rules_one/_many`, and `expired_suffix` (count, no singular) (grep, HEAD `3bdb753`).
3. Literal texts outside `en.ts` in the web: `components/ui/dialog.tsx:65,100` and `components/ui/sheet.tsx:68` ("Close"). `Intl` with a fixed locale: `lib/trial-date.ts:3` (`en-GB`), `components/settings/AccountCard.tsx:21` (`undefined`). `lib/legal.ts` `legalLang(navigator.language)`.
4. `users.locale text CHECK (locale IN ('pl','en'))`, nullable; `userLocales`, `UserLocale`, `userLocaleSchema` in `packages/core/src/tenancy.ts:11-13`. `getUserAuthProfile` returns `locale` (`modules/tenancy/repo.ts:236-255`). No route writes `users.locale`; `/api/me` does not return it (`modules/tenancy/routes.ts:41-71`, `packages/core/src/web/me.ts:36`).
5. `LinkedChat.locale` is `users.locale ?? "pl"` (`modules/channels/repo.ts:61`); every producer passes it to `queueNotice`; the registry `packages/core/src/notices/renderers.ts` ignores `opts.locale`; `renderNoticeEdit` gets the row locale (`callbacks.ts:207`).
6. English texts that users read in Telegram: `packages/core/src/digest/{notices,approvals,digest,would-do,ai-text,answers,labels,local-time}.ts`, `notices/kinds.ts` (`MAILBOX_REMOVED_TEXT`), `apps/server/src/modules/channels/{texts,commands,callbacks}.ts`; `telegram/bot.ts` sends the link texts. The panel shows `aiTextFor` and `describeActions`/`describeAction` output through `/api/activity` (`modules/reports/activity.ts:117-133`).
7. The web ties its words to core: `apps/web/src/lib/activity-text.test.ts` compares `act_cat_*`, `act_tag_*`, `undo_*`, the feedback toasts with `categoryLabels`, `categoryTag`, `UNDO_TEXTS`, `rightAnswer`, `pickedText`.
8. The link route takes no body today (`modules/channels/routes.ts:38-56`); `createLinkToken(db, ctx, userId, now)` runs in the caller's transaction when given one (`linking.ts:36-57`). `consumeLinkToken` returns `{ kind: "used" }` / `{ kind: "expired" }` without the user (`linking.ts:99-103`). `audit_log.event` has no CHECK list; `auditEvents` lives in `modules/audit/repo.ts:17-64`.
9. Integration fixtures create users with a null locale: `createOrgWithMailbox` (`apps/server/test/integration/fixtures.ts:53`), `addMember` (`:129`). The e2e seed creates null-locale users (`apps/server/src/scripts/e2e-seed.ts:122-200`); Playwright runs Chromium with its default `en-US` locale (`apps/web/e2e/playwright.config.ts`, no `locale`).
10. `react/jsx-no-literals` is an error on the islands, the shell and the auth components (`eslint.config.*:266-277`).
11. The repository split (F091, active) gates `packages/core/src/{triage,outgoing,digest,notices}/`, `channels/notices/` and `modules/{actions,mail}/` while its stages run (`spec/features/active/F091-repo-split/ticket.md` § Sequenced).

## Not verified

1. Astro 5.13 `client:only="react"` with the experimental CSP hashes: the island script loads under the meta CSP. Stage 01 checks it with `bun run web:build` and the full e2e suite, whose `cspErrors` helper fails on a CSP report.
2. Chromium sends `Accept-Language` from the Playwright `locale` option on `fetch` calls. Stage 08 does not depend on it in integration tests (they set the header); stage 02's Polish spec shows the effect only for `navigator.language`.
3. `useSyncExternalStore` re-renders the island with its state kept after `setLocale`. Stage 03's Playwright test types into a field, switches the language, and checks the field still holds the text.

## Done when

1. `pl.ts` has every key of `en.ts`, the same placeholders, and every plural form (typecheck; `apps/web/src/i18n/i18n.test.ts`).
2. The language rule holds in core and panel unit tests (P1, P2, D4).
3. With a `pl-PL` browser and a null-locale user, every panel page shows its Polish heading at both Playwright widths, with no horizontal overflow (`apps/web/e2e/tests/polish.spec.ts`).
4. The Account choice writes `users.locale`, switches the panel at once and after a reload, and keeps typed form state (`language.spec.ts`, `web-locale.test.ts`).
5. After a choice of English, the auth mail locale of the user is `en` (`web-locale.test.ts`).
6. Every Telegram text — each notice kind, the digest, the bot replies, the tap answers, the edits — is in Polish for `pl` and null users and byte-identical English for `en` users (core unit tests per section; `channels-locale.test.ts`).
7. The activity list shows Polish phrases for a Polish request and English for an English one (`reports-activity-locale` cases).
8. A link request without the current consent version is refused and makes no token; an accepted one writes one `web.telegram_consent` row (`web-telegram.test.ts`); the panel shows the consent and needs the tick (`onboarding.spec.ts`).
9. `docs/code-patterns.md` § "Texts carry a locale" exists; `docs/architecture.md` and `docs/modules.md` name the texts registry and the routes.
10. `bun run lint`, `bun run typecheck`, `bun run test:unit:ci`, `bun run test:int:ci` pass after each stage; `bun run web:build` and `bun run test:e2e` pass after each stage that changes `apps/web/`.

## Rules for every stage

- Read `ticket.md`, this file and your one stage file. Build only your stage. A gap or a deviation is a question in your final message, not a choice.
- English texts do not change. If an assertion on an English text fails, the code is wrong, not the test. Change an old test only where the stage file says so (a new argument, a renamed key, the fixture locale).
- A Polish text follows P6 and the glossary. Copy the Polish texts that a stage file gives word for word. Where a stage asks you to translate, write natural Polish, keep the emoji, the line breaks, `{placeholders}` and `/commands` of the English text, and never compose Polish from English fragments (D11).
- No literal text in web components (`react/jsx-no-literals`). Every new web text is a key in `en.ts` and `pl.ts` (from stage 02 on).
- Imports across server modules go through the module `index.ts`. After a stage that adds or removes an import between two modules, run `bun run graph:modules` and commit its output.
- Logs: never a text, a view, a locale value together with an address, a subject, a name or a consent text. Ids, kinds and codes only (`docs/code-patterns.md` § Logs).
- Format only the files of your stage (`bunx prettier --write <files>`). Never run `bun run format` or `prettier --write .` (an earlier builder did; the diff touched hundreds of files).
- No temporary files inside the worktree: `bun run lint` lints every `.ts` file. Use `/tmp/f098-sNN/`.
- Comments state the rule in one sentence and name an ADR or a ticket folder path if a source is needed. No bare codes (`D12`, `S6c`, `F088`) in new comments.
- Test data uses `example.test` addresses and marker strings. No secret or `.env` value in a test, a log or a commit message.
- No migration, no `bun.lock` change, no new dependency in any stage.
- e2e (stages 01–04, 08): this machine runs Playwright with the system Chromium. Before the first e2e run, give the job its own e2e database: `sed -i -E '/^E2E_(MIGRATOR_)?DATABASE_URL=/d' .env`, then `bun run db:worktree f098_sNN_e2e | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' | sed 's/^/E2E_/' >> .env` (NN = your stage). Never point e2e at the shared `email_assistant_e2e`. Run `test:e2e` only under `flock /tmp/email-assistant-shared-tests.lock` (fixed ports 8081 and 8092).
- Before each commit: `git diff --staged`; look for bugs, secrets, debug code and changes outside the stage.

## Proof

Each stage ends with one chain, after its last commit, with nothing after it. Stages 05, 06, 07 (no web change except tests under `apps/web/src/lib` and `apps/web/src/i18n`):

```
mkdir -p /tmp/f098-sNN && bun run lint > /tmp/f098-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f098-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f098-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f098-sNN/int.log 2>&1 && echo PROOF_OK
```

Stages 01, 02, 03, 04, 08 (they change pages):

```
mkdir -p /tmp/f098-sNN && bun run lint > /tmp/f098-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f098-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f098-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f098-sNN/int.log 2>&1 && bun run web:build > /tmp/f098-sNN/build.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f098-sNN/e2e.log 2>&1 && echo PROOF_OK
```

While it works, a worker runs only the tests of the code it changed. In the final message, list as proven only what a saved log shows.

## Owner checkpoints and owner steps

None. No migration, no secret, no money. The coordinator deploys as for any ticket; D10 makes a deploy between stages safe for Telegram. The owner may change the defaults in [questions.md](questions.md) at any time; a change of the glossary or a consent text after its stage landed is a small follow-up commit.

## Review

- Review job before the land (board reviewer: `spec/build.md` § TRACK, Sonnet 5.5, thinking high): stage 01 (every island, hydration, CSP), stage 02 (the Polish texts against P6 and the glossary), stage 04 `[risky]` (consent gate: try to make a token without consent by any request form), stage 06 and stage 07 (Polish Telegram texts, every render path), stage 08 (the switch: every Telegram path gets the row's or link's locale; English byte-identical).
- Stages 03 and 05 land on the worker's proof.

## Stages

| # | Stage | Risk | File |
| --- | --- | --- | --- |
| 01 | Panel i18n frame: locale store, `tp`, core language rule, client-only islands, titles, dates | normal | [stages/stage-01-panel-frame.md](stages/stage-01-panel-frame.md) |
| 02 | Polish panel texts: `pl.ts`, plural forms, parity test, bilingual static pages, Polish Playwright spec | normal | [stages/stage-02-polish-panel-texts.md](stages/stage-02-polish-panel-texts.md) |
| 03 | Language choice: `user.locale` in `/api/me`, `PATCH /api/me/locale`, Account select, sync after sign-in | normal | [stages/stage-03-language-choice.md](stages/stage-03-language-choice.md) |
| 04 | Telegram consent: versioned consent, refused link without it, audit row, panel checkbox | `[risky]` | [stages/stage-04-telegram-consent.md](stages/stage-04-telegram-consent.md) |
| 05 | Core texts registry, part 1: clock, categories, answers, AI line, action phrases; the hold | normal | [stages/stage-05-core-texts-registry.md](stages/stage-05-core-texts-registry.md) |
| 06 | Notice and approval texts in en and pl through the registry | normal | [stages/stage-06-notice-approval-texts.md](stages/stage-06-notice-approval-texts.md) |
| 07 | Digest and bot texts (commands, taps, link replies) in en and pl | normal | [stages/stage-07-digest-bot-texts.md](stages/stage-07-digest-bot-texts.md) |
| 08 | Switch on: drop the hold, fixtures, locale tests, panel phrases per request, docs | normal | [stages/stage-08-switch-on-docs.md](stages/stage-08-switch-on-docs.md) |

## How to run (coordinator)

1. Start when F082 is in `spec/features/done/` (true) and the NEXT rule of `spec/build.md` reaches this line. Move this folder to `spec/features/active/` and commit it before the first spawn.
2. Order: 01 → 02 → (03 and 05 may run at the same time) → 04 after 03 → 06 after 05 → 07 after 06 → 08 after 04 and 07. Land a stage before you spawn a stage that needs it. No stage has a migration or a `bun.lock` change.
3. Advisory (file gates are not a stop): while an F091 stage runs, prefer to hold stages 05–07 (they edit `packages/core/src/{digest,notices}/` and `modules/channels/`); if they run anyway and a land conflicts, resume the worker to merge `master` and prove again. Stage 03 and the platform controls ticket (F099) both edit `AccountCard.tsx`: same rule.
4. For each stage NN:

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F098" \
  'Implement F098 stage NN. Read spec/features/active/F098-e7-t1-polish-ui-i18n-frame-first/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: <the Proof chain of plan.md for this stage, NN filled in>. In the final message, list as proven only what a saved log shows.'
```

5. Stages 01, 02, 04, 06, 07, 08: start a review job on the stage branch before the land (`limen spawn --review --branch <stage branch> …` with the reviewer model; prompt: "Review F098 stage NN on <branch> against spec/features/active/F098-e7-t1-polish-ui-i18n-frame-first/plan.md and stages/stage-NN-<slug>.md. Check every numbered test exists and asserts what the stage says, the decisions it cites, and every new Polish text against plan.md P6 and the glossary. Quote file and line for each finding."). Land with `limen land --keep-open`; the land of stage 08 closes the ticket.
6. After each land, drop the job DB and the stage's e2e DB (`bun run db:worktree <name> --drop` from the main checkout; names printed by the prepare script and `f098_sNN_e2e`).
7. Deploy: any time; the first deploy after stage 08 is the one that changes Telegram. Tell the owner in the deploy message: "Telegram now follows the Account language; null = Polish."

## Planning progress

- [written] stage 01 · [written] stage 02 · [written] stage 03 · [written] stage 04 · [ ] stage 05 · [ ] stage 06 · [ ] stage 07 · [ ] stage 08
- [ ] cold review (`plan-review-1.md`), findings applied

## Cold review

Not run yet.

## Log

- 2026-11-14: Planned by a Limen planner job (Opus 5.5). No migration. Defaults in [questions.md](questions.md).
