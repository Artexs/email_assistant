FAIL b4c7423daabc65cd4a5ae5450da98cd255d2a3a0

The plan cannot be built as written. Two steps fail their own required checks: stage 05 fails `bun run typecheck`, and stage 03 fails `web-suspended.test.ts`. Also, five of the eight stages are well over the size limit of one job. HEAD is `b4c7423`, the candidate. The worktree stayed clean; I changed no file.

**Pre-mortem: which stage let a bug reach the user.** Stage 07 is the most likely one. Fact 6 (`plan.md:91`) lists every English text that users read in Telegram, but it does not list `telegram/polling.ts:10-15`. That file holds `BOT_COMMANDS`, the descriptions in Telegram's "/" menu. No stage covers them. After stage 08, every Polish chat still shows an English command menu. The stage 07 review checks "every Telegram path" against that same incomplete list, so it does not catch this. Second most likely: stage 02 gives no rule for panel texts that hold a number but are not in the plural tables (minor 6), so Polish number-word agreement can be wrong.

## Blocking (proven)

**B1 · major · proven — stage 05 step 3 fails `bun run typecheck` on master.**
- `stage-05-core-texts-registry.md:148` declares `export type DraftKind = "delegation" | "clarification" | "reminder"` in `texts/would-do.ts`. Step 1 exports it from `@ea/core` through `export * from "./texts"`.
- Master already has `export type DraftKind` in `packages/core/src/triage/payloads.ts:12` (F091 stage 04). It is exported through `triage/index.ts:8` and `core/src/index.ts:2`, and `digest/would-do.ts:1` on master imports it.
- Two `export *` lines with the same name give TS2308. I reproduced this with the repo's `tsc` in `/tmp/f098-review/ts`; the output is in `/tmp/f098-review/tsc-ts2308.log`.
- The plan's base `3bdb753` is older than this change, so the plan did not see it. A worker must rename the type or reuse the core one. Both are choices that `plan.md:5` forbids.
- Fix: import `DraftKind` from `../triage/payloads`. Also update ticket.md:40: F091 has already changed `would-do.ts`.

**B2 · major · proven — stage 03 step 1 makes `web-suspended.test.ts` fail.**
- `stage-03-language-choice.md:29` says to add `"PATCH /api/me/locale"` to both `WRITE_ROUTES` and `ALLOWED_WHEN_SUSPENDED`, and to change the count from 18 to 19.
- `apps/server/test/integration/web-suspended.test.ts:91` asserts `[...found].sort()` equals `[...WRITE_ROUTES, ...ALLOWED_WHEN_SUSPENDED].sort()`. `found` is a Set, so it holds the route once. The expected array would hold it twice, so the test fails.
- The existing allowed route `POST /api/me/terms` is only in `ALLOWED_WHEN_SUSPENDED` (`:51`), not in `WRITE_ROUTES` (`:29-48`). The comment at `:28` counts only `WRITE_ROUTES`, so it stays at 18.
- The stage's Done-when (`:45`) says "`web-suspended.test.ts` passes", so the worker cannot meet both the instruction and the check.
- Fix: add the route only to `ALLOWED_WHEN_SUSPENDED`, and keep the count at 18.

## Major (plausible: size estimates from line counts at HEAD)

The limit is about 300 changed lines and 90 minutes per job.

