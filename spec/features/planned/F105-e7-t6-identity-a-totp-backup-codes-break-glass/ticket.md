---
opened: 2026-11-13
---

# F105 · E7-T6 Identity A (TOTP, backup codes, break-glass)

## Outcome

A member can turn on a second sign-in factor in the Account card: an authenticator app code (TOTP) with ten single-use backup codes, and an optional trusted device for 30 days. An operator must have it to use the operator console, and each organization can have one break-glass owner who keeps password and TOTP sign-in for the later "SSO required" rule. The operator can reset a member's second factor from the CLI, and every change is an audit row (PD-042, PD-043, ADR 0026 points 1, 6 and 8).

## Scope

- The `two-factor` plugin that ships inside the pinned `better-auth` 1.7.18; the seam is `apps/server/src/platform/auth.ts`.
- The sign-in code step and the Account card section with a QR code.
- The operator rule, the break-glass designation and the reset CLI.
- Audit rows for every second-factor event, and their kinds in the owner security log of the platform-controls ticket (F099).

## Out of scope

- OIDC, "SSO required", the 12 h SSO session and the break-glass sign-in exception itself (identity B, F119).
- E-mail or SMS codes, passkeys, a panel page to choose the break-glass owner, mails about 2FA changes.

## Acceptance

- A member with TOTP on signs in only with password plus a code or an unused backup code; a used backup code fails.
- An operator without TOTP gets `403 two_factor_required` on `/api/operator/*` and is sent from `/operator` to the settings page.
- A break-glass owner cannot turn TOTP off; `org:break-glass` refuses a user without TOTP or who is not an owner.
- No log line, error text or audit row holds a TOTP secret, a code or a backup code.
- The full list with the proving tests: [plan.md](plan.md) § Done when (12 checks).

## Slices

15 stages, one worker job each ([plan.md](plan.md) § Stages). Stage 01 is the only migration (never next to another migration of any ticket). Stage 10 changes `bun.lock` (never next to another `bun.lock` change). Lanes: server 01→02→03→05, then 06 and 07 after 05; operator rule 04 after 02; status route 08 after 04 and 05; web 09 after 02, 10 after 09, 11 after 08 and 10; e2e 12 after 11; security log 13 after 07 and F099 stages 12–13; docs 14; VPS 15. No owner checkpoint. Commands: [plan.md](plan.md) § "How to run (coordinator)".

## Sequenced

- Plan after: none. Stage 13 uses the security-log registry of F099 stages 12–13 (F099 has `stages/`).
- Build after: public login (F082, in `spec/features/done/`).
- Gate: —. Stage 13 waits until F099 stages 12 and 13 have landed; the other stages do not wait for it.

## Notes

Open defaults: [questions.md](questions.md). Sources: `docs/product/stage-2/epics/E07-discovery-notes.md` §8, §11; `docs/decisions/0026-identity-tier-1-oidc-totp.md`; PD-042, PD-043, PD-048.
