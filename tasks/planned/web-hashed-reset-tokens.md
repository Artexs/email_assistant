> **Status 2026-11-09 — planned.** An idea from the S5a stage 3 review (question 5). Nothing built.

# Store web reset tokens hashed

Scope: hardening of the S5a web login (`apps/server/src/platform/auth.ts`). Needs: S5a merged.

## Goal

A person who can read the database cannot use an open setup or reset link.

## Idea

- Better Auth 1.7.18 stores the reset token in plain text in `auth_verifications.identifier` (`reset-password:<token>`, valid 24 h).
- The option `verification.storeIdentifier: "hashed"` stores a hash; `findVerificationValue` and `consumeVerificationValue` apply it (reviewer's reading of `node_modules/better-auth`; not probed).
- Check first: the `GET /api/auth/reset-password/:token` redirect and `resetPassword` still work; old plain rows from before the change stop working (acceptable: a new `web:invite` link replaces them).

## Log

- 2026-11-09: Written by the S5a build session from the stage 3 review.
