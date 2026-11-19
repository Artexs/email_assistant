# F118 scouts

Four Sonnet scouts (--thinking medium) at base db85425a, 2026-11-18. Each packet is copied whole from the job log. A packet is a lead, not a fact.

## Scout 1 · `2026-11-18-f118-scout-1-01fb764b`

**Question:**

> How does a notice travel from queueNotice to a sent message, and what must change to add a 'push' channel and a 'minimal' Telegram detail level? Cover: noticeKinds/noticeChannels/noticeDetails and the renderer registry (packages/core/src/notices), outbox columns and their CHECK constraints (channel, detail), how a row picks its channel and detail at queue time vs send time, reportRoutesOf/mailDedupKey (per-member routing, report channel in PATCH /api/me/notify, memberships columns), the sender claim by channel, the quiet gate (createQuietGate), the 24h expiry, per-user limit, and the registry tests that must stay true. Also: which kinds carry an item id that a phone tap could open, and which web routes exist for them (/approvals/<id>, mail detail, loops, trust report). Context: spec/features/planned/F118-e9b-phone-channel-pwa-push-telegram-detail/ticket.md. Answer for the code at HEAD.


**Packet:**

Packet: How a notice goes from queueNotice to a sent message, and what must change for a `push` channel and a `minimal` Telegram detail.
Base: db85425a
Verified: `git status --short` -> (empty output; worktree clean). No test or runtime command ran. All findings come from reading code.
Unknowns:
- Web routes: no `/approvals/<id>`, mail-detail or per-loop page exists. Observed: `apps/web/src/pages` holds only flat pages (`approvals`, `report`, `review`, `activity`, `delegations`, `settings`, …) plus `legal/[lang]/[doc].astro`. Whether the island pages read a query or hash for an item id was not checked.
- No code at HEAD chooses `detail`. Observed: `insertOutbox` (repo.ts:258-) never sets it, so the DB default `'full'` applies. F118 must add the rule for `minimal` and where to put it. No existing setting is a candidate.
- I did not read the `quiet_start` / `report_channel` write paths in `tenancy/repo/memberships.ts` (`setMemberReportChannel`). I did not read the digest-job or weekly-report fan-out beyond the `reportRoutesOf` and `mailDedupKey` call sites.

Findings:
1. `packages/core/src/notices/kinds.ts` — the lists to widen. `noticeChannels = ["telegram","mail"]` (add `"push"`). `noticeDetails = ["full"]` (add `"minimal"`; a comment already marks "E9b adds"). `reportMailKinds` holds the four kinds that go by mail. 23 `noticeKinds` follow the CHECK list of `outbox.kind`. — observed
2. `packages/core/src/notices/renderers.ts:36-52` and `render.ts:17-18` — `NoticeRenderer<S>` has `telegram: {full}` and optional `mail?: {full}`. `renderNotice` calls `renderer[opts.channel]?.[opts.detail]`; a missing function gives `{ok:false}`. A `push` channel needs a new optional key. `minimal` needs a `telegram.minimal` function (optional or required per kind). The `telegram` type is a fixed `{full}`, so it must widen. The `mailOf` helper wraps `full` only. `noticeEditRenderers` (render.ts:30) is `{telegram:{full}, mail?}`, and `renderNoticeEdit` throws for a missing channel or detail. — observed
3. `db/migrations/20261113100001_outbox_view.sql:6-8` — outbox columns `channel text NOT NULL DEFAULT 'telegram'` with `outbox_channel_check`, and `detail text NOT NULL DEFAULT 'full'` with `outbox_detail_check CHECK (detail IN ('full'))`. `20261115180001_trust_ladder.sql:125-126` widened the channel CHECK to `('telegram','mail')` with DROP then ADD CONSTRAINT, and its down-migration deletes the rows first. F118 needs a new migration that does the same for `channel` (`push`) and `detail` (`minimal`). `report_channel` on `memberships` is `CHECK IN ('telegram','mail','both')` (same file, line 109), next to `report_mailbox_id`. A phone-push preference needs a new column or a widened CHECK. — observed
4. Queue time: `apps/server/src/modules/channels/notice-queue.ts:36-58` — `queueNotice` encodes the view, and test-renders it as `{channel:"telegram", detail:"full"}` for every channel (so a push-only or minimal-only view must also render as telegram/full). It then calls `insertOutbox`. `QueueNoticeInput.channel` is optional (default `telegram`) and passes through; `detail` is not an input and not inserted. Send time: `sender.ts:111-123` renders with `row.channel` and `row.detail` read at claim, only when `row.text === null`. A row with stored text is sent as is. Dedup: unique `(org_id,user_id,dedup_key)`, `onConflict doNothing`. — observed
5. Routing, claim, gate, expiry and limit:
   - `report-members.ts:44-50` — `reportRoutesOf(member, flagOn)` returns `{telegram:boolean, mailboxId}` and has no push term. `mailDedupKey = key + ":mail"` makes a second row per event with its own key. A push row needs its own suffix and routing field.
   - `repo.ts:356-372` — `claimDueOutbox` filters `channel = opts.channel ?? "telegram"`. A push sender must claim `channel:"push"` or its rows are never sent. `report-mail-sender.ts:85` does this with `"mail"`.
   - `repo.ts:441-448` — `expireOldMailOutbox` sweeps only `channel='mail'`. A push channel needs its own sweep, or Telegram-style expiry in its sender.
   - `sender.ts:26,89-93` — `OUTBOX_MAX_AGE_MS` is 24 h; an older row fails as `expired` before render.
   - `sender.ts:30,141-146` — per-user limit is 3 sent per run per user; others are released with `next = now`.
   - `sender.ts:134-139` — `createQuietGate`/`holdUntil` is skipped for `digest` and for `approval_edit`. `report-mail-sender.ts:151` skips it for `digest` only.
   - `quiet-gate.ts` — gate holds at least 60 s ahead. The push sender can reuse it as is. — observed
