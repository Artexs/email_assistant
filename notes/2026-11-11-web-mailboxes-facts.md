# S5b web mailboxes and onboarding: facts and deviations

Source: `spec/features/done/2026-11/F051-s5b-web-mailboxes-onboarding/plan.md` (facts 1–11, B1–B17, Log). Built 2026-11-11 in the worktree `task/s5b-web-mailboxes-onboarding`. Read this note before you change the mailbox routes, the delete function or the e2e setup.

## Provider facts (fact 1)

Pages read on 2026-11-10. All presets use IMAP port 993 and SMTP port 465 with implicit TLS. The user name is the full address.

| Preset    | IMAP host             | SMTP host             | Secret kind    |
| --------- | --------------------- | --------------------- | -------------- |
| `interia` | `poczta.interia.pl`   | `poczta.interia.pl`   | `password`     |
| `gmail`   | `imap.gmail.com`      | `smtp.gmail.com`      | `app_password` |
| `onet`    | `imap.poczta.onet.pl` | `smtp.poczta.onet.pl` | `password`     |
| `wp`      | `imap.wp.pl`          | `smtp.wp.pl`          | `password`     |
| `o2`      | `poczta.o2.pl`        | `poczta.o2.pl`        | `password`     |

- Gmail needs 2-Step Verification for an app password. Work or school accounts, Advanced Protection and security-key-only 2SV get none.
- Onet: the user must switch IMAP and SMTP on in the web mail settings.
- WP and o2: with two-step login, the user needs a separate program password.
- **Gap:** the official WP and o2 pages do not state the user-name format. `connectMailbox` always logs in with the full address. Nobody checked this on a real WP or o2 account. A wrong format gives 422 `mail_login_failed`.
- The presets live in `packages/core/src/mail/providers.ts`. The help sentences live in `apps/web/src/i18n/en.ts`, not in core.

## Timeout facts (fact 2, B5)

- `verifySmtpLogin` passed no timeout. Nodemailer 10.3.1 defaults: connection 2 min, greeting 30 s, socket 10 min. Every timeout has the code `ETIMEDOUT`.
- imapflow 1.7.8: `greetingTimeout` 16 s, `socketTimeout` 5 min. `imapFlowOptions` always sets `connectionTimeout` (default 30 s).
- B5 fix: `connectionTimeoutMs` also sets the imapflow greeting and socket timeouts. `SmtpConnectOptions.timeoutMs` sets the three nodemailer timeouts. `ConnectDeps.timeouts = { socketMs, deadlineMs }` adds `withDeadline` around each login.
- The web uses `{ socketMs: 20_000, deadlineMs: 25_000 }`. One request takes at most about 50 s. The server `idleTimeout` is 90 s and the Vite proxy is 95 s. The CLI passes nothing and keeps its old behaviour.

## GreenMail (fact 3)

- GreenMail runs with `-Dgreenmail.auth.disabled` (`deploy/compose.dev.yaml` and the CI `e2e` job). It accepts every password.
- So Playwright cannot test the 422 `mail_login_failed` path. Route tests use a fake provider for it.
- IMAPS to an IP fails closed (`notes/2026-11-03-imapflow-tls-under-bun.md`). The e2e connect uses plain `127.0.0.1:3143` (IMAP) and `127.0.0.1:3025` (SMTP) through "Other" with `WEB_MAIL_ALLOW_LOCAL=true`.
- The preset path in Playwright uses `page.route` on `POST /api/mailboxes`, because a preset points at a real provider.

## The delete graph (fact 4, B7)

