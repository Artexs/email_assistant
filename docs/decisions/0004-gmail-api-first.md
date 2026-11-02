# 0004 — Gmail API first, behind a MailProvider port
- Status: superseded by 0010 (2026-11-02: the pilot mailbox is Interia IMAP, not Gmail)
- Date: 2026-11-01

## Context
The first user has one Gmail mailbox. The current code uses IMAP with a password (Gmail + Interia):
no real thread ids, no labels, weak draft support, and passwords in the DB.
Gmail scopes that read or change mail are restricted: a public app needs OAuth verification and a yearly CASA security assessment.
An OAuth app in "Testing" status gets refresh tokens that expire after 7 days.

## Decision
- Define a `MailProvider` port in the `mail` module: sync since cursor, get message, labels, archive, create draft, send draft.
- First adapter: Gmail API (`googleapis`) with OAuth and scope `gmail.modify`. Sync by `users.history.list` polling every 5 min.
- Microsoft Graph adapter in Phase 2. The IMAP code is kept aside as a possible Phase 2 adapter.
- Start Google verification + CASA work in slice S6, before the first external customer.

## Consequences
- Real threads, labels as folders, drafts and send in one API.
- During the pilot the user re-connects Gmail once a week (Testing status).
- Verification costs time and money; it is on the pre-sale path.
