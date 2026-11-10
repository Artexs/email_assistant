> **Status 2026-11-08 — planned.** Left: the detailed stage plan (an own `plan-task` session), then the build with `run-task`.

# S5b Web: mailboxes and onboarding

Scope: the S5 master plan `tasks/active/s5-web-panel.md` (P5, P6, P9, P10, D10 (c) (f) (h), D11 second part, D14, D15, the API contract rows marked S5b, "Rules for every step"). Needs: S5a built and merged.
Git mode: worktree (`task/s5b-web-mailboxes-onboarding`). Run mode: pipeline.

## Goal

The owner connects, pauses, resumes, re-authorises and removes a mailbox from the web, links and unlinks Telegram, and sees on the onboarding checklist what is still missing. The panel shows honestly which mailboxes the triage, the actions and the sends cover (the env scopes).

## Done when

- The done-when of S5 "set up a mailbox and link Telegram without the CLI" holds on the dev machine with GreenMail and the fake Telegram (Playwright in both projects): connect through the form with a preset, pause and resume, change the password, remove with the typed address, show the `t.me` link, unlink.
- `removeMailbox` deletes every row of the mailbox (the test lists each table) and keeps the rows of a second mailbox and of another organization; the owners get the `mailbox_removed` notice; a concurrent claim makes one job tick fail and the next tick is clean (D11).
- Pause and resume from the web and from Telegram `/pause` `/resume` use one function with one audit row shape (D10 (c)); the S2 and S3 Telegram tests stay green.
- `/api/me.onboarding` follows D15; `/` redirects to `/onboarding` while open and to `/activity` when done; "Keep shadow mode for now" calls `POST /api/onboarding/keep-mode` (owner, 204, idempotent) and the checklist marks the mode item done (route test and Playwright).
- `removeMailbox` deletes the `pending` digest rows of the organization and clears the text of the `sent` ones; no row with the text "[removed]" is ever sent (D11; test).
- Scope badges match `TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE` and `SEND_SCOPE` for the test mailbox and for a second mailbox (unit test of the pure helper).

## Owns (from the master plan)

- Decisions D10 (c) `switchMailboxStatus`, D10 (f) `botUsername` and `channels/routes.ts`, D10 (h) and D11 second part (`delete_mailbox` function, `removeMailbox`, the `mailbox_removed` outbox kind), D14 (connect, presets, errors, scope badges), D15 (onboarding state).
- Contract rows: `GET /api/mailboxes`, `POST /api/mailboxes`, `POST /api/mailboxes/:id/pause`, `…/resume`, `…/password`, `DELETE /api/mailboxes/:id`, `GET /api/channels/telegram`, `POST /api/channels/telegram/link`, `DELETE /api/channels/telegram/link`, `POST /api/onboarding/keep-mode`; the `onboarding` and `telegram` fields of `GET /api/me`.
- New files (expected): `db/migrations/<version>_web_mailboxes.sql` (the function, the outbox kind; the unique address index exists already), `packages/core/src/mail/providers.ts`, `packages/core/src/web/mailboxes.ts`, `apps/server/src/modules/mail/{status,remove,routes}.ts`, `apps/server/src/modules/channels/routes.ts`, `apps/web/src/islands/{Mailboxes,Onboarding}.tsx`, `apps/web/e2e/mailboxes.spec.ts`, `onboarding.spec.ts`.
- Changed files (expected): `channels/commands.ts` (`switchMailboxes` calls the new function), `channels/telegram/runtime.ts` (`botUsername`), `channels/{repo,notices,texts}.ts` (the new kind), `tenancy/routes.ts` (`/api/me` fill, `keep-mode`), `platform/http.ts` (the `/` rule), `apps/web/src/i18n/en.ts`, `.gitignore` if the e2e seed grows.

## Stage sketch

1. **Core presets and schemas**: `providers.ts` (Interia, Gmail app password, Onet, WP, o2; hosts, 993 and 465, `secretKind` hint, one help sentence each), `connectMailboxInput` and the mailbox response schemas; unit tests. The unique index `mailboxes_org_address_key ON (org_id, lower(address))` exists (`20261103100001_mail.sql`); the route maps its `23505` to 409 `mailbox_exists`.
2. **`switchMailboxStatus`** and the Telegram refactor; tests green.
3. **Migration and remove** `[risky]`: the `delete_mailbox` function (pending digest rows deleted, sent ones cleared), the `mailbox_removed` kind, `removeMailbox`, the notice text; the deletion tests of D11, the concurrency test, the foreign-organization refusal.
4. **Routes** `[risky]`: `mail/routes.ts` (connect and password with `connectionTimeoutMs` 20 s, D14), `channels/routes.ts`, `botUsername()`, the `/api/me` fill and the `keep-mode` route (D15), the `/` redirect rule; the route matrix for each route; the error mapping of D14 (422, 502, 409).
5. **Pages**: Mailboxes (list, connect form with presets and help, actions with the remove dialog of U5, scope badges, `auth_error` hint with the "change password" action), Onboarding (four items with live state, "Keep shadow mode for now", the Telegram link with a copy button and the open-in-Telegram link, unlink); strings; both widths.
6. **Playwright and notes**: connect GreenMail, pause, resume, password, remove, link with the fake Telegram; `notes/<date>-web-mailboxes-facts.md`; group review.

## Page-level questions for the plan session

The mailbox card content and order; the connect form layout (preset first, then address and password; when to show host and port fields); the texts of the scope badges; the remove dialog text; what the checklist says for each item and its done state; the Telegram link step on a phone (open the link directly) against a desktop (show the URL or a QR code: default no QR, a copy button).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded (the S5 docs pass is S5e; this segment writes its notes).
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-08: Created by the S5 master plan session (`tasks/active/s5-web-panel.md`, P11).
- 2026-11-08: Cold review fixes (master plan "Cold review result", findings 3, 6, 7, 21): `keep-mode` route, pending digests dropped on removal, provider timeout, the unique index fact.
- 2026-11-10: S5a built: the islands are `islands/<Page>Page.tsx` with `AppShell` inside (stage 10.2), the seed is `scripts/e2e-seed.ts` with `SeedFile` (stage 12), `requireOwner` and `parseBody` are exported from `platform/http.ts`, `WebDeps.routers` mounts a module router from `web.ts`, every web import of core goes through `@ea/core/web`.
