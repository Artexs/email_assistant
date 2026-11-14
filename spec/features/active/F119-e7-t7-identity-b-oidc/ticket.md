---
opened: 2026-11-13
---

# F119 · E7-T7 Identity B (OIDC)

## Outcome

Members of an organization with its own identity provider sign in with their company account (OIDC: Microsoft Entra ID, Google Workspace or another OIDC provider), and an "SSO required" organization refuses password sign-in except for its break-glass owner with password and TOTP. Only the operator sets up a provider, proves its domain (DNS TXT, or attestation for a test organization) and switches the rule. No account is made at sign-in: only existing members get in, an SSO session lasts at most 12 h, and every SSO event is an audit row (ADR 0026 points 2–8, PD-040, PD-041, PD-043).

## Scope

- `@better-auth/sso` 1.7.18 on the seam `apps/server/src/platform/auth.ts`; a spike first (stage 01).
- Operator CLIs `org:sso` and `org:member`; the SSO block of the operator console (read-only).
- The login page "Sign in with your company account", the Account card for members without a password.
- Audit rows, security-log kinds, docs, VPS deploy, one real Entra check.

## Out of scope

- SAML, SCIM, passkeys, just-in-time accounts, a panel page for providers or members, more than one domain per provider.
- Mailbox OAuth (E9a, F117): separate tokens and storage (ADR 0026 point 9).

## Acceptance

- A member of a test organization with a proved domain signs in through a fake IdP in CI and through a Microsoft Entra test tenant on the VPS.
- A non-member, a wrong domain and `requestSignUp: true` get no user, no link and no session.
- With "SSO required", password sign-in and reset refuse every member except the break-glass owner with TOTP on.
- An SSO session ends 12 h after sign-in, also after a session refresh.
- An operator with an SSO session gets `403 password_sign_in_required` on `/api/operator/*`.
- The full list: [plan.md](plan.md) § Done when.

## Slices

15 stages, one worker job each ([plan.md](plan.md) § Stages). Stage 01 is the spike; gate G1 (second pass, PD-040, PD-041) stops the build after it. Stage 02 is the only migration; stage 03 the only `bun.lock` change. Stages 14 (VPS) and 15 (real Entra check, owner step U1) come last. Order and lanes: [plan.md](plan.md) § Stages and § How to run.

## Sequenced

- Plan after: none (F105 and F099 have `stages/`; their interfaces are on `master` at the plan base).
- Build after: E7-T2 platform controls (F099, in `spec/features/done/`), E7-T6 identity A (F105, active: stage 15 deployed; must be in `done/`).
- Gate: Stage 1 is the spike; second pass after it (PD-040, PD-041). Owner step U1 (Entra test tenant, shared with F117 per E09 notes R10) before stage 15.

## Notes

Open defaults: [questions.md](questions.md). Sources: `docs/product/stage-2/epics/E07-platform-and-trust.md`, `E07-discovery-notes.md` §3, §8, §11; `docs/decisions/0026-identity-tier-1-oidc-totp.md`; `notes/2026-11-13-identity-and-send-limit-facts.md`; `notes/2026-11-14-two-factor.md` (F105 D27 seam).
