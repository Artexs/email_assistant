---
opened: 2026-11-15
---

# F128 · turning two-factor sign-in off or making new backup codes needs a code from the authenticator app, not only the password

## Outcome

A signed-in user who turns two-factor sign-in off, or makes new backup codes, must give a current code from the authenticator app (or one unused backup code) as well as the password. The owner found on 2026-11-15 that the panel asks for the password only. This was decision D28 of F105 ("a live session and the password, not a fresh session"). The owner overrules D28: a person with a stolen session and a leaked password must not be able to remove the second factor.

## Scope

- Server: `apps/server/src/platform/auth.ts`. A before-hook on `/two-factor/disable` and `/two-factor/generate-backup-codes` refuses the request unless the body holds a valid `code` (a current TOTP code, or an unused backup code, which the request then uses up). Use the two-factor plugin's own verify and lock-out rules (failed tries count, lock time); do not write a second code check. The password check of the plugin stays. Answer with a stable error code the panel can show (new Polish text).
- Web: `apps/web/src/components/settings/TwoFactorSection.tsx` asks for the code in the "turn off" and "new codes" steps (one field for a code from the app or a backup code), sends it, and shows the new error texts (`apps/web/src/i18n/pl.ts`; at most one colon per Polish text, informal "ty").
- Security log: a refused request (wrong or missing code) is a security-log row that carries no code and no secret (follow the F105 two-factor kinds); the existing success rows stay.
- Break-glass owner stays unable to turn two-factor off (F105 D12 still wins).
- Tests: unit and integration (wrong code, missing code, expired code, a used backup code cannot be used twice, lock-out after the plugin's limit, password right and code wrong gives the error and changes nothing, an SSO session is unaffected), a Playwright test for the panel flow, and mutations: remove the hook, accept any code, skip the password.
- Docs: ADR 0026 amendment (D28 replaced), `docs/capabilities/` page for sign-in, and the F105 plan Log line.

## Out of scope

- Changing how the sign-in asks for the code, the backup-code count, or the trusted-device rule.
- Requiring a fresh session.

## Acceptance

- With two-factor on, `POST /two-factor/disable` with the right password and no code answers an error and keeps two-factor on; with the right password and a right code it turns it off. The same for `generate-backup-codes`.
- The panel shows the code field in both steps and the Polish error for a wrong code.
- Every mutation listed fails a test. The proof chain (lint, typecheck, test:unit:ci, test:int:ci, e2e under the shared lock) passes.
- After the VPS deploy the owner checks it in the panel (the coordinator deploys: backup first, then verify).

## Notes

- Risky (auth): an Opus review before the land.
- F105 and F106 are deployed; this ticket deploys with the next bundle or alone.