- **M1 · stage 02 is about 650 lines.** `pl.ts` mirrors `en.ts`, which is 475 lines with 431 keys. On top of that come `i18n.test.ts`, `polish.spec.ts`, three static pages and `legal.spec.ts` (`stage-02:10-108`). Translating 431 texts to the glossary does not fit in 90 minutes. Split: texts for the shell, auth and onboarding, then texts for mailboxes, settings, rules and activity, then the spec and the static pages.
- **M2 · stage 05 is more than 500 lines, with no review.** The changed functions (`formatClock`, `categoryTag`, `rightAnswer`, `aiTextFor`, `describeAction` and others) have 186 call sites in 33 files. The stage also adds six new en/pl text files and new tests. `plan.md:157` lets it land on the worker's proof alone, although it changes every Telegram render signature. Split: step 1+2, then step 3. Add a review job.
- **M3 · stage 06 is more than 550 lines.** `digest/approvals.ts` (439 lines, 44 English literals) and `digest/notices.ts` (135 lines, 17 literals) move into the registry: about 61 entries, each with an interface line, an en line and a pl line. There are also 38 test call sites to change and new pl tests. Split by step.
- **M4 · stage 07 is more than 500 lines.** About 66 strings move from `digest.ts`, `commands.ts` and `callbacks.ts`. `linking.ts`, `bot.ts` and four test files also change. The stage file leaves `status`, `switch`, `taps` and `DigestTexts` as `{ … }` (`stage-07:165,208-210`), so the worker designs about 50 entries. Split by step.
- **M5 · stage 08 is about 600 lines.** `channels-locale.test.ts` alone (7 paths × 3 users, setup copied from 6 test files, `stage-08:290-301`) is likely 300–400 lines. The stage also changes the fixtures, the activity route and its tests, and five docs plus a note. Split: the switch and the locale test, then the activity route and the docs.

## Minor

1. **Proven — stage 07 Done-when cannot pass.** `stage-07:244` requires `grep -rn "Something went wrong\|Commands:\|Already saved" apps/server/src` to find nothing. `telegram/polling.test.ts:34` and `:159` contain `setMyCommands:`, which matches `Commands:`.
2. **Proven — stage 08 Done-when conflicts with its own test.** `stage-08:362` requires no `textsFor("en")` anywhere in `apps` or `packages`. Test 1 of the same stage (`:275`) contains `textsFor("en") === textTables.en`.
3. **Proven — stage 05 names a folder that does not exist.** Test 1 (`stage-05:190`) uses the folder of `AI/Newsletters`. `triage/planners.ts:18-23` has only AI/Info, AI/Notifications, AI/Spam and AI/Manual.
4. **Proven — stage 06 line 102 contradicts itself.** It first says to map a null address to `texts.common.unknownSender`, which is "(unknown sender)". It then says the English value stays "(unknown)" and adds `unknownAddress`. Today's code is `notices/renderers.ts:96`.
5. **Proven — gap: the command menu.** Same as the pre-mortem: `polling.ts:10-15` `BOT_COMMANDS` has no stage. The plan should decide: either `setMyCommands` with `language_code: "pl"`, or English stays on purpose (then add it to P7).
6. **Proven — gap: stage 02 has no rule for texts with a number outside the plural tables.** These are `gate_go`, `gate_no_go` and `gate_too_few` (`{kept}`), `retention_line` (`{days}`) and `digest_help` (`{max}`) at `en.ts:276-278,299,326`. Stage 06 has a rule for this case (`stage-06:10`, put the value after a colon or use `pluralCategory`); stage 02 does not.
7. **Proven — no review covers some Polish texts.** P9 (`plan.md:31`) names reviews only for stages 02, 06 and 07. Stage 05 asks the worker to translate `pick(true)` and `picked(false, …)` (`stage-05:108`), and stage 05 has no review.
8. **Proven — acceptance 2 is only partly tested.** `ticket.md:27` asks for "every panel page" at both widths with no horizontal overflow. `polish.spec` (`stage-02:266-269`) does not visit `/setup`, and it checks overflow only on the four pages after sign-in.
9. **Plausible — stage 01 changes an English date.** `AccountCard.tsx:21` today formats with the browser default (`undefined`; "Nov 14, 2026" in en-US). `dateLocale()` gives en-GB ("14 Nov 2026"). This conflicts with "no user sees a change" (`stage-01:5`) and with "English texts do not change" (`plan.md:120`).
10. **Proven — `initLocale` is unclear.** `stage-01:82,92` do not say whether `initLocale` sets the current locale and `<html lang>`, or whether it writes to `localStorage`. P8 (`plan.md:30`) says storage is written only after a sign-in or a choice. Stage 02 test 1 (`stage-02:266`) needs `lang="pl"` before sign-in.
11. **Proven — the overlap note is incomplete.** `ticket.md:40` names only `{digest,notices}`. Stage 05 also edits `outgoing/quote.ts` and stage 06 edits `outgoing/sender.ts`; F091 also blocks other jobs under `outgoing/`.
12. **Proven — small fact drift.**
    - Fact 2 says 12 `.astro` importers; the count is 13.
    - Fact 4 gives `me.ts:36`; `meSchema.user` is at `:38`.
    - `stage-03:11` says `telegram-helpers.ts` builds a `Me`. It builds `UserFromGetMe` (`:4`).
    - `stage-04:111` says stage 04 needs "the settings page as stage 03 left them", but `TelegramLink` is on the Mailboxes and Onboarding pages.
