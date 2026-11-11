> **Status 2026-11-08 — planned.** Idea from the S5 plan (P3, D1, D2). Must be done before the panel leaves Tailscale (S6). Not started.

# Web panel hardening before public exposure

Scope: `tasks/active/s5-web-panel.md` D1, D2, D5; `apps/server/src/platform/{auth,http}.ts`. Needs: S5a. Blocks: the S6 move to a public proxy.

## Goal

The login and the API hold up on the public internet: brute force, credential stuffing, leaked passwords, account enumeration and session theft are limited.

## Done when

- A per-user lockout after repeated failed logins (for example 10 failures → 15 minutes), on top of the Better Auth IP rate limit; a test.
- A leaked-password check on password set and change (Better Auth "Have I Been Pwned" plugin or an equivalent), and a captcha or proof-of-work on the login and reset forms (Better Auth captcha plugin).
- The e-mail sender for `sendResetPassword` (S6) with the same answer for a known and an unknown e-mail (no enumeration); the HTTP block of `request-password-reset` from S5 is removed then.
- Session list and "sign out everywhere" in the Account card; session cookies `Secure` (automatic with an `https://` base URL) and the `trustedProxies` list set for the public proxy.
- The mail host rule of the connect form (`isLocalMailHost`) also checks the DNS answer of a host name, so a public name that points to a private address is refused (S5b B12).
- `docs/architecture.md` §7 lists the controls.

## Plan

Written when the task starts.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built; related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-08: Created by the S5 master plan session.
