# s1b-shadow-triage — Stage 19

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 19 — Triage save path [risky]

- [x] **19.1 `describeError` and `saveTriage`: result, actions and audit rows in one transaction**
  - Goal: save one triage decision of a claimed email in one transaction, and handle a lost claim without a throw.
  - Files: change `apps/server/src/platform/errors.ts` (add `describeError`); create `apps/server/src/platform/errors.test.ts`; create `apps/server/src/modules/triage/service.ts` (this step: `TriageMailbox`, `TriageDecision`, `saveTriage`); export from `triage/index.ts`; create `apps/server/test/integration/triage-service.test.ts`.
  - Interfaces:
    - `describeError(error: unknown): string` — `error.name` (or `typeof error` for a non-`Error`), plus `" <code>"` when the error has a string or number `code` property (LLM error code, Postgres SQLSTATE). Never the message.
    - `interface TriageMailbox { id: string; mode: MailboxMode; toolSwitches: ToolSwitches; policy: CategoryPolicy; rules: readonly SenderRule[]; movesSupported: boolean }`.
    - `interface TriageDecision { finalCategory: Category; modelCategory: Category | null; confidence: number; reasonCode: string; reason: string | null; summary: string | null; fields: Record<string, unknown>; vip: boolean; model: string | null; promptVersion: string | null; usage: LlmUsage | null; auditReasonCode: string }` (`reasonCode` goes to `triage_results.reason_code`; `auditReasonCode` goes to the `email.triaged` audit row).
    - `saveTriage(db: Db | Transaction<DB>, ctx: TenantContext, mailbox: TriageMailbox, email: ClaimedEmail, decision: TriageDecision): Promise<{ kind: "triaged" } | { kind: "lost" }>`.
  - Decisions (architecture §4.1, §4.6; modules §3.4):
    - Plan: `planActions(decision.finalCategory, decision.summary)`; `decidePolicy` for each action with `categoryAuto = autoFor(mailbox.policy, decision.finalCategory)`, `vip: decision.vip`, `mode`, `toolSwitches`, `movesSupported`; `actionStatusFor`.
    - One save transaction (S1a pattern for a caller transaction: `db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run)`): first `finishEmail(trx, ctx, email.id, email.locked_at, { status: "triaged" })`. If it returns `false`, return `{ kind: "lost" }` from the transaction function before any insert, without a throw (another run took the mail; a throw would abort the caller's transaction in tests), and log `warn` \`triage ${emailId}: lost the claim\`. Else, in this order:
      1. `insertTriageResult`: `category` = `finalCategory`, `confidence`, `reason_code` = `decision.reasonCode` (the model's code; the threshold never changes it), `reason`, `fields` = `{ ...decision.fields, model_category: decision.modelCategory }` when `modelCategory` is not null, else `decision.fields` (so the real-mail eval can sweep thresholds), `model`, `prompt_version`, tokens and latency from `usage` (NULL without usage).
      2. `createPlanned` with `idempotencyKey = \`${emailId}:${type}\``and payload`{ folder }`/`{ summary }`.
      3. `recordAudit` event `email.triaged`, `reasonCode` = `decision.auditReasonCode`, `data` = `{ mailbox_id, final_category, model_category (or null), confidence, prompt_version (or null), model (or null) }`.
      4. One `action.planned` per created action (`actionId`, `data` = `{ action_type, status }`). Audit data has no mail text and no summary.
    - In `shadow` mode every action except `save_summary` is `logged`. `save_summary` is `ready` and waits for the S3 committer. The email status is `triaged`; the move to `done` belongs to the committer (S3).
    - The triage module imports the mail, config, actions and audit modules only through their `index.ts` (`triage → audit` is a new edge in the modules graph; step 35.1 adds it to `docs/modules.md` §2).
    - Logs: email id, mailbox id, category, codes. No subject, no address, no body, no summary.
  - Test:
    - `errors.test.ts`: `describeError(new HardError("secret"))` = `HardError`; an object with `code: "23505"` gives `… 23505`; a thrown string gives `string`; the message never appears.
    - `triage-service.test.ts` (`withRollback`, `insertTestEmail` + `claimEmails` to get a `ClaimedEmail`): an `info` decision (model `m`, usage with tokens and latency, `auditReasonCode` = the model's code) → `{ kind: "triaged" }`, the mail is `triaged`, one `triage_results` row with model, tokens, latency, `prompt_version` and `fields.model_category` `info`, `save_summary` `ready` + `move` `logged`, audit rows `email.triaged` + 2 `action.planned`; a below-threshold decision (`finalCategory` `unsure`, `modelCategory` `info`, `confidence` 0.5, `reasonCode` `fyi`, `auditReasonCode` `below_threshold`) → `triage_results.category` `unsure`, `reason_code` `fyi`, `confidence` 0.5, one `move` `ai_manual` `logged`, audit `email.triaged` `reason_code` `below_threshold`; lost claim: change `locked_at` of the row first (as another run would) → `{ kind: "lost" }`, no `triage_results`, no actions, no throw, and a later query on the same test transaction still works; idempotency: set the row back to `pending` by SQL, claim again, save again → a second `triage_results` row, but `createPlanned` returns `[]` and no second set of actions or `action.planned` rows exists.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: the LLM call (stage 20), LLM error rules and the pause (stage 21), the job (stages 22–23), the cap and the 7-day rule (stage 24).