6. `PATCH /api/me/notify` — `channels/routes.ts:122`; schema `packages/core/src/web/notify.ts:9-10,35-60` has `reportChannelSchema = z.enum(["telegram","mail","both"])`. `notify-settings.ts:60-80` (`changeNotify`) writes `report_channel` and `report_mailbox_id`, needs flag `report_mail`, and 409s with `no_mailbox` for `mail`/`both` without an active mailbox. `NotifyView` has `telegramLinked` only. `listReportMembers` (report-members.ts:62-) selects members with a chat link or a `mail|both` channel with a mailbox. Both need a push-subscription term if push is a per-member route. — observed
   Item ids that a tap could open:
   - `urgent` `emailId`, `not_triaged` `emailId` + `mailboxId`, `reply_prompt` / `reply_result` `emailId`. No mail-detail web route exists.
   - `approval` `actionId`, `send_result` `actionId`, `approval_set` `setId`, `delegation_answered` `delegationId`. The API `GET /api/approvals/:id` exists (`approval-routes.ts:77`). The web page `/approvals` is flat.
   - `loop_consent` and the follow-up result of `action_failed` carry only `panelUrl` (`panelUrlSchema`), no loop id.
   - `trust_report_ready` `reportUrl` = `<WEB_BASE_URL>/report?mailbox=<id>` (`trustReportUrlSchema`, path fixed to `/report`). `autonomy_paused` has `settingsUrl` → `/settings`. `send_held` has `mailboxId`. `sync_stale`, `sync_ok`, `auth_error`, `digest` and `replies_ready` carry no id.
   - For a push tap, only `/report?mailbox=`, `/settings` and `/approvals` exist as web targets. — observed

Registry tests that must stay true (`packages/core/src/notices/registry.test.ts`):
- `:349` one entry per kind in `noticeRenderers` and `noticeViewSchemas`.
- `:355` one fixture case per kind.
- `:658` exactly the `reportMailKinds` have a `mail` renderer. A `push` renderer set needs its own list test. Adding push to an existing kind must not break this.
- `:663-696` a mail row renders Telegram's text with `buttons:[]` in en and pl; every non-report kind returns `{ok:false}` for mail; `renderNoticeEdit` throws for mail.
- `opts` in the tests is `{channel:"telegram", detail:"full"}` (`:48`).

Checks: `bun run test:unit:ci` (named in `CLAUDE.md`) covers the registry tests above; I did not run it. It misses the CHECK constraints and the sender claim and expiry paths, which need `bun run test:int:ci`. Existing tests I did not read: `apps/server/test/integration/web-notify.test.ts` (PATCH `/me/notify`) and `trust-schema.test.ts` (migration CHECKs).

## Scout 2 · `2026-11-18-f118-scout-2-1640a511`

**Question:**

> Web panel and sessions for a PWA with Web Push: how is apps/web built and served (Astro static, base path, Tailscale Serve, how apps/server serves the static files and with which headers/CSP), is there any manifest or service worker, which page is the start page (/activity?), how does the Account/Settings page add a card (pattern, i18n en/pl), and the sessions model: table, how sign-out, lockout, password change and session expiry end a session (functions and hooks where a 'remove push subscriptions of this session' step would go), and how org delete and data export walk per-user tables. Context: spec/features/planned/F118-e9b-phone-channel-pwa-push-telegram-detail/ticket.md. Answer for the code at HEAD.


