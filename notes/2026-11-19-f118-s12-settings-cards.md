# F118 stage 12 — Settings cards: notes for the next worker

Ticket: `spec/features/active/F118-e9b-phone-channel-pwa-push-telegram-detail/` (stage 12). No migration. `TERMS_VERSION` NOT bumped (stage 13). Flags `telegram_minimal` and `web_push` stay OFF by default. Nothing is deployed.

## Carry-over of the stage 11 review (first commit)
- Link route default: a body with no `detail` KEEPS the stored level (`linkDetailOf` returns `keep`; the column default `minimal` covers a new member). The card always sends `detail`.
- Two-organization probe and a scope-free repo test (`web-telegram-detail.test.ts` tests 22 and 23).
- The organization row is read `FOR SHARE` (`getOrganizationForShare`) in `changeTelegramDetail` and in the link transaction; the link route checks the lock again inside the transaction (tests 24 and 25 hold the owner's open write).
- With the flag off the link route ignores a bad `detail` (the route reads it raw; `linkDetailOf` validates it only when the flag is on).
- `minimalEdit` keeps the text without the link line when the line would make the text longer than `MESSAGE_MAX_CHARS`.
- The link route checks the lock before the consent, like the PATCH route.

## Cards
- Link step and linked card: `components/telegram/TelegramDetail.tsx` (`TelegramDetailChoice`, `TelegramDetailLinked`, `preselectedDetail`), wired in `TelegramLink.tsx`. The choice renders only when the state holds `detail` (the server adds it only with the flag on).
- Lock card: `components/settings/TelegramLockCard.tsx`, mounted in `SettingsPage.tsx` when `GET /api/organization` holds `telegramMinimalLocked`.
- Route selects: `components/settings/NoticeRoutesCard.tsx` and the pure model `lib/notice-routes.ts`; mounted by `NotifySection` when `me.features` holds `web_push`.
- Texts: own group `i18n/texts/en-detail.ts` and `pl-detail.ts`.
- e2e: `apps/web/e2e/tests/telegram-detail.spec.ts` (flag off; link step and linked card; lock with a member context; routes with a member context).

## Decisions (not fixed by the stage file)
1. The consent tick stays required for BOTH levels in the link step: the server needs `consentVersion` to link at all, and a link records the consent. Only `full` needs it again in the change dialog.
2. The route card has a Save button (not auto-save) and a "Use the defaults" button that sends `null` for each stored group.
3. The default mark follows `routeDefaults` (the channels that exist now): a member with a device and no chat sees "Phone (default)".
4. A member (not owner role) sees the lock as text with no switch; an owner of a suspended organization sees the switch disabled.

## How to run the e2e (own DB)
`bun run db:worktree f118s12-e2e` makes `email_assistant_f118s12_e2e`; put the two URLs into the env as `E2E_DATABASE_URL` and `E2E_MIGRATOR_DATABASE_URL`; run under `flock /tmp/email-assistant-shared-tests.lock` with `CHROMIUM_PATH=/usr/bin/chromium` and a file filter. Drop the DB afterwards: `bun run db:worktree f118s12-e2e --drop`.

## Proof logs
Under `.f118s12-logs/` in the job worktree (untracked, in the shared git exclude): `mutation-*.log` (c01–c09 server and core guards of the carry-over; u01–u03 and e01–e06 panel guards), `e2e-*.log`, `proof-*.log`, `int-env-i.log`.