13. **Plausible — capability pages.** `docs/capabilities/` and `capability-map.test.ts` are absent at this commit but present on master (F095). `plan.md:130` handles this, but `plan.md:114` (Done when 9) runs that test without the same "if it exists" condition.

## Checks I ran

- `git rev-parse HEAD && git status --short && …`: exit 0. HEAD is `b4c7423…`, the same as the candidate, and the status output is empty.
- `bun install --frozen-lockfile`: OK, 967 packages.
- `tsc --noEmit` on a two-module `export *` reproduction: TS2308. The output is saved in `/tmp/f098-review/tsc-ts2308.log`.
- `git grep` on master: `DraftKind` is at `triage/payloads.ts:12`.
- Bun 1.4.4 probe of `Intl.PluralRules("pl")` and `DateTimeFormat("pl-PL")`: matches plan fact 1.
- Playwright source: `playwright/lib/index.js:247` defaults `locale` to `"en-US"`. Fact 9 holds.
- The web e2e config has `workers: 1` (`playwright.config.ts:17`), so `language.spec` cannot race the other specs.
- Facts 3, 5, 8 and 10 match the code: `tenancy.ts:11-13`, `repo.ts:236-255`, `web.ts:308`, `channels/repo.ts:61,116`, `linking.ts:36-57,99-103`, `routes.ts:38-56`, `eslint.config.js:266-277`.
- I did not run the lint, unit, integration or e2e suites. The diff is plan text only, so they would not test any claim in this review.

## Note check

- HEAD is the candidate b4c7423: proven. `git rev-parse HEAD && git status --short && git grep -n "export type DraftKind" master -- packages/core/src/triage/payloads.ts && grep -n "ALLOWED_WHEN_SUSPENDED\].sort" apps/server/test/integration/web-suspended.test.ts && grep -n "description:" apps/server/src/modules/channels/telegram/polling.ts` exited 0 and printed `b4c7423daabc65cd4a5ae5450da98cd255d2a3a0`.
- Every finding quotes file:line with a rank and a label: proven. Evidence is this message: B1–B2, M1–M5 and minor 1–13 each have a file:line, a rank and a label.
- Plan facts are checked against the code at this commit and at master, including stage size: proven for the facts behind B1, B2 and minor 5, through the command in the first line and `/tmp/f098-review/tsc-ts2308.log`. For the other facts and the stage-size estimates, I read the code in earlier bash calls that joined commands with `;` or `|`. Under the note rule those calls are not proof, so those facts are not proven by a qualifying command.
- The first line is `PASS <sha>` or `FAIL <sha>`, and FAIL only for a proven break: proven. The first line is `FAIL b4c7423…`. It rests on B1 and B2, which the command in the first line and `/tmp/f098-review/tsc-ts2308.log` show.
- Easy-to-miss rule "Review; do not rewrite the candidate.": followed. The same `git rev-parse HEAD && git status --short && …` command exited 0, and `git status --short` printed nothing. I wrote files only in `/tmp/f098-review/` and in the job note outside the worktree.