**Packet:**

Packet: How apps/web is built and served, sessions model, and where a "remove push subscriptions of this session" step would go (F118)
Base: db85425a
Verified: `grep -rniE "manifest|serviceWorker|service-worker" apps` -> hits only in apps/docs and apps/server/src/modules/lab, none in apps/web; `grep -rn "pushManager|Notification|navigator.serviceWorker" apps/web/src` -> no code hit. I ran no live server.
Unknowns:
- The Tailscale Serve setup lives outside the code. I read only ADR 0017. I did not check whether the VPS runs it as the ADR says.
- I did not read the migration that defines `auth_sessions`. I saw its TS type only.
- "Lockout" has no session-ending code. `auth-lockout.ts` has no "session" match. It only blocks sign-in (see 4).
- The export step for a per-user table is not shown for `users`-scoped tables. I only saw the `via: "members"` branch of `whereOf`.

1. **Build and serve.** — observed
   - `apps/web/astro.config.mjs`: `output: "static"`, no `base` (served at `/`), React integration. Astro `security.csp` sets `default-src 'self'`, `connect-src 'self'`, `img-src 'self' data:`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. There is no `worker-src`, so a service worker falls under `default-src 'self'`.
   - The `integrations/csp-style-src` integration rewrites each page's meta CSP to `style-src 'self' 'unsafe-inline'`. It checks every built page.
   - `apps/server/src/platform/http.ts:354` `secureHeaders`: CSP `frameAncestors 'none'`, X-Frame-Options DENY, HSTS only on an https `WEB_BASE_URL`.
   - `http.ts:469` `serveStatic` from `WEB_DIST` (default `apps/web/dist`, `config.ts:227`). Files under `/_astro/` get `public, max-age=31536000, immutable`. All other files get `private, no-store`.
   - Every non-API page needs a session. `PUBLIC_PAGE_PATHS` (`http.ts:151`) lists only `/login`, `/setup`, `/forgot`, `/legal/...`, `/404.html`, `/_astro/`, `/favicon.`, `/robots.txt`.
   - A manifest or service worker would be redirected to `/login` unless the plan adds its path to `PUBLIC_PAGE_PATHS`. Without that, it is `no-store` and needs a session. Only `GET` and `HEAD` reach static files.
   - `apps/web/public` holds only `favicon.png`.
   - Tailscale: `docs/decisions/0017-web-access-tailscale-serve.md`. `tailscale serve --bg 8080` gives HTTPS at `https://<machine>.<tailnet>.ts.net`, with no Funnel. The server listens on `127.0.0.1:8080`. HTTPS is what service workers and Web Push need, and Serve provides it.

2. **Manifest, service worker, start page.**
   - There is no manifest, no service worker and no push code in `apps/web` (see Verified). — observed
   - `/` is not a page. The `/` guard (`http.ts:448`) redirects to `homeOf` (`http.ts:308`): `web.homePath(userId)` returns `/onboarding` or `/activity`, and falls back to `/onboarding` on error or when unset. — observed
   - `apps/web/src/pages/index.astro` is only a meta refresh to `/onboarding`. `pages/activity.astro` renders `ActivityPage`. The nav entry is in `components/shell/nav-items.ts:41`. — observed
   - The decision of when `homePath` returns `/activity` is outside this read. — guessed

3. **Settings card pattern.** — observed
   - `pages/settings.astro` renders `islands/SettingsPage.tsx` with `client:only="react"`.
   - `GeneralSection` (in that file) stacks the cards: `DigestTimesCard`, `NotifySection`, org cards, then `AccountCard`. A push card goes there as a new component in `components/settings/`.
   - `NotifyCards.tsx` is the closest model. It uses `Card/CardHeader/CardTitle`, `useResource` with `api(path, zodSchema)`, `useDraft`, `toast`, `canWrite(me)`, and feature flags from `me.features`.
   - Strings: `t("key")` from `i18n/index.ts`. `en.ts` defines `TextKey = keyof typeof en`. `pl.ts:5` is typed `Record<TextKey, string>`, so a missing Polish key fails typecheck. Plurals use `plPlurals`.
   - `AccountCard.tsx` shows own sessions (`GET /api/me/sessions`, `sessionsSchema`) with a mark on this device. No UI ends one session.

