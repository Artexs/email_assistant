# s6a-customer-core — Stage 5

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A7, A9–A12 and "Rules for every step" first, and stage 4 (the service this stage calls).

## Stage 5 — CLIs `org:plan`, `org:create --plan`, `org:status`, and the suspend hook

Three steps. The CLIs print ids, codes, ISO UTC dates and counts only, never an organization name, a user name or an address.

- [ ] **5.1 The suspend hook `cancelPendingOutboxOfOrg` (A12)**
  - Goal: when an organization becomes `suspended`, its queued Telegram messages never go out (S3).
  - Files: change `apps/server/src/modules/channels/repo.ts` (new function), `apps/server/src/modules/channels/index.ts` (export); add tests to `apps/server/test/integration/channels-outbox.test.ts`.
  - Interfaces: `export async function cancelPendingOutboxOfOrg(trx: DbOrTrx, ctx: TenantContext): Promise<number>` — `UPDATE outbox SET status = 'failed', error_code = 'outdated', locked_at = NULL WHERE org_id = ctx.orgId AND status = 'pending' AND kind NOT IN ('approval', 'approval_set')`; returns the row count.
  - Decisions: rows in `sending` are not touched (the sender holds them; they finish). `error_code = 'outdated'` is an existing code (no migration). The approval kinds stay `pending` (cold review finding 7): the notifier set `actions.notified_at` when it queued them (`channels/notices.ts:445`) and never queues them again, so a cancelled request would let the send time out unseen. They wait (the sender does not claim them in `suspended`, stage 6) and go out at a resume within 24 h; after that the sender's 24 h rule ends them (A17).
  - Test:
    1. Org A with one `pending` `urgent`, one `pending` `approval`, one `sending`, one `sent` row; org B with one `pending` row → returns 1; A's pending `urgent` → `failed`/`outdated`; A's `approval`, sending and sent unchanged; B's pending unchanged (tenant filter).
  - Check: in 5.3.
  - Done when: in 5.3.
  - Out of scope: the sender's claim filter (stage 6).

- [ ] **5.2 `org:plan` and `org:create --plan`**
  - Goal: the operator sets the plan, the trial end and the mailbox limit from the shell (D3), and a new organization starts in `trial` by default.
  - Files: create `apps/server/src/scripts/org-plan-args.ts`, `apps/server/src/scripts/org-plan-args.test.ts`, `apps/server/src/scripts/org-plan.ts`; change `apps/server/src/scripts/org-create.ts`; add `"org:plan": "bun apps/server/src/scripts/org-plan.ts"` and `"org:status": "bun apps/server/src/scripts/org-status.ts"` to the root `package.json` scripts (next to `org:create`; no dependency change, so `bun.lock` does not change); create `apps/server/test/integration/org-cli.test.ts`.
  - Interfaces:

    ```ts
    // org-plan-args.ts
    export const usage: string; // "usage: bun run org:plan --org-id <uuid> [--plan trial|active|suspended] [--trial-days N] [--max-mailboxes N]"
    export interface OrgPlanArgs {
      orgId: string;
      plan?: OrgPlan;
      trialDays?: number;
      maxMailboxes?: number;
    }
    export function parseOrgPlanArgs(argv: string[]): OrgPlanArgs | null; // null on any bad argument
    ```

    `org-plan.ts`: `loadConfig`, `createDb`, `assertAppRole`, then `setOrgPlan(db, { orgId }, { ...args, actor: "cli", now: new Date() }, { onSuspended: cancelPendingOutboxOfOrg })`, then `db.destroy()`.

  - Decisions:
    - `parseOrgPlanArgs`: `--org-id` must be a UUID; `--plan` one of `orgPlans`; `--trial-days` and `--max-mailboxes` digits only (`/^\d+$/`, then `Number`); the range checks stay in `setOrgPlan` (one place). No positionals; `strict: true`.
    - Output and exit codes:
      - `changed` → `org <id>: plan <from> → <to>, max_mailboxes <from> → <to>, trial_ends_at <iso|->, resumed_at <iso|->` and, when the hook ran, `cancelled <n> queued messages`; exit 0.
      - `unchanged` → `org <id>: no change (plan <plan>, max_mailboxes <n>)`; exit 0.
      - `not_found` → `organization not found`; exit 1. `trial_days_needed` → `--trial-days is needed to start a trial`; exit 1. `bad_input` → `bad input: <reason>` and the usage; exit 1.
      - A `to = active` from `trial` after the trial date is normal (payment received); no warning.
      - The catch-all of each new script logs only `describeError(error)`, never `error.message` (do not copy the `org-create.ts:58-60` form; change it there too).
    - `org-create.ts`: new options `--plan trial|active` (default `trial`) and `--trial-days N` (default `30`; with `--plan active` → usage error). It passes `plan: { kind: "trial", endsAt: now + days × 24 h }` or `{ kind: "active" }`. The success line becomes `created org <id> user <id> plan <plan> trial_ends_at <iso|->`. The usage text names the new options.
  - Test:
    1. `org-plan-args.test.ts`: valid full set → parsed; missing `--org-id` → null; `--org-id nope` → null; `--plan gold` → null; `--trial-days 1.5` → null; `--max-mailboxes -1` → null; an extra positional → null; only `--org-id` → `{ orgId }` (the service answers `nothing_to_change`).
    2. `org-cli.test.ts` (spawn the script like `web-invite-cli.test.ts`, with the worktree DB env; create the organization committed and delete it in `finally`, F8): `org:plan --plan suspended` → exit 0, stdout holds `plan active → suspended` and `cancelled 0 queued messages`; the DB row is `suspended`; stdout holds no organization name.
    3. Same org `--plan active` → `resumed_at` set in stdout and in the row.
    4. `--plan trial` without `--trial-days` → exit 1, `--trial-days is needed`.
    5. `org:create` without `--plan` → the row is `trial` with `trial_ends_at` 30 days ± 1 min from now; `--plan active --trial-days 5` → exit 1.
  - Check: in 5.3.
  - Done when: in 5.3.
  - Out of scope: `org:invite` (S6b).

