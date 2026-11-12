# s1b-shadow-triage — Stage 5

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 5 — Sender rule and audit repositories [risky]

- [x] **5.1 Repositories for `sender_rules` and `audit_log`, with `org_id` filters**
  - Goal: typed queries for sender rules and the audit log, each with a tenant filter test, and the LLM call count for the daily cap.
  - Files: change `apps/server/src/modules/config/repo.ts`, `apps/server/src/modules/config/index.ts`; create `apps/server/src/modules/audit/repo.ts`, `apps/server/src/modules/audit/index.ts`; create `apps/server/test/integration/rules-audit-repo.test.ts`.
  - Interfaces (all take `db: Db | Transaction<DB>, ctx: TenantContext` first):
    - config: `listSenderRules(db, ctx, mailboxId): Promise<SenderRule[]>` (org rules with `mailbox_id IS NULL` or `= mailboxId`); `insertSenderRule(db, ctx, input: { mailboxId: string | null; pattern: string; kind: SenderRuleKind }): Promise<boolean>` (lower-cases and trims the pattern; `ON CONFLICT DO NOTHING`, returns `false` on a duplicate).
    - audit: `type AuditData = Record<string, string | number | boolean | null>`; `auditEvents = { emailTriaged: "email.triaged", emailSkipped: "email.skipped", actionPlanned: "action.planned", llmCall: "llm.call" } as const`; `recordAudit(db, ctx, event: { emailId?: string; actionId?: string; actor: "system" | string; event: string; reasonCode?: string; data?: AuditData; at?: Date }): Promise<void>` (`at` sets `created_at`; without it the DB default `now()`); `countLlmCallsSince(db, ctx, mailboxId: string, since: Date): Promise<number>` (rows with `event = 'llm.call'`, `data->>'mailbox_id' = mailboxId`, `created_at >= since`, `org_id = ctx.orgId`).
  - Decisions:
    - One repository function = one clear query (Kysely). Every function filters by `ctx.orgId`. `audit_log.data` holds ids, codes and numbers only, never mail text (modules §3.6): the `AuditData` type allows no nested objects. A status change and its audit row go in one transaction (the caller passes `trx`).
    - `llm.call` rows (main-session decision 2026-11-04, review finding 3): one row per LLM call attempt of the worker, success or error. `reason_code` = outcome (`ok` or the LLM error code from step 10.1, for example `http_429`, `timeout`, `bad_output`, `llm_blocked`). `data` = `{ mailbox_id, model, prompt_version, tokens_in, tokens_out, latency_ms }` (tokens NULL on an error). The worker writes it outside the triage transaction, so a call counts also when the mail is later released or lost. The daily cap counts these rows. The mailbox id is in `data`, so the count needs no join to `emails` (a table of the `mail` module).
  - Test (`rules-audit-repo.test.ts`, two tenants as in `mail-repo.test.ts`): each function stores the context org and never reads or counts rows of the other org; `insertSenderRule` lower-cases and returns `false` on a duplicate; `listSenderRules` returns org-wide and same-mailbox rules, not rules of another mailbox; `recordAudit` with `at` stores that time, without `at` the row has a `created_at` within 1 min of now; `countLlmCallsSince` counts only `llm.call` rows of this org and mailbox at or after `since` (rows of another event, another mailbox, another org, or before `since` do not count).
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: the actions repository (stage 6), the triage tables (stages 7–8), services, the worker, CLI scripts.
