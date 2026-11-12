# E7 · Platform and trust

> Tier: Must (tier 1). Status: S6b is in build (F082); S6c, S6e, S6f need `plan-task`; identity tier 1 needs a spike. Size: about 75 stages, 10k lines; half is the planned S6b–S6f.

## Outcome

A buyer or an auditor finds what they expect: hardened login, delete and export, data-subject requests, legal drafts, a cost model, an operator console, send limits, feature flags, and company sign-in for organizations that have an identity provider.

## Users

Executive (login, SSO, delete, export), operator (console, flags, notices), auditor (papers).

## In scope

- **S6b public login** (F082, running): invite only, lockout, leaked-password check, terms, session list, mail host check.
- **S6c account data**: delete organization (every row), `org:export`, Polish UI; plus data-subject requests for people who are not users (senders): find and delete by address, with an audit row.
- **S6e papers and cost**: privacy policy, terms, DPA as in-app pages marked "DRAFT, not legal advice", describing the real setup; `docs/cost-model.md` from E3 numbers with a placeholder price.
- **S6f production on the home VPS**: CI green, env split (F021), Backblaze upload verified, restore test, ADR 0019; plus a portable install: a clean-server install from the README, tested once.
- **Send rate limits** per mailbox (SMTP), so a bug never sends many mails.
- **Operator console**: organizations, plans, mailboxes, notices, last errors and job runs per organization (CLI only today; F081).
- **Feature flags per organization**: gradual roll-out and kill switch per feature.
- **Identity tier 1** (R6): OIDC with Google Workspace and Microsoft Entra ID; domain verification by DNS TXT; "SSO required" switch per organization; just-in-time accounts off by default; break-glass owner with password and TOTP; offboarding at the next session check; audit rows for SSO events; TOTP second factor for password users. Spike first: Better Auth `sso` and `two-factor` plugin versions and fit.
- Billing: plan state only (built); a "billing provider" port with a fake, no real account.

## Out of scope

SAML, SCIM, passkeys (later, when an organization asks). Hosted EU production, Vertex AI (F076 stays a ticket). Real legal review.

## Dependencies

E1. Identity tier 1 after E4 (API commands, approvals pages) so the SSO session model covers them. Blocks E9, E10, E12.

## Open product questions

1. S6c Polish UI: keep (owner is a Polish user) or defer; the review keeps it.
2. Data-subject request flow: CLI only, or an operator console page.
3. Identity: Google and Microsoft both in tier 1, or Microsoft first to match PD-005.

## Risks

- Identity work can swallow the epic; the tiers and the spike keep it bounded.
- Delete must cover the IMAP side too (drafts the system made): decide "leave as is" and document it.

## Exit

- The "Done when" lines of `tasks/active/s6-pre-sale.md` hold for S6b, S6c, S6e, S6f.
- A test organization with a verified domain signs in only through OIDC; the break-glass owner still gets in with password and TOTP.
- A clean-server install from the README works once; send limits and feature flags have tests; the operator console shows the second organization.
