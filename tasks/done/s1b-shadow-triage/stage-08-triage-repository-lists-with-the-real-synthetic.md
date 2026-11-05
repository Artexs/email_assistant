# s1b-shadow-triage — Stage 8

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 8 — Triage repository: lists with the real / synthetic filter [risky]

- [x] **8.1 `listUnlabeled`, `listLabeledResults`, `listUsageSince`**
  - Goal: list queries for labeling, the real-label eval and the cost report; real-mail lists never include synthetic mail.
  - Files: change `apps/server/src/modules/triage/repo.ts`, `apps/server/src/modules/triage/index.ts`; extend `apps/server/test/integration/triage-repo.test.ts`.
  - Interfaces (all take `db: Db | Transaction<DB>, ctx: TenantContext` first):
    - `type MailKind = "real" | "synthetic"`.
    - `listUnlabeled(db, ctx, mailboxId, opts: { limit: number; mail: MailKind }): Promise<{ email_id: string; received_at: Date; from_address: string | null; subject: string | null; category: Category; confidence: number; reason_code: string; fields: unknown }[]>` — emails of the mailbox with a triage result and no feedback, newest first, the latest result per email.
    - `listLabeledResults(db, ctx, mailboxId, opts: { mail: MailKind }): Promise<{ email_id: string; category: Category; confidence: number; reason_code: string; model: string | null; fields: unknown; verdict: "right" | "wrong"; true_category: Category | null }[]>` — the latest result and the latest feedback per email.
    - `listUsageSince(db, ctx, mailboxId, since: Date, opts: { mail: MailKind }): Promise<{ model: string; tokens_in: number | null; tokens_out: number | null; latency_ms: number | null; created_at: Date }[]>` — rows with a model.
  - Decisions:
    - Real / synthetic filter on the joined `emails` row (review finding 2): `mail: "real"` → `(e.message_id_header IS NULL OR e.message_id_header NOT ILIKE SYNTHETIC_MESSAGE_ID_LIKE)`; `mail: "synthetic"` → `e.message_id_header ILIKE SYNTHETIC_MESSAGE_ID_LIKE` (constant from the mail index, step 4.1). Real labels, real metrics and the real cost never count synthetic seed mail.
    - "Latest per email": `DISTINCT ON (email_id) … ORDER BY email_id, created_at DESC, id DESC` (or a lateral join); sort the final list in a second step when the order differs.
    - Every function filters by `ctx.orgId` on every table in the query (`triage_results`, `triage_feedback`, `emails`).
    - No summary here (step 26.1 merges it through `listSummaries`).
  - Test (`triage-repo.test.ts`, two tenants): each function never reads rows of the other org; for each list function: a row whose email has `<x@ea-seed.test>` appears only with `mail: "synthetic"`, a row with `message_id_header` NULL counts as real; `listUnlabeled` drops emails that have feedback and returns the latest result; `listLabeledResults` takes the latest result and the latest feedback; `listUsageSince` skips rows with `model = NULL` and rows before `since`.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: services, the worker, CLI scripts.
