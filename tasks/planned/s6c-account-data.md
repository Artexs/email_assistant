> **Status 2026-11-12 — planned.** Left: the detailed stage plan (an own `plan-task` session), then the build with `run-task`.

# S6c Account and data: delete, export, Polish UI

> **Moved 2026-11-14:** S6c is now `F106-e7-t3-account-data-delete-export-dsr`. This file is history; the ticket decides.

> **Scope change 2026-11-12:** local production on the home VPS, no outside customers (master plan § "Scope change", P16–P24). This file is updated for it; the plan session reads that section first.

Scope: the S6 master plan `tasks/active/s6-pre-sale.md` (P10, P12, D12–D14, D27 (Telegram consent text, draft), "Rules for every step"). Needs: S6b merged (the Account card, the auth mails and `users.locale`). No lawyer step (P19): the Telegram consent text is the agent's draft.
Git mode: worktree (`task/s6c-account-data`). Run mode: pipeline. Review model: stronger reviewer (Opus, high) for the delete stages; Sonnet, high for the i18n stages.

## Goal

An owner deletes their organization from the panel, the operator can export or delete an organization from the CLI, and the panel and the auth mails speak Polish.

## Done when

- The deletion test seeds one row in every table that has an `org_id` or a `user_id` column (the list comes from `information_schema`, so a new table cannot be forgotten), plus the `auth_verifications` rows of the members (matched by `value` = user id) and the S6b lockout rows; after `delete_organization` no row of the organization or of its members is left, and every row of a second organization is still there. The server writes the log line `org deleted <org id> at <time>` (no personal data).
- A member of two organizations is not possible in S6 (finding 5); the function still keeps a user who has another membership (test).
- The delete-organization route works in `suspended` (S6a decision S2): add `{ method: "DELETE", path: /^\/api\/organization$/ }` to `SUSPENDED_WRITE_ALLOW` in `apps/server/src/platform/http.ts` (empty after S6a; the comment there names this entry) and add a route-matrix test that a `suspended` owner can delete and gets `403 org_suspended` on every other write (`docs/code-patterns.md`, HTTP routes).
- The Account card delete: owner only (an `assistant` gets 403), needs the current password and the typed organization name, ends the session, and shows the addresses whose passwords to change (Playwright).
- `org:delete --org-id <id> --confirm <name>` and `org:export --org-id <id> --out <path>` work (tests); the export holds the tables of D14 (emails, outbox texts and chat links too) and no credential, password hash, token or session (test reads the file); the file is `age`-encrypted, mode 600, in a mounted folder; the runbook says to delete it after the delivery.
- The Telegram link step shows the consent text of D27 per user and refuses the link without it (Playwright).
- `pl.ts` has every key of `en.ts` (type check and unit test); the language rule of D12 holds (unit test); the Account card sets `users.locale`; each page renders in Polish at both widths (Playwright snapshot of the headings, no text overflow at the phone width).
- `docs/architecture.md` §7 "Delete" describes the organization delete.

## Owns (from the master plan)

- Decisions D12 (Polish UI), D13 (`delete_organization`, the web route, `org:delete`, the deletion log line), D14 (`org:export`), D27 (the Telegram consent text in the link step; draft, P19). D32 is dropped.
- Files (expected): `db/migrations/<version>_delete_organization.sql`, `modules/tenancy/{remove,export,routes}.ts`, `scripts/org-delete.ts`, `scripts/org-export.ts`, `apps/web/src/components/settings/AccountCard.tsx`, `apps/web/src/i18n/{pl,en,index}.ts`, the language read in the web shell, `platform/auth-mail.ts` (Polish texts exist from S6b; check them).

## Stage sketch

1. **Delete function** `[risky]`: the migration, the grants, the order inside the transaction (D13), the `information_schema` test, the second-organization test.
2. **Delete route and CLI** `[risky]`: owner check, password check (Better Auth `verifyPassword` or a sign-in check; the plan session reads the source), typed name, session end, the address list; `org:delete`; route matrix.
3. **Export CLI**: the JSON shape (all D14 tables), the mounted path, `age` encryption, file mode 600, the no-secret test.
   3b. **Telegram consent**: the text in the link step (the agent's draft: what goes to Telegram — sender, subject, AI summary, draft text — and that Telegram is outside the EU), the stored acceptance per user, the refusal without it.
4. **i18n frame**: `pl.ts` type, the language rule, `users.locale` route, the Account card choice.
5. **Polish texts**: every string; the auth mails checked; Playwright at both widths.
6. **Docs, notes and group review.**

## Questions for the plan session

- The delete dialog texts (pl, en) and whether a grace period is wanted after all (default: no, P10).
- Who translates: the agent writes the Polish texts, the user reads them on the pages (user step, 15 min).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-12: Created by the S6 master plan session (`tasks/active/s6-pre-sale.md`).
