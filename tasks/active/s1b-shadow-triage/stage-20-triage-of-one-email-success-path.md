# s1b-shadow-triage — Stage 20

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 20 — Triage of one email: success path [risky]

- [ ] **20.1 `triageOne`: rules, thread context, classifier, `llm.call` row, threshold, save**
  - Goal: triage one claimed email through the hard rules and the classifier, with one `llm.call` audit row per LLM call, and save it with `saveTriage`.
  - Files: change `apps/server/src/modules/triage/service.ts`, `triage/index.ts`; extend `apps/server/test/integration/triage-service.test.ts`.
  - Interfaces:
    - `interface TriageDeps { db: Db | Transaction<DB>; llm: LlmClient; now(): Date }` (stages 21 and 24 add fields).
    - `type TriageOutcome = { kind: "triaged" } | { kind: "lost" }` (stages 21 and 24 add kinds).
    - `triageOne(deps: TriageDeps, ctx: TenantContext, mailbox: TriageMailbox, email: ClaimedEmail): Promise<TriageOutcome>`.
  - Decisions (architecture §4.1; modules §3.4):
    1. Hard rules: `applyHardRules(email.from_address, mailbox.rules)`. Blocklist → decision `{ finalCategory: "spam", modelCategory: null, confidence: 1, reasonCode: "blocklist", reason: null, summary: null, fields: {}, vip: false, model: null, promptVersion: null, usage: null, auditReasonCode: "blocklist" }`, no LLM call; go to step 5.
    2. Else read the thread: `listThreadContext(deps.db, ctx, mailbox.id, email.thread_key, email.received_at, email.id, { syntheticOnly: isSyntheticMessageId(email.message_id_header) })`, reversed to oldest first (review finding 19). Build the `ClassifierEmail`: `from` = `email.from_address`, `to` = `email.to_addresses`, `cc` = `email.cc_addresses`, `subject`, `receivedAt` = `email.received_at`, `bodyText` = `email.body_text`, `thread` entries from the rows (`bodyExcerpt` = `body_excerpt`).
    3. The LLM call (review finding 24: the `try`/`catch` wraps only this call): `start = Date.now()`; `try { result = await classifyEmail(deps.llm, { email, sender: { whitelisted, vip, noreply }, allowed }) } catch (error) { await recordAudit(deps.db, ctx, { emailId, actor: "system", event: auditEvents.llmCall, reasonCode: llmErrorCode(error), data: { mailbox_id, model: deps.llm.classifierModel, prompt_version: PROMPT_VERSION, tokens_in: null, tokens_out: null, latency_ms: Date.now() - start }, at: deps.now() }); throw error; }` (stage 21 adds the error rules around it). After the `try`: one `llm.call` row with `reasonCode` `ok` and `data` = `{ mailbox_id, model: usage.model, prompt_version, tokens_in, tokens_out, latency_ms }`. Both rows are written with `deps.db`, outside the save transaction, so a call counts also when the mail is later released or lost.
    4. `decideCategory(result.analysis, mailbox.policy)` → decision `{ finalCategory: category, modelCategory: analysis.category, confidence: analysis.confidence, reasonCode: analysis.reason_code, reason: analysis.reason, summary: analysis.summary, fields: analysis.fields, vip, model: usage.model, promptVersion, usage, auditReasonCode: belowThreshold ? "below_threshold" : analysis.reason_code }`.
    5. `return saveTriage(deps.db, ctx, mailbox, email, decision)`.
    - `triageOne` never changes the mailbox and never imports `mail/imap`.
    - The `emails.returned_at` → feedback rule needs system moves (S3): not in S1b.
  - Test (`triage-service.test.ts`, fake `LlmClient` that records requests): info mail → `triaged`, the rows of step 19.1, and 1 `llm.call` row (`reason_code` `ok`, tokens in `data`); blocklist sender → no LLM call, `spam`, `model` NULL, no `llm.call` row; whitelisted sender → the fake LLM got an `allowed` list without `spam`; confidence 0.5 for `info` → final `unsure` with audit `reason_code` `below_threshold`; a fake LLM error → `triageOne` rejects with the same error object, and one `llm.call` row with its code exists; a synthetic mail (`<a@ea-seed.test>`) whose thread also has an older real mail with a marker in its body → the prompt that the fake LLM got does not contain the marker.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: LLM error rules and the pause (stage 21), the job (stages 22–23), the cap and the 7-day rule (stage 24).
