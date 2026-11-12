# s6a-customer-core — Stage 13

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A22–A24, "Facts checked" F6 and "Rules for every step" first, and stage 12 (the batch shape and the test file).

## Stage 13 — Retention: the `actions`, `delegation` and `channels` clear functions [risky]

One step.

- [ ] **13.1 Five clear functions**
  - Goal: the action texts, the delegation tasks, the message texts and the old link tokens of one organization can be cleared after their period, without touching open work that a job still needs, and a repeat call changes nothing (D5).
  - Files:
    - change `apps/server/src/modules/actions/repo.ts` + `index.ts` (`clearActionPayloads`, `clearActionErrors`);
    - change `apps/server/src/modules/delegation/repo.ts` + `index.ts` (`clearDelegationTasks`);
    - change `apps/server/src/modules/channels/repo.ts` + `index.ts` (`clearOutboxTexts`, `deleteOldLinkTokens`);
    - add the cases to `apps/server/test/integration/retention-clear.test.ts`.
  - Interfaces (the same shape as stage 12):

    ```ts
    clearActionPayloads(db: DbOrTrx, ctx: TenantContext, opts: { before: Date; batch?: number }): Promise<number>;
    clearActionErrors(db, ctx, opts): Promise<number>;
    clearDelegationTasks(db, ctx, opts): Promise<number>;
    clearOutboxTexts(db, ctx, opts): Promise<number>;
    deleteOldLinkTokens(db, ctx, opts): Promise<number>; // the caller passes before = now − 1 d
    ```

  - Decisions (rules; "before" is strict):
    - `clearActionPayloads`: `created_at < before AND payload <> '{}'::jsonb AND type IN ('save_summary','create_draft','send') AND (status IN ('applied','expired','failed','rejected','undone','logged') OR (type = 'save_summary' AND status = 'ready'))` → `payload = '{}'`. Why the `ready` `save_summary`: it holds the summary and waits for a committer that does not run for a paused mailbox or a suspended organization (cold review finding 2); a 90-day-old summary has no use. An open `create_draft` or `send` older than 90 days cannot exist (the 24 h, 48 h and 7-day expiry rules), so open rows of those types are not touched.
    - `clearActionErrors`: `updated_at < before AND last_error IS NOT NULL` → `last_error = NULL`.
    - Both action functions change no `status` and no `updated_at`, so no `transitions.ts` row is needed.
    - `clearDelegationTasks`: `updated_at < before AND task_summary <> '[removed]'` → `task_summary = '[removed]'` (covers "90 d after `done`" and "90 d after the last change").
    - `clearOutboxTexts`: two rules in one function:
      - `created_at < before AND status IN ('sent','failed') AND text <> '[removed]'` → `text = '[removed]'`;
      - `created_at < before AND status IN ('pending','sending')` → `status = 'failed', error_code = 'expired', locked_at = NULL, text = '[removed]'`. Why: a row of a suspended organization is never claimed (stage 6), so the sender's 24 h rule never ends it; a 90-day-old message must not go out at a resume.
    - `deleteOldLinkTokens`: `DELETE FROM chat_link_tokens WHERE org_id = … AND token_hash IN (SELECT token_hash … WHERE (used_at < before OR expires_at < before) … LIMIT … FOR UPDATE SKIP LOCKED)` (the table has no `id`; its key is `token_hash`).
  - Test (in `retention-clear.test.ts`, the same setup as stage 12; `before = now − 90 d`):
    1. `clearActionPayloads`: cleared: an `applied` `save_summary` over, a `logged` `send` over, an `expired` `create_draft` over, a `ready` `save_summary` over; kept: an `applied` `move` over (payload `{ folder: "ai_info" }`), an `applied` `send` at the limit, an `awaiting_approval` `send` over (a type with an open status); `status` and `updated_at` of the cleared rows unchanged; repeat → 0; org B unchanged.
    2. `clearActionErrors`: `last_error` set and `updated_at` over → null; at → kept.
    3. `clearDelegationTasks`: a `done` delegation with `updated_at` over → `[removed]`; a `sent` one over → `[removed]`; a `sent` one at → kept; repeat → 0.
    4. `clearOutboxTexts`: `sent` over → `[removed]`; `failed` over → `[removed]` with its `error_code` unchanged; `pending` over → `failed` / `expired` / `[removed]`; `sending` over → the same; `pending` at → kept; `buttons` unchanged; repeat → 0.
    5. `deleteOldLinkTokens` with `now − 1 d`: used 2 d ago → deleted; expired 2 d ago and never used → deleted; expires tomorrow → kept; used 1 h ago → kept.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the checks pass.
  - Out of scope: the job, `job:run`, the readers of cleared data (stage 14).