- [ ] **5.3 `org:status` (A11)**
  - Goal: the operator sees per organization the plan, the mailbox states, the last sync, today's LLM calls and the linked chats, ids and counts only (D3, D31).
  - Files: create `apps/server/src/scripts/org-status-lines.ts` (the testable part), `apps/server/src/scripts/org-status.ts` (args, DB, print); add tests to `apps/server/test/integration/org-cli.test.ts`.
  - Interfaces: `export async function orgStatusLines(db: DbOrTrx, opts: { orgId?: string; now: Date }): Promise<string[] | null>` — `null` when `orgId` is given and unknown.
  - Decisions:
    - Sources: `listOrganizations` (tenancy; filter by `orgId` when given), `listMailboxes(db, ctx)` (mail), `countLlmCallsSince(db, ctx, mailboxId, quotaDayStart(now, QUOTA_TIMEZONE))` (audit and `@ea/core`) summed over the mailboxes, `listLinkedChatsOfOrg(db, ctx)` (channels). No new repository function.
    - Lines per organization (exact format, one organization after the other, a blank line between):

      ```
      org <id> plan=<plan> trial_ends_at=<iso|-> max_mailboxes=<n> resumed_at=<iso|->
        mailboxes total=<n> active=<n> paused=<n> auth_error=<n> last_sync=<iso|never>
        llm_calls_today=<n> telegram_chats=<n>
      ```

      `max_mailboxes` comes from `getOrgPlan` (the list has no max). `last_sync` = the newest `last_synced_at` of the organization's mailboxes.

    - `org-status.ts`: `--org-id <uuid>` optional; an unknown id → `organization not found`, exit 1; no organization at all → `no organizations`, exit 0.

  - Test:
    1. Two orgs (committed, deleted in `finally`): A `trial` with 2 mailboxes (`active`, `auth_error`), two `llm.call` audit rows today and one yesterday (quota day of `now`), one linked chat; B `suspended` with none. `orgStatusLines(db, { orgId: A, now })` → the three lines with `active=1 auth_error=1`, `llm_calls_today=2`, `telegram_chats=1`.
    2. The joined output holds neither org name nor any mailbox address nor any user e-mail (`expect(text).not.toContain(…)` for each).
    3. Unknown `orgId` → `null`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`; then by hand on the worktree DB: `bun run org:status` (paste the first organization's lines, ids only, in the log).
  - Done when: the checks pass; the hand run prints the format above.
  - Out of scope: a web view of the plan (stages 15 and 16); billing.
