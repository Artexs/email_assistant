---
opened: 2026-11-13
---

# F098 · E7-T1 Polish UI (i18n frame first)

## Outcome

The web panel and the Telegram bot speak Polish or English, in the language of each user. The panel follows the user's choice in the Account card, else the browser language; Telegram and the auth mails follow the same stored choice, else Polish. The Telegram link step shows a consent text and refuses a link without it. The frame lands before the next panel pages (E4-A), so every new English text needs its Polish text from the start.

## Scope

- Panel i18n frame: a locale store, `t()` and plurals per locale, a Polish dictionary with every English key, the language rule (S6 master plan D12, PD-037). Starting seam: `apps/web/src/i18n/`.
- The Account choice and `user.locale` in `/api/me`; the panel switches without a reload.
- Telegram texts and the server phrases that the panel shows, in one core texts registry (en, pl), switched on at once in one late stage.
- The Telegram consent text in the link step (S6 master plan D27; the agent's draft, P19).

## Out of scope

- Legal texts (the papers ticket, E7-T4), the delete dialog (the account data ticket, E7-T3), the pages of E4-A and the notice kinds of other epics: they add their own Polish texts in this frame.
- Operator notices, CLI output, logs and `deploy/` docs: they stay English.
- A feature flag for the language, and any DB migration.

## Acceptance

- `apps/web/src/i18n/pl.ts` has every key of `en.ts` with the same `{placeholders}` (typecheck and a unit test).
- With a Polish browser and no stored choice, every panel page shows Polish headings at phone and desktop width, with no horizontal overflow (Playwright).
- Choosing English or Polski in the Account card changes the panel at once and after a reload, and sets `users.locale` (integration and Playwright).
- A user with `users.locale` null or `pl` gets every Telegram notice, digest, bot reply and tap answer in Polish; `en` gets today's English texts byte for byte (integration).
- `POST /api/channels/telegram/link` without the current consent version answers 400 or 409 and makes no token; with it, one `web.telegram_consent` audit row and a link (integration and Playwright).

## Slices

Thirteen stages, one worker job each: 01 panel frame; 02 Polish dictionary; 03 static pages and the Polish browser spec; 04 language choice; 05 `[risky]` Telegram consent; 06–11 core texts registry (clock, labels, answers; action phrases; notices; approvals; digest; bot and command menu); 12 switch on; 13 panel phrases and docs. Order, parallel rules and reviews: [plan.md](plan.md) § "How to run (coordinator)". No migration, no `bun.lock` change, no owner checkpoint, no owner step.

## Sequenced

- Plan after: none (the plan uses only landed code: the public login F082, feature flags F087, notices as facts F088).
- Build after: F082 (in `spec/features/done/`).
- Gate: — (`docs/product/stage-2/05-execution-plan.md` §2.1 row 4). Advisory file overlap: stages 06–11 edit `packages/core/src/{digest,notices,outgoing}/` and `apps/server/src/modules/channels/`, which the repository split (F091) asks no other job to edit while one of its stages runs (it already changed `digest/would-do.ts`); stage 04 edits `AccountCard.tsx`, which the platform controls ticket (F099, security log) also edits.

## Notes

Absorbs S6c D12 and D27 (`tasks/planned/s6c-account-data.md` stages 3b, 4, 5). Open defaults: [questions.md](questions.md).