4. **Sessions model and where a push step would hook.** — observed
   - Table: `auth_sessions` (`schema.ts:110`): `id, token, user_id, expires_at, ip_address, user_agent, sign_in_method` (`password` or `sso`), `sso_started_at`. `user_id` cascades from `users` (`db/migrations/20261110000001_web_panel.sql`, a `REFERENCES users ... ON DELETE CASCADE` line).
   - Config (`platform/auth.ts:345-370`): `expiresIn` 30 days, `updateAge` 1 day. The trigger `auth_sessions_sso_cap` ends an SSO session 12 h after `sso_started_at` (`20261114170001_sso.sql:45`).
   - Sign-out: the web calls `authClient.signOut()` in `AppShell.tsx:28`. This goes to `/api/auth/sign-out`, allowed in `AUTH_ALLOWED_PATHS` (`auth.ts:102`). There is no `after` hook for it. The `after` hook (`auth.ts:~467-477`) reports only `/revoke-sessions` and `/revoke-other-sessions` through `REVOKE_EVENTS`, so a sign-out has no hook point today.
   - Password change: `/change-password` is Better Auth's own. The `databaseHooks.account.update.after` hook (`auth.ts:~523`) reports `password_changed`. `AccountCard.tsx` has a "Sign out my other devices" option (`acct_revoke_others`). That is Better Auth's `revokeOtherSessions` on the same endpoint.
   - Password reset: `revokeSessionsOnPasswordReset: true` (`auth.ts:313`). `onPasswordReset` (`auth.ts:321`) clears lockout, so a session end by reset has no hook of ours.
   - Lockout: `auth-lockout.ts` (10 failures in 15 min, lock 15 min). It ends no session.
   - Our own SQL deletes of `auth_sessions` are all in `platform/auth-sessions-end.ts`: `endSsoLinksAndSessions`, `endPasswordSessionsAndChallenges`, `endUserSessions`, `unlinkSsoAccount`. Also `platform/auth-two-factor-reset.ts:21`. Each takes a Kysely `trx` from the caller.
   - Expiry: Better Auth deletes nothing by itself here. An expired row stays until a read or a cleanup. Nothing of ours reaps it.
   - Design consequence: a hook cannot catch all ends. Sign-out, `revoke-*` and reset are inside Better Auth. Expiry and the SSO cap are in the DB.
   - The reliable option is to key push subscriptions to `auth_sessions.id` with `ON DELETE CASCADE`. Then every end above, including the cascade from `users`, removes them. Expiry still needs a reaper, or a check at send time that the session is live.
   - `session.create.before` (`auth.ts:~497`) is the only session `databaseHooks` entry today. A `session.delete.after` hook is possible in Better Auth, but I did not read the library. — guessed

5. **Org delete and export.** — observed
   - Delete: `modules/privacy/delete.ts:74` `deleteOrganization` runs in one transaction and calls the SQL function `delete_organization(org)` (`sql\`SELECT delete_organization(...)\``, in `delete.ts`).
   - The function is in `db/migrations/20261114160001_account_data.sql`. It deletes `audit_log` by org, then `auth_verifications` by user id, then `users` in `gone` (users whose only membership is this org). `DELETE FROM public.organizations` follows. The remaining tables go through `ON DELETE CASCADE` from `users` or `organizations`.
   - A new per-user table must cascade from `users(id)`, or the function needs an explicit delete.
   - Export: `modules/privacy/export-map.ts` `EXPORT_MAP` lists every table. The test `privacy-export-map` compares keys with `information_schema`, so a new table fails until it is classified there.
   - Per-user secret tables use `secret(reason)`, for example `auth_sessions: secret("secrets: session tokens")` at line 62. A push-subscription table holds endpoint URLs and keys, and would likely need `secret(...)`, or `byOrg`/`members` with excluded keys.
   - `export.ts` walks `exportedTables()` and orders by primary key (`primaryKey()`). Every exported table must have a primary key. `address-map.ts` and `data-categories.ts` also list tables, and the same classify-or-fail applies to the DSR address map.

Checks:
- `privacy-export-map.test.ts` covers table classification against `information_schema`. It misses behavior of a new table.
- `account-data-delete.test.ts` and `web-auth.test.ts` cover delete and sessions. I did not run them.
- `csp-style-src.test.ts` covers the CSP rewrite. It misses `worker-src` and `manifest-src`.
- Nothing I found tests cache headers for non-`_astro` static files, nor that a service worker file is reachable without a session.

