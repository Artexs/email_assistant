# F119 stage 15 — VPS deploy and checks

Part of [`../plan.md`](../plan.md). `[risky]` (real system, the pilot's sign-in). **The coordinator runs this stage** (`spec/build.md`: VPS and deploy steps are pre-approved; backup first, name the rollback target, verify after). No worker job. Needs stages 01–14 landed and the last `master` CI run green. No other VPS deploy at the same time.

## Before the deploy

1. `git log --oneline <VPS commit>..origin/master`: do the VPS step of any other ticket in the list first, by its own runbook.
2. The deploy brings one migration (`…_sso.sql`): one new table, two columns with defaults, one trigger. The old code works with them (the trigger only caps rows marked `sso`, and the old code makes none).
3. Effect on users: none while the flag `sso_sign_in` is off and no provider exists. The login page shows no new element (`GET /api/sign-in-options` → `false`).

## Runbook

Follow `stages/stage-15-vps.md` of F105 (`spec/features/done/<month>/F105-…/`) steps 1–11 with these changes: the image tag is `ea-server:pre-f119`; step 9 expects the `Applying` line of `…_sso.sql`; no `.env` change (this ticket adds no key).

## Checks

1. `/health` → `200`.
2. `$C logs --since "$T" server | grep -E "dropped_fields|better_auth_error|schema_mismatch"` → no line.
3. `curl … http://127.0.0.1:8080/api/sign-in-options` → `{"sso":false}`.
4. For each path `/api/auth/sso/register`, `/api/auth/sso/providers`, `/api/auth/sso/verify-domain`, `/api/auth/sso/saml2/sp/metadata` (POST with the panel origin, and GET): `404`.
5. `$C run --rm server bun run org:sso --org-id <pilot org id>` → `no provider`.
6. The pilot owner signs in with password and TOTP (ask the owner, or read the newest `web.login` row with `second_factor = totp` after `$T`): sign-in still works; `/operator` opens for the owner (a password session).
7. `$C exec db psql … -Atc "SELECT sign_in_method, count(*) FROM auth_sessions GROUP BY 1"` → only `password`.
8. Wait 11 minutes: `sync_done` lines for the pilot mailbox.
9. `$C exec server printenv WEB_TRUSTED_ORIGINS` → empty, or only `https:` panel origins: no `127.0.0.1`, `localhost` or IdP origin (D18: Better Auth `trustedOrigins` must list no loopback; cold review 2). On a fail: empty the key as `deploy/README.md` says and restart; no rollback.

## Rollback

When step 11 or check 1, 2, 4, 6 or 8 fails: `git checkout <rollback commit>`, `docker tag ea-server:pre-f119 ea-server`, `$C up -d --no-build --wait`. Never `db:rollback`: the old code ignores the new table and columns. Report the failing check to the owner.

## After

- 24 h without a failing check: `docker image rm ea-server:pre-f119`.
- `plan.md` § Log: date, commit, check outputs (no ids, no addresses).

## Done when

Checks 1–9 hold and the log line is written. Stage 16 waits for owner step U1.
