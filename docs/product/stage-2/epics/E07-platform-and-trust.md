# E7 · Platform and trust

> Tier: Must (tier 1). Status: decided, second pass after OIDC spike (identity B only; everything else is ready to plan). Decisions PD-037–PD-050 (2026-11-13). S6b is in build (F082). Size (corrected): about 65 stages, 9k lines; 15 of them are F082.

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

## Discovery (2026-11-13)

Session: Opus 5.5, queue row 3. Detail, sources and design input: [`E07-discovery-notes.md`](E07-discovery-notes.md). ADR drafts: `docs/decisions/0026-identity-tier-1-oidc-totp.md`, `docs/decisions/0027-operator-role-and-feature-flags.md` (proposed).

### Verdict: modify

The outcome is right for the thesis (job 3, "trust and privacy") and for the buyer or auditor. The scope needs five changes:
1. **Drop** the "billing provider port with a fake". It is not built (the page was wrong), it serves no user, and `03` §6 makes billing a non-goal.
2. **Add** data-subject requests as a real design (find, erase, tombstones, address map), an owner security log, and Polish Telegram texts (Telegram is the executive's daily surface; a Polish panel next to an English Telegram is half a feature).
3. **Move** the portable clean-server install and the restore test to the one E8 drill (a clean VM, README install, B2 restore, measured time); **take** the DPIA, records of processing and breach procedure from E8 into the papers (S6e). The E8 session proposes the same.
4. **Unblock identity**: TOTP and break-glass do not need E4 or a spike; OIDC needs only its spike. Sign-in sessions are the same Better Auth sessions for every API command, so the "after E4" dependency is not real.
5. **Plan as seven tickets in two lanes** (notes §11), not one block: the Polish i18n frame, send limits and feature flags must land early because E4, E5, E6 and E9 build on them.

### Code cross-check (short; full table in notes §2)

| Item | Exists today | New |
| --- | --- | --- |
| S6b login (F082) | Stages 1–9 on `master`; checkpoint A review FAIL, blocker B1 (`f1df613`) | Stages 10–15 |
| Org delete, export | `delete_mailbox` function as the shape | `delete_organization`, route, `org:delete`, `org:export` |
| Polish UI | `en.ts`; `users.locale`; auth mails pl and en | `pl.ts`, language rule, Telegram texts per locale |
| Data-subject requests | — (address data in 6 tables) | Find, erase, tombstones, address map |
| Papers, cost | `TERMS_VERSION` and stubs (F082); `triage:cost` | Texts, DPIA, records, breach procedure, cost model v1 |
| S6f | `backup.sh`, `restore-test.sh`; F021 planned | As `s6f-hosted-production.md`; restore test = the E8 drill |
| Send limits | `SEND_SCOPE`, tap per send, retry caps, 48 h approval age | Rolling caps per mailbox and recipient |
| Operator console | `org:*` CLIs; operator notices (Telegram or log) | Operator role, `/operator` page (absorbs F081) |
| Feature flags | Global env scopes only | Per-organization flags |
| Identity | Better Auth 1.7.18, password only; `two-factor` plugin ships in `better-auth` | TOTP UI, `@better-auth/sso`, SSO required, break-glass |
| Billing | Plan state (`org:plan`) | — (port dropped) |

### Cross-epic notes (edits for the owner: notes §10)

- E8: its one drill proves the portable install, the S6f restore test and its own drill; the backup status file is shared; its SLO alerts are operator notices, so the console lists them. E8 dropped its operations dashboard: the console shows the last run of each job per organization from existing rows.
- E4: the i18n frame lands first, so new pages ship pl and en; "send all" needs send limits; the mail digest channel needs an SMTP path and a flag.
- E5, E6: need send limits and flags; their new tables join the delete test and the DSR address map. E11: contacts join the address map.
- E9: needs F082, send limits and flags, not identity tier 1. E10: the security page reuses the papers' sub-processor list.
- `05` §2 graph: drop `E4 → E7i` and `E7i → E9`.

### Research facts that decide (sources in notes §3)

- `@better-auth/sso` 1.7.18 exists for our pinned core (npm, 2026-11-13). By default any signed-in user can register 10 providers; a 2026 domain-verification race allowed account takeover (fixed in 1.6.27, GHSA-8c5h-wx78-2cfg). So: only the operator creates providers.
- `disableImplicitSignUp` alone does not stop new OIDC users (`requestSignUp: true` from any client); `resolveUser` must reject (Better Auth docs).
- `ts.net` is on the Public Suffix List, so Google and Entra accept a tailnet redirect URI: SSO needs no public domain.
- Provider send limits: Exchange Online 30 per minute and 10,000 recipients a day; Gmail 2,000 a day (500 trial), with a block of up to 24 h when hit. Our caps sit far below.
- GDPR processor clause: the processor tells the controller and acts on its instruction; it does not answer the person itself.

### Decisions (owner: "go with the default values", 2026-11-13; rows PD-037–PD-050)

1. Polish UI: keep; also Telegram texts by `users.locale`; the i18n frame is the first ticket after F082 so E4 builds both languages. [yes]
2. Data-subject requests: one API command, CLI `org:dsr --find | --erase`, run by the operator on the owner's instruction; dry-run report; tombstones stop re-import; delegates and rules are listed, not deleted; audit row with a hashed address; no panel page now. [yes]
3. Org delete and the IMAP side: leave drafts the system made in the mailbox; the delete dialog says so. [yes]
4. Identity providers: one generic OIDC path per organization; real end-to-end test on a Microsoft Entra test tenant; Google Workspace by the same code, checked against a local fake IdP in CI. [Microsoft real, Google by config] — second pass after the spike.
5. SSO setup: only the operator creates providers; domain verification by DNS TXT, with operator attestation for test organizations without a domain; no just-in-time accounts. [yes] — second pass after the spike.
6. Identity order: identity A (TOTP, backup codes, break-glass) right after F082; identity B (OIDC) after its spike; no wait for E4. [yes]
7. TOTP and sessions: TOTP optional for members, required for operators and the break-glass owner; an SSO session lasts at most 12 h. [yes]
8. Send limits: 20 per mailbox per hour, 100 per mailbox per 24 h, 5 per recipient per 24 h; over a limit the send waits with a visible reason, and the operator gets one notice per day. [these numbers]
9. Feature flags: in-house per-organization flags (registry, table, env kill list, CLI, console); every new user-visible Stage 2 behaviour ships behind one, default off. [yes]
10. Operator console: `/operator` page for users in `OPERATOR_USER_IDS`; database state only (no logs, no mail content); absorbs F081. [yes]
11. Billing provider port: drop. [drop]
12. Owner security log in the Account card (sign-ins, lockouts, password and 2FA changes, sessions ended, export, delete, DSR). [yes]
13. Papers: S6e also writes the DPIA draft, records of processing and breach procedure; the cost model v1 uses pilot `triage:cost` now, E3 updates it with M7. [yes]
14. Cross-epic moves of notes §10: one E8 drill for install and restore, E9 not after identity, `05` §2 graph without `E4 → E7i` and `E7i → E9`. [yes; this session edits no other page and not the `05` graph; the owner or the first planning session applies them]

### Size (corrected)

About 65 stages, 9k source lines (page said 75, 10k): F082 15 (9 landed), Polish UI 6, platform controls 12, account data 8, papers and cost 6, VPS production 4, identity A 4, identity B 10. Removed: billing port, portable install and restore test (E8 drill). Added: DSR design, Telegram texts, owner security log, three papers.

### Risks (confirmed, added, removed)

- Identity swallows the epic → two tickets, a spike first, SAML and SCIM out (kept).
- Delete misses the IMAP side → leave as is and tell the user in the dialog (decided).
- SSO plugin security history (W3) and the `requestSignUp` bypass → pin the version, operator-only providers, `resolveUser` reject, one test per bypass (added).
- SSO on a tailnet-only panel: every member must join the tailnet → write it in the docs; a public panel needs an ADR 0017 change (added).
- A DSR erase is undone by a rescan → tombstones (added).
- New tables of later epics escape the delete or the DSR → the `information_schema` test and the address-map test (added).
- i18n and E4 pages built in parallel conflict → frame first (added).
- Send limits block a legal burst → the send waits, not fails; E3 re-checks the numbers on the simulated week (added).
- Operator reads leak across organizations → env operator list, route-matrix tests, ids only (added).
- Flags pile up → owner epic and remove-by date per flag (added).

### Planned tickets: absorbed, replaced, dropped

- Absorbed: F081 (operator notices list → platform controls ticket), F078 (expired `auth_verifications` cleanup → account data ticket; note 2026-11-13: F078 is built separately, so E7-T3 drops it), F021 (env split → VPS production ticket, as S6f said). `tasks/planned/s6c-account-data.md`, `s6e-papers-cost.md`, `s6f-hosted-production.md` become the tickets of notes §11.
- Replaced earlier: F056 by F082 (F082's last stage closes it).
- Dropped: none. Stay their own tickets: F069 (active), F084 (F082 follow-up). Out of Stage 2: F076 (Vertex AI). Elsewhere: F023, F073 (E3), F075 (E9).

### Second pass (trigger: the OIDC spike, first stage of identity B)

Only PD-040 and PD-041 wait. The spike checks: `@better-auth/sso` with the renamed tables and the `pg` pool (`resolveUser` transactions), `trustedOrigins` discovery, the TXT record format, the Entra test tenant sign-up path, the session length per sign-in method. A failed check changes ADR 0026 points 2–5. All other tickets (Polish UI, platform controls, account data, papers and cost, VPS production, identity A) are ready to plan.

## Input from the E3 discovery (2026-11-13, PD-056–PD-068)

- `docs/cost-model.md` reads the weekly M7: all LLM calls + hosting share (CX23 €5.99 ÷ 20 mailboxes until the E8 load test) + backup (PD-059).
- The operator console reads the E3a stats route per organization (PD-066).
- E3 owns F023 and F073 (PD-067); F072 leaves Stage 2.
- New E3 user-visible behaviour (weekly report, phishing warning, degraded-mode notice) ships behind flags (PD-045, PD-068).
