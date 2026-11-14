# F105 · Plan refresh 2 (2026-11-14)

- Old base: `ff61cbc` (the `Plan base:` line of `plan.md` after refresh 1).
- New base: `cf125cf` (HEAD of this job).
- Review: none. No stage changed in substance: no new or changed interface, no schema or SQL change, no new step, and the same stage order. The one fix is the file name (version) of the stage 01 migration.

## Drift output (`scripts/plan-drift.sh <folder> ff61cbc`, exit 1)

```
plan base: ff61cbc 2026-11-14 12:38
HEAD:      cf125cf 2026-11-14 12:54
named paths: 83; changed since base: 3; gone: 0
changed: apps/server/src/platform/db/schema.ts
changed: apps/server/test/integration/rls-policy.test.ts
changed: apps/server/test/integration/web-operator.test.ts
commits after the base that touch the named paths:
  0e49355 11-14 12:37 F100 s04 step 2: answered_check feedback source, schema and RLS tests
  78e8c2e 11-14 12:36 F097 stage 04: /review command behind the review_command flag
  524a02d 11-14 12:36 F100 s04 step 1: measure capture migration (email_headers, email_flags, action_feedback, answered_check source)
```

The script reads only code paths. This refresh also checked by hand: `db/migrations/` (1 new file), `docs/` (`git diff --stat ff61cbc HEAD -- docs`: only capability pages that no stage names, plus `owner-decisions.md`), `package.json` (new script `mailbox:signals` only), and `org-flag-cli.test.ts` (stage 07 names it as a pattern).

## Changes (stage · what · why)

- stage 01 step 01.1 Files · the migration name is now `<version>_two_factor.sql`, with the rule: the version must be greater than every version in `db/migrations/` and no other file may have it. At cf125cf the newest file is `20261114120001_measure_capture.sql`, so a build on 2026-11-14 uses `20261114130001`. The worker runs `ls db/migrations | tail -3` first · the old pattern `<YYYYMMDD>120001` gives `20261114120001` on the build day 2026-11-14. That version is taken by F100 stage 04 (524a02d), and dbmate records the version only.
- stage 01 step 01.1 Interfaces note · do not change `TENANT_TABLES`. At cf125cf it lists the F100 tables `action_feedback`, `email_flags`, `email_headers`, and `auth_two_factors` (no `org_id`) does not belong in it · F100 stage 04 (0e49355) added the three tables to the list. A worker could think the new table also goes in.
- plan.md status line · `Plan base: cf125cf, refreshed 2026-11-14` · refresh rule.
- plan.md Planning progress, Log · refresh 2 lines.
- plan.md How to run 1 · drift base `cf125cf` · refresh rule.

## Facts checked that needed no change

- `schema.ts` (524a02d, 0e49355): the diff adds only `ActionFeedback`, `EmailFlags`, `EmailHeaders` and their `DB` keys. `Users` and `Memberships` are unchanged (`Memberships`: `created_at`, `digest_times`, `org_id`, `role`, `user_id`). The `Generated` header is unchanged, so the stage 01 note on it still holds. The rule "every other hunk must be one of the three new parts" still holds: the F100 parts are in the file already.
- `20261114120001_measure_capture.sql`: it does not touch `users`, `memberships` or `auth_*`. Its new FKs to `users` are `ON DELETE SET NULL` (`email_flags.answered_check_by`, `action_feedback.user_id`); stage 01 test 5 (user delete cascades `auth_two_factors`) is not affected.
- `rls-policy.test.ts`: test 1 is still "every table with org_id is in TENANT_TABLES, and the list has no other table"; `memberships` is still in `TENANT_TABLES`; `seedOrg` now also fills the F100 tables. Plan F12 and F13 and the stage 01 Check (it runs this test) need no change.
- `web-operator.test.ts` (78e8c2e): only test 4 and test 6 changed (four flags → five, `review_command`). `operatorApp` (line 42, `operatorUserIds` with a default) and the `as(...)` helper are unchanged. Stage 04 test 3 (add `twoFactorOff` to `operatorApp`; `GET /api/operator/flags` and `GET /api/operator/orgs` → 403 / 404) needs no change. No stage counts the flags.
- `org-flag-cli.test.ts`: one new `review_command` line; the `Bun.spawn` and `afterEach` pattern that stage 07 test 9 uses is unchanged.
- The callers of `tenancyRoutes(` and `apiRouters(` at cf125cf are the same 15 test files that stage 08 lists, plus `routes.ts` and `web.ts`.
- No change since ff61cbc in `platform/http.ts`, `platform/auth.ts`, `web.ts`, `apps/web/`, `docs/code-patterns.md`, `docs/decisions/`, `docs/architecture.md`, `docs/capabilities/web-panel.md`. So every "at ff61cbc" fact in the stages (line numbers, the `requireOperator` scope call, the Account card order, the e2e address blocks, the ADR 0027 status text, the § Data access list) still holds at cf125cf.
- No new file of this plan exists at cf125cf (`auth-two-factor-schema.test.ts`, `auth-two-factor.ts`, `totp.ts`, `TwoFactorSection.tsx`, `TotpQr.tsx`, `two-factor-errors.ts`, `totp-setup.ts`, `two-factor.spec.ts`; no `*two_factor*` migration). No landed ticket did a step of this plan.
- Other tickets that landed between the bases (F097 stage 08, F098 stage 09, F100 stages 03 and 08) change no path that the plan names.