- Cascade from `mailboxes`: `mailbox_credentials`, `mailbox_settings`, `emails`, mailbox-scoped `sender_rules`, `outbox` (`mailbox_id`), `delegations` (`mailbox_id`), `mailbox_folders`.
- Cascade from `emails`: `triage_results`, `triage_feedback`, `actions`, `audit_log` (`email_id`), `outbox` (`email_id`), `delegations` (`email_id`).
- Cascade from `actions`: `audit_log` (`action_id`), `delegations` (`draft_action_id`, `send_action_id`).
- `delegations.answered_email_id` is `ON DELETE SET NULL`. `delegations.delegate_id` has no cascade; `delegates` stay.
- `audit_log` rows that hold only `data.mailbox_id` (pause, resume, password, mode, policy, switch, sync folders) need the explicit delete in `delete_mailbox`.
- The function `delete_mailbox(p_org_id, p_mailbox_id)` is `SECURITY DEFINER`, owned by `migrator`. It sets `search_path = pg_catalog, public, pg_temp` and names every table with `public.` (cold review finding 3: `app` may create temporary tables). Only `app` has `EXECUTE`.
- Digest rows: `pending` and `sending` digests of the organization are deleted. The next digest covers the period, because the `digests` row stays unsent. `sent` and `failed` digests get `text = '[removed]'`.
- The notice `mailbox_removed` has no `mailbox_id` and no `email_id`. A cascade would delete it.
- Migration file: `20261111000001_delete_mailbox.sql`. If `master` gets a later migration before the merge, rename this file at the merge (the S5a rule).

## `saveTriage` after a removal (fact 11)

- `saveTriage` compares the settings version first. The settings row is gone, so it calls `releaseEmail` (0 rows) and returns `{ kind: "lost" }`. It writes nothing and throws nothing.
- So the D11 words "one job tick fails" mean "the save of the claimed mail writes nothing".
- The sync job's `insertEmail` into a removed mailbox fails with a foreign-key error. The per-mailbox `catch` logs it once as `sync <id> failed: …`. This is expected (`docs/known-alerts.md`).
- `removeMailbox` pauses the mailbox first, so the next tick skips it. It undoes the pause when the delete fails with anything but `P0002`. It retries a deadlock (`40P01`) once.

## Playwright facts (stage 14)

- `webServer` is an array of two entries. Playwright starts the fake Telegram first (`bun tools/fake-telegram/src/cli.ts serve --port 8092`, health URL `/_fake/health`), then the app server.
- Port 8092, not 8090: a developer's own fake on 8090 stays untouched.
- Result: `bun run test:e2e` gave 20 passed in about 37 s. Run twice, same result.
- CI result: see the merge log.
- Each spec calls `cleanUpOrg` in `afterEach` (Telegram unlinked, mailboxes removed). The `onboarding.mode_kept` row stays, because nobody can delete an audit row. So `onboarding.spec.ts` reads `GET /api/me` first and skips the click when the mode item is already done (finding 2).
- Each project uses its own mailbox address: `e2e-<project>@e2e.test`.

## Deviations from the plan (with the stage)

| Stage | Deviation                                                                                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4     | The ACL assertion in `delete-mailbox.test.ts` checked nothing. A fix commit (`30f24f0`) made it real.                                                                                                                 |
| 5     | The P0002 test did not always reach `P0002`, and a restore error could hide the delete error. Fix commit `01814f5`.                                                                                                   |
| 5, 6  | Fix commit `9fd3ca2`: typed Telegram answers, `describeError` in the routes, a tenant test for unlink.                                                                                                                |
| 8     | A trailing dot hid a local host (`localhost.`). Fix commit `d054e7f`; stage 9's fix strips all trailing dots (`661d6a1`).                                                                                             |
| 9     | `homePathOf` got an optional `botUsername` argument, so `/` and `/api/me` use one `telegramAvailable` (B13). The reviewer asked about it; it stays. Fix `661d6a1` adds the missing tenant test for `recordAuditOnce`. |
| 10    | `TelegramLink` state `off` never reset. Moved to stage 12 and done there.                                                                                                                                             |
| 12    | The address field reset the app-password switch while no preset matched. Fix commit `74fda9f`. `fieldErrorKeys` accepts a string path (kept).                                                                         |
| 13    | `ChecklistItem` `done` is `boolean \| null` (`null` when Telegram is off): intended. `RemoveDialog` repeats the `ApiError` check: fixed in stage 13. `Alert` keeps `role=alert`: accepted.                            |
| 14    | None recorded in the Log. The two `webServer` entries start in the planned order (fake first).                                                                                                                        |

Every stage had one review. Stage 9 failed its first review (a major finding), then passed after the fix. The Opus review hit a weekly-quota error once at stage 8; a retry worked.

## Follow-ups

- A DNS-level host check (a name that resolves to a local address): `spec/features/planned/F056-web-public-hardening/plan.md`.
- `WEB_MAIL_ALLOW_LOCAL` must stay empty or `false` on the VPS (S5e).
