# 0020 — Accounts: invite, plan state, consent by mode, deletion

- Status: accepted (F107 stage 08, 2026-11-19). Reserved by the S6 plan; the decisions were built by F077 (plan state), F106 (deletion, export, data requests) and F107 (papers).
- Date: 2026-11-19

## Context

The system runs in local production on the home VPS of the owner. No outside customer uses it (PD-001; master plan P16–P19). The owner is the first and only user. Still, the code holds the account rules that a later customer needs, and each rule needs a recorded decision. This ADR records them. The sources are `docs/capabilities/tenancy-and-plans.md`, `docs/capabilities/account-data.md` and `docs/capabilities/web-panel.md`.

## Decision

1. **Invite only.** There is no public sign-up. The operator makes an organization and its first owner with `org:create` or `org:invite`, and adds further members with `org:member --add`. A member sets a password through a 24 h setup link, or signs in through the company identity provider of the organization (ADR 0026).
2. **Plan state without payment.** An organization has the plan `trial`, `active` or `suspended`. The operator changes it with `org:plan` or the operator console. `suspended` pauses jobs, Telegram and web writes (`SUSPENDED_WRITE_ALLOW` lists the few exceptions). The system has no billing, no price on any page and no payment data.
3. **Consent by mailbox mode, and the Telegram consent.** The mailbox mode is the consent to change the mailbox: a new mailbox starts in `shadow` and changes nothing; the owner turns on `assist` and each switch. Content that goes to Telegram needs the consent of the version `TELEGRAM_CONSENT_VERSION`, which each linked user gives.
4. **Terms acceptance by version.** `TERMS_VERSION` names the legal texts and the two registries (`packages/core/src/legal`). Each member accepts the current version at the next sign-in; a change of a text needs a new version in `TERMS_HISTORY`, and a test fails until it has one.
5. **Organization delete and export.** The owner deletes the organization in the Account card (flag `org_delete`), or the operator runs `org:delete`. The delete is final and runs at once in one database function. The operator exports the data of an organization with `org:export`, to a file that is encrypted to one `age` key.
6. **Data requests on instruction.** A person who is not a user asks the owner. On the owner's instruction, the operator finds and erases that person's data with `org:dsr`. The panel has no page for data requests.

## Consequences

- The legal papers (privacy policy, terms, DPA, DPIA, records of processing, breach procedure) are drafts, marked "DRAFT, not legal advice". They describe the real setup. A lawyer reads them before any outside customer.
- A public sign-up, billing, a self-service export or a self-service data request needs a new ADR.
- The cost model ([cost-model.md](../cost-model.md)) holds a placeholder price of $25 per mailbox per month; it is not for sale.
- The operator carries all account work by CLI. This is acceptable for one organization and does not scale to many.
