---
opened: 2026-11-12
landed: 2026-11-14
---

# F082 · The panel login has the production shape: invite only, lockout, leaked-password check, terms, session list

## Outcome

A person gets into the panel only through an invite link. A reset request tells nobody whether an address has an account. Failed sign-ins lock the account for a short time, and leaked passwords are refused. The first password set records the accepted terms, and the Account card lists the sessions. The auth-mail sender exists and is tested, but stays off on the home VPS, where the CLI prints the invite and reset links (S6 scope change, P18).

## Scope

- Starting seam: `apps/server/src/platform/auth.ts` (Better Auth hooks), `platform/http.ts` (allow-list, public pages), `web.ts` (wiring).
- Auth-mail sender with env keys (off without them), `/forgot`, `org:invite`, `web:invite` mails or prints.
- Lockout, leaked-password check, terms acceptance with stub legal pages, session list with audit rows.
- The mail host address check on every IMAP and SMTP connect (form, sync, send).
- Replaces the planned ticket F056 (web public hardening); the last stage closes it.

## Out of scope

- A real mail provider, DNS records, a public domain (P18).
- The Polish UI and the language choice (S6c); the legal texts (S6e).
- Deleting expired `auth_verifications` rows (F078); an operator notice list in the panel (F081).

## Acceptance

- Every line of "Done when" in [plan.md](plan.md) holds, each with the test or check that the line names.
- On the home VPS, with the owner's go: `org:invite` prints a link, setup needs the terms checkbox, 10 wrong passwords lock the test user, and `password1234` is refused.

## Slices

One worker job per stage (`stages/stage-01` to `stage-15`), each landed with `limen land --keep-open`. Two lanes may run at once: the auth stages 1–7 next to the mail-host stage 8, and after checkpoint A the web stages 10–12 next to stage 13; the table is in [plan.md](plan.md) § "Parallel plan". Stage 1 is the only migration: it must not run next to another migration or `bun.lock` change. The coordinator stops after stage 1 (`db:migrate` on the dev database), at checkpoint A after stage 9, and at stage 15 (VPS). Spawn and review commands: [plan.md](plan.md) § "How to run".

## Notes

Plan, owner decisions B1–B7, design decisions L1–L32, facts and the cold review: [plan.md](plan.md). Master plan: `tasks/active/s6-pre-sale.md`. Builds after F077 stage 18 (the S6a deploy).
