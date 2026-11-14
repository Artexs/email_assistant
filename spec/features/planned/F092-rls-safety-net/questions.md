# F092 · Open questions (small: the stages do not change with the answer)

Each has a default that the plan uses now. Answer only to change one.

1. **The web sets `app.org_id` per connection acquire, not in one request transaction.** The review and the old input said "`requireTenant` opens the request transaction with `SET LOCAL`". The code does not fit it: two web paths call `db.transaction()` directly and Kysely refuses a transaction inside a transaction; a caught Postgres error would abort the whole request; the connect route would hold a transaction across an IMAP login. The plan keeps the organization in an async scope, and the DB driver writes it on each connection acquire (probes K2–K7). Same outcome, no route or service change. Default: the scope. (plan.md D7)
2. **`delete_mailbox` checks the scope.** It runs as the table owner and bypasses RLS. The migration adds one first check: under a scope, another organization's mailbox answers "mailbox not found" (the same 404 as today). Default: add the check. (D12)
3. **Unscoped web paths.** `/api/operator/*` (by design), `/api/auth/*` (Better Auth, before a tenant exists), `/health` and the page paths (`/` redirect, static files). Only `/api/operator/*` is inside the `/api` tenant middleware. Default: these four. (D17)
4. **No start check for the policies.** The server does not refuse to start when the RLS migration is missing (that state equals today: all rows). The deploy runs `db:migrate` before the start. Default: no check. (D21)