## Scout 3 · `2026-11-18-f118-scout-3-6df9f61e`

**Question:**

> Telegram consent and detail today: TELEGRAM_CONSENT_VERSION, consentVersionsOf/consentCovers, OPEN_LOOPS_CONSENT_SINCE, the loop_consent kind, F115's reply-drafts consent rule (older consent gets only a count and a panel link), how the link flow (POST /api/channels/telegram/link, chat_links, the panel Telegram card) records consent; which renderers today print sender, subject, summary or draft text per kind; where buttons (Send/Reject) are built; organization settings storage and how an org-owner lock could be stored; the feature flag registry (names, defaults, remove-by) and TERMS_VERSION/papers. What would a per-user detail 'full'|'minimal' column touch? Context: spec/features/planned/F118-e9b-phone-channel-pwa-push-telegram-detail/ticket.md. Answer for the code at HEAD.


**Packet:**

Packet: Telegram consent, detail and settings storage at HEAD, and what a per-user `detail` column would touch
Base: db85425a
Verified: `grep -rnE "loopConsentOf|consentVersionsOf" apps/server/src` -> `apps/server/src/modules/channels/digest-job.ts:146: const loopConsent = (await loopConsentOf(trx, ctx, [userId])).has(userId);`
Unknowns:
- F115's rule "older consent gets only a count and a panel link" is not in code. It is plan D16 (`spec/features/active/F115-e6a-reply-drafts/plan.md:32`), and the stage 12 consent bump has not landed. `TELEGRAM_CONSENT_VERSION` is still `2026-11-15.2`.
- `replies/` has no `telegram.ts` (listing: api-docs, drafter, draft-one, facts, index, jobs, preview, profile, repo, retention, routes, spend, write). The `replies_ready`, `reply_prompt` and `reply_result` notices have no producer and no consent gate.
- I did not check the web panel Telegram card source (`apps/web`).

1. `packages/core/src/web/telegram.ts:23-30` — `TELEGRAM_CONSENT_VERSION="2026-11-15.2"` and `OPEN_LOOPS_CONSENT_SINCE="2026-11-15.2"`. `consentCovers(version, since)` is false for null or invalid input. Versions are `YYYY-MM-DD[.N]`. — observed
2. `apps/server/src/modules/channels/consent.ts:15-66` — `consentVersionsOf` reads the newest `web.telegram_consent` audit row per user in the org. It ignores rows at or before the user's last `chat.unlinked` row. `loopConsentOf` is the only caller of `consentCovers`; `consent-gate.test.ts:20-30` enforces this. Consent is stored in `audit_log`, not on a column. Callers: `digest-job.ts:146`, `notices/loop-consent.ts:15`, `reports/digest.ts:69` (comment only). — observed
3. Link flow, `channels/routes.ts:55-103`:
   - `POST /channels/telegram/link` needs `body.consentVersion === TELEGRAM_CONSENT_VERSION`, else 409 `telegram_consent_outdated`.
   - One transaction writes the audit row (`web.telegram_consent`, actor=user, data `{via:"web",version}`) and `createLinkToken`.
   - `POST /telegram/consent` writes the same row for an already linked user.
   - `GET` returns `TelegramState.consentVersion`, null if not linked (`routes.ts:40-50`).
   - `chat_links` (`schema.ts:155`) holds only `channel`, `external_chat_id`, `id`, `linked_at`, `org_id` and `user_id`. It has no consent or detail column. — observed
4. `loop_consent` notice: fixed line plus panel link, no text (`digest/notices.ts:184`, `notices/loop-consent.ts`, dedup `loop_consent:<about>:<UTC day>`). The `privacy/outbox.ts:34` map entry is `no_mail`. — observed
5. Renderers per kind (`packages/core/src/notices/renderers.ts`, all `telegram.full` only; `mail.full` for 4 kinds):
   - Show sender and subject: `urgent` (`notices.ts:35-61`) and the `send_result` header lines (`notices.ts:328`).
   - Show sender, subject and draft body: `approval` (`approvals.ts:90-173`; `approval_set` lists subject and name per item at `:206-221`).
   - Show sender only: `not_triaged` (`notices.ts:140`).
   - Show sender, subject, AI text and counterpart (the brief `📌`): `digest` (`digest.ts`, `loops/brief.ts:200-223`), and only for users `loopConsentOf` covers.
   - Fixed text, no mail data: `loop_consent`, `replies_ready` (count and clock), `reply_prompt`, `reply_result`, `auth_error`, `sync_*`, `sent_missing`, `send_held` (address only), `autonomy_paused` and `trust_report_ready`.
   - Not read in full by me: `weekly_report`, `approval_edit`, `delegation_answered` and `mailbox_removed`. — guessed
