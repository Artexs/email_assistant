---
opened: 2026-11-13
---

# F117 · E9a Mailbox OAuth

## Outcome

An owner connects a Microsoft 365 or Gmail mailbox with "Sign in with Microsoft" or "Sign in with Google", and the full pipeline (sync, triage, moves, drafts, sends) runs on it through the existing IMAP adapter. Microsoft mail goes out through Graph `sendMail`. A token problem sets `auth_error` with a reason, and one Reconnect keeps the mailbox history. The first stage is a spike on the owner's real test accounts, because the docs do not say if a default Microsoft tenant allows OAuth IMAP (PD-086, PD-087).

## Scope

- Stage 2 row 23 (`docs/product/stage-2/05-execution-plan.md` §2.1); epic `docs/product/stage-2/epics/E09-reach.md` (E9a half) and its discovery notes §5–§6; ADR 0031; architecture review §3.7.
- Seam: `apps/server/src/modules/mail/open.ts`, the one place that reads a mailbox secret and opens the provider and the sender.
- Spike, schema, OAuth flow, token store and refresh, reason codes, Reconnect, Remove, Graph sender, admin consent, Gmail OAuth, panel, docs, provider smoke, VPS deploy.

## Out of scope

- The phone channel ticket (E9b, F118): PWA, Web Push, Telegram detail levels.
- A Graph or Gmail API read adapter, webhooks, IDLE.
- Company sign-in to the panel with Microsoft or Google (the OIDC ticket, F119).
- Google verification and CASA (PD-005).

## Acceptance

- With the fake token server, a new mailbox connects through `/api/mailboxes/oauth/<provider>/start` and the callback, and syncs from GreenMail with XOAUTH2.
- A refused refresh sets `auth_error` with the reason of `plan.md` D17; Reconnect returns it to `active` with the same mailbox id and its mail rows.
- A Microsoft mailbox sends through the fake Graph; the `MailSender` contract suite passes for the fake, SMTP and Graph senders.
- No token, code, `state`, verifier or client secret appears in a log line, error text, audit row or redirect URL (canary tests).
- On the owner's real Microsoft 365 and Gmail test mailboxes, the provider smoke runs 20 cases in assist and sends only to the owner (`plan.md` § Done when 8).

## Sequenced

- Plan after: none.
- Build after: F082 (public login) and F099 (E7-T2 platform controls: send limits, feature flags); both in `spec/features/done/`.
- Gate: Owner: one Microsoft 365 Business Basic seat; stage 1 is the spike; second pass after it (PD-086, PD-087). Plan form: owner step U1 runs the spike kit, gate G1 after stage 02 (`plan.md`). Owner, 2026-11-15: "if that's not necessary explicitly important ... we should skip the tests there and just proceed with the rest of the implementation." So: no real tenant and no real Gmail run now. U1 and U2 are skipped; stage 02 writes `spike.md` from the plan defaults (every row "not run"); G1 passes on the defaults (M3 and G2 assumed PASS); stages 14, 15 and 17–20 build and test against the fakes and the spike kit; stage 21 (real smoke) is skipped. The ticket closes with the line "Microsoft and Google OAuth: not proven live". The flags `mail_oauth_microsoft` and `mail_oauth_google` stay off for every organization until a live run passes.

## Notes

- Replaces the old mail OAuth adapters ticket (F048, dropped). Shares the Microsoft test tenant with the OIDC ticket (F119 Q10).

## Dropped 2026-11-19

Owner: skip, no Microsoft 365 seat or Entra tenant. Landed and kept (flags off): stages 01, 03–13, 16. Not built: 02, 14, 15, 17, 18, 19, 21 (they need live spike results). Microsoft and Google OAuth: not proven live. No active ticket depends on F117. To resume: move this folder to `active/`, run the stage 01 kit with a test account.
