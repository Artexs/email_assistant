> **Status 2026-11-08 — planned.** Phase 2 (roadmap §1 "Not in the MVP"). Recorded from the S5 plan (P9: the user wants Gmail and other popular providers through OAuth later). Not started.

# Mail adapters with OAuth: Gmail and Microsoft 365

Scope: `docs/roadmap.md` §1 (Phase 2), `docs/architecture.md` §6.1 "Later", `notes/2026-11-02-external-facts-gmail-gemini-telegram.md`. Needs: S5 (the connect form), S6 (hosted production; Google verification needs a public privacy policy and a verified domain).

## Goal

A customer connects Gmail or Microsoft 365 with OAuth instead of an IMAP password, through the web connect form.

## Done when

- `mail/gmail/` (Gmail API or IMAP with XOAUTH2) and `mail/graph/` (Microsoft Graph) implement the `MailProvider` port and pass the contract suite; the OAuth `state` is stored and checked (CSRF); tokens are encrypted like passwords (ADR 0009) and refreshed by the server.
- The connect form offers "Sign in with Google" and "Sign in with Microsoft" for these providers; the IMAP presets stay for the others.
- Google: the OAuth app is verified (restricted scopes) and the CASA assessment is done; the cost is in the S6 cost model.
- `docs/architecture.md` §6.1 and ADR 0010 are updated.

## Plan

Written when the task starts. Start the Google verification early: it is an external wait of weeks (`tasks/planned/s6-pre-sale.md`).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built; related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-08: Created by the S5 master plan session.