6. Buttons: `digest/approvals.ts:181-182` (Send/Reject, `encodeCallback({kind:"approve"|"reject",actionId})`); `:237-238` (`approve_set` and `reject_set`); `:341-371` (`send_again` and `went_out`); `:417-421` (`delegation_done`); digest `✅ ✏️ ↩️` in `digest/digest.ts`. Telegram keyboard wire format: `telegram/api.ts:25`. The Send/Reject buttons are in `approval.ts` and `approval-set.ts` notices (`approval_set` at `approvals.ts:206`); the cut that drops draft text would keep them. — observed
7. Org storage:
   - There is no generic org settings table. `organizations` (`schema.ts:484`) has typed columns: `plan`, `sso_required`, `style_text`, `timezone`, `data_retention_days`, `max_mailboxes` and others.
   - `org_features(org_id, flag, enabled, set_at, set_by)` (`schema.ts:498`) holds flags. `isFeatureOn` resolves FEATURES_OFF, then the org row, then the registry default (`tenancy/features.ts`).
   - Per-member prefs sit on `memberships` (`schema.ts:423`: `quiet_start`, `quiet_end`, `report_channel`, `report_mailbox_id`, `digest_times`). They are read and written through `getMemberNotify`, `setMemberQuietHours` and `setMemberReportChannel`, and exposed at `GET`/`PATCH /me/notify` (`notify-settings.ts`, `routes.ts`).
   - An org-owner lock could be a new `organizations` column, or a flag row. Nothing exists today. — observed
8. Flags (`packages/core/src/features.ts`): 33 `removeBy` entries, 23 with `2027-03-01` and 8 with `2027-06-01`. The counts are from `grep -c` and `uniq -c`, so they do not sum to the 33. All defaults I saw are `false`. Relevant: `open_loops` (line 118), `reply_drafts` (186), `user_quiet_hours`, `report_mail`. No push or detail flag exists. Fields: `default`, `description`, `epic`, `removeBy`. — observed
9. `TERMS_VERSION` is the last entry of `TERMS_HISTORY` (`core/src/web/terms.ts:15-25`): `2026-11-17`, sha256 `19879c6e…`. Any legal text change needs a new entry, including `tg_consent_text`, `legal_*` keys, the six pages and the two registries. `apps/web/src/lib/legal-version.test.ts` fails until the digest matches. Use: `tenancy/routes.ts:104,163`, `platform/auth.ts:216`, `users.terms_version`. Telegram consent uses its own version, separate from `TERMS_VERSION`. — observed
10. A per-user `detail` seam exists already:
    - `noticeDetails = ["full"] // E9b adds "minimal"` (`notices/kinds.ts:42`).
    - `outbox.detail text NOT NULL DEFAULT 'full' CHECK (detail IN ('full'))` (`db/migrations/20261113100001_outbox_view.sql:8`; `schema.ts:512`).
    - Readers parse it through `z.enum(noticeDetails)` (`channels/repo.ts:327,427`) and pass it to `renderNotice` (`sender.ts:118`, `approval-taps.ts:123`, `report-mail-sender.ts:159`).
    - `queueNotice` hardcodes `detail:"full"` at `notice-queue.ts:43`.
    - The renderers (`renderers.ts`) and `noticeEditRenderers` (`render.ts:31-33`) are keyed `{ full }` only.
    - A user `full|minimal` column (best fit: `memberships`, beside `report_channel`) would touch: the `memberships` migration and `schema.ts`; `noticeDetails` and `NoticeRenderOptions`; the outbox CHECK constraint; `queueNotice` (read the user's value, store it in the `detail` column); a `minimal` renderer for each Telegram kind and for `approvalEdit`; `NotifyView` and `notifyPatchSchema` with `GET`/`PATCH /me/notify`; the panel; privacy export and erase maps (`privacy/export-map.ts`, `address-map.ts`) and docs. The outbox rows queued before a change keep their stored `detail`. — guessed

Checks:
- `channels-consent.test.ts` covers `consentVersionsOf`, the consent route, unlink withdrawal and cross-org isolation. It does not cover `detail`.
- `consent-gate.test.ts` covers the single-choke-point source scan. It does not cover reply-draft consent, which has no code.
- `notices/registry.test.ts` covers every kind rendering through `renderNotice`. It does not cover `minimal`.
- I ran none of these tests.

## Scout 4 · `2026-11-18-f118-scout-4-e5dd04e5`

**Question:**

> Secrets, config and logging for Web Push: how env config is read and validated (where a VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT would go, .env.example, the config doc), the encryption helper of ADR 0009 (encrypt/decrypt with AAD; usable for a push endpoint and keys), the E8 log allow-list and canary test (what fields are blocked, how to add 'endpoint'), the outgoing host guard (F084) and whether an outbound HTTPS POST to fcm.googleapis.com etc. would be blocked, which HTTP client the server uses for outbound calls (Telegram fake API, fetch injection for tests), whether any web-push or VAPID/ECE library is in bun.lock, the Bun version in .bun-version, and the latest migration file name and the migration numbering rule. Context: spec/features/planned/F118-e9b-phone-channel-pwa-push-telegram-detail/ticket.md. Answer for the code at HEAD.


**Packet:**

Packet: Secrets, config, logging and outbound-call facts for Web Push (F118), at HEAD
Base: db85425a
Verified: `grep -n -i "web-push\|webpush\|vapid\|http_ece\|aes128gcm" bun.lock package.json apps/*/package.json packages/*/package.json` -> no output (no library); `git status --short | wc -l` -> 0
Unknowns:
- I did not read `scripts/limen-prepare.sh` or the `docs/capabilities/` pages for the config table. I found no single config doc that lists the env keys. `.env.example` is the list, and the docs name keys in prose. Guessed.
- I did not run the host guard against fcm.googleapis.com. The answer below comes from reading the code.
- The F084 ticket folder is not in `spec/features`. A grep for "F084" finds only the Stage 2 epic notes. It names F084 as an "F082 follow-up". Observed. I take "outgoing host guard" to mean `public-http.ts` (see item 4).
- I did not read `docs/capabilities/` for a log-canary page. The canary test names one ("see the capability page").

1. Env config — `apps/server/src/platform/config.ts:99` — Observed.
   - `baseSchema` is one zod object. Each optional key uses `z.preprocess(emptyAsUndefined, …optional())`, so an empty value counts as unset.
   - `loadConfig` is at `:641` and `ConfigError` at `:634`. Cross-key rules go in `superRefine` (`:305`). Example at `:363`: `OPERATOR_TELEGRAM_CHAT_ID` needs `TELEGRAM_BOT_TOKEN`.
   - Accessor helpers sit below `:514`, for example `operatorChatId`.
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` would be new keys in `baseSchema`. Add a refine that requires all three or none.
   - `.env.example` has `CREDENTIALS_KEY=###` at line 171 and `WEB_BASE_URL=` at 89. Each key has a comment line above it.
   - **Registry test:** `platform/outside-services.ts` has `OUTSIDE_SERVICE_KEYS`. `outside-services.test.ts` fails on any config key that matches `_URL|_HOST|_API_KEY|_TOKEN|_ENDPOINT|_API_ROOT|^MAIL_OAUTH_` and is not listed.
   - `VAPID_PRIVATE_KEY` and `VAPID_PUBLIC_KEY` match none of those suffixes, so they need no entry. A push endpoint key would match `_ENDPOINT`.
   - A push-service row is still due. `@ea/core` `legal/subprocessors.ts` has ids openai, gemini, telegram, backblaze, tailscale, healthchecks, hibp, microsoft-oauth, google-oauth and auth-smtp. It has no push row. ADR 0032 says the papers must list the push services.

2. ADR 0009 helper — `platform/crypto.ts:25` `createSecretBox(keyBase64, keyVersion)` — Observed.
   - It returns `encrypt(plain, aad)` and `decrypt({ciphertext, keyVersion}, aad)`.
   - The algorithm is AES-256-GCM. The ciphertext is base64 of iv (12 bytes) ‖ tag (16 bytes) ‖ data. The AAD is bound with `setAAD`. A wrong key, AAD, data or key version throws `CryptoError`.
   - The key is `CREDENTIALS_KEY`. `crypto.test.ts` covers it.
   - Existing AAD shape: `mailbox:<id>`. A push subscription would use a new AAD, for example `push:<id>`.
   - A JSON string of endpoint and keys fits `plain`.
   - `dsrAddressHash` in the same file uses HKDF with an info string. This is the pattern for a derived key.

3. Log allow-list — `platform/log-fields.ts` — Observed.
   - A field must be in `uuidFieldNames`, `numberFieldNames` or `codeFieldNames`. `log.ts:98` drops any other field.
   - `isLogValue` (`:~190`) accepts only `^[A-Za-z0-9_.:/*-]{0,64}$` and refuses any string that contains `://`.
   - `endpoint` is already in `codeFieldNames`, but it means an LLM endpoint kind or hostname. A real push URL has `://`, so it is dropped. Never log the endpoint URL.
   - ADR 0032 and the E9 notes: "never log … push endpoints (the endpoint URL is a capability)".
   - To log something new, add a name such as `push_kind` to the right list, and log only a kind, count or id.
   - `test/log-capture.ts` builds `FIELD_KEYS` from `logFieldNames`. `logProblems` flags any field outside that list.
   - `test/integration/log-canary.test.ts` plants `CANARY…` values in mail, errors and a bot token. It asserts that none appears in any log line. The push test should add a planted `CANARY` endpoint and key.

4. Host guard — `platform/public-http.ts` — Observed.
   - The guard is not a general egress block. `postOneClick` is a single-purpose POST for RFC 8058 unsubscribe to a mail-named `https:443` host.
   - It rejects IP literals, resolves once and refuses non-global addresses. It does not follow redirects.
   - A source scan in `public-http.test.ts` checks that production code never passes `dial`.
   - Nothing else blocks a plain `fetch` or `https.request`. A POST to fcm.googleapis.com, `updates.push.services.mozilla.com` or `*.push.apple.com` would not be blocked.
   - The E9 notes say the host guard does not apply to provider hosts that are fixed constants. A push endpoint comes from the browser, so it is user-supplied. An SSRF check is needed: `https` only, public host, no redirects.
   - `public-http.ts` and `net-address.ts` (`isLocalAddress`, `LookupAll`) can be reused.
   - `OUTSIDE_CALL_CLASSES` in `outside-services.ts` requires an entry, with a reason, for outside calls whose host no config key names. A push call would need an entry or a subprocessor row.

5. HTTP client — Observed.
   - Telegram uses grammy `Api`. `channels/telegram/api.ts:9` takes `opts.apiRoot`, from env `TELEGRAM_API_ROOT`. The schema allows only a loopback host. `runtime.ts:67` passes `apiRoot`. The lab fake API is `lab/fake-tg.ts`.
   - Other outbound calls use global `fetch` with an injected `fetch?: typeof fetch` dependency (`platform/heartbeat.ts:11,17`; `platform/pwned.ts:11`). Tests pass a fake `fetch`.
   - OpenAI and Gemini use their SDKs (`openai`, `@google/genai`).
   - Web Push should follow the `deps.fetch` pattern with a fake in tests.

6. Push library — none — Observed.
   - The `apps/server/package.json` dependencies are `@better-auth/sso`, `@ea/core`, `@google/genai`, `@hono/bun`, `age-encryption`, `better-auth`, `croner`, `grammy`, `hono`, `html-to-text`, `imapflow`, `kysely`, `mailparser`, `nodemailer`, `openai`, `pg` and `zod`.
   - `bun.lock` has no `web-push`, VAPID or ECE (aes128gcm) package. Node `crypto` is available for ECDH, HKDF and AES-GCM if F118 writes its own RFC 8291 code. Guessed.

7. Bun — `.bun-version` is `1.4.4` — Observed.
   - CLAUDE.md says the CI scripts `test:unit:ci` and `test:int:ci` run this Bun, not the local one.

8. Migrations — `db/migrations/20261117140001_unsubscribe_data.sql` is the latest of 40 files — Observed.
   - Name: `YYYYMMDDHHMMSS_<name>.sql` (dbmate). It needs `-- migrate:up` and `-- migrate:down` (`docs/code-patterns.md:217`).
   - Only one job at a time adds a migration or changes `bun.lock` (`CLAUDE.md:21`).
   - After a migration, run `bun run db:types` (`code-patterns.md:182`).
   - A new table with `org_id` needs a `tenant_rows` policy, an entry in `TENANT_TABLES`, a tenant-filter test per repo function, and registration in the `privacy` maps (`code-patterns.md:200-201`).
   - A contract statement (a DROP, RENAME and so on) needs a `-- contract: v<x.y.z>` line (`code-patterns.md:225`).
   - Use a new timestamp later than `20261117140001`.

Checks: `outside-services.test.ts` covers the config-key and subprocessor registry; it misses VAPID keys, because their names match no pattern. `log-canary.test.ts` and `log-capture.ts` cover allow-list leaks; they miss any push path until F118 adds a canary. `public-http.test.ts` covers the unsubscribe guard only. `crypto.test.ts` covers the secret box. I ran none of them.

