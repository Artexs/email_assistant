# s6a-customer-core — Stage 14

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A8, A22–A24 and "Rules for every step" first, and stages 12 and 13 (the clear functions).

## Stage 14 — Retention job `platform.retention`, `job:run`, the readers of cleared data [risky]

One step.

- [ ] **14.1 The daily job and two reader guards**
  - Goal: the server clears the §7 texts every day for every organization (all plans, D4), logs counts only, and the code that reads old rows does not break on a cleared value (A24).
  - Files:
    - create `apps/server/src/retention.ts` (composition root file, beside `web.ts`);
    - change `apps/server/src/main.ts` (schedule, shutdown wait), `apps/server/src/scripts/job-run-args.ts` (+ its test), `apps/server/src/scripts/job-run.ts`;
    - change `apps/server/src/modules/actions/approvals.ts` (`sendAgain` guard);
    - create `apps/server/test/integration/retention-job.test.ts`; add a test to `apps/server/test/integration/actions-approvals.test.ts` and `actions-drafts.test.ts`.
  - Interfaces:

    ```ts
    // apps/server/src/retention.ts
    export const RETENTION_TEXT_DAYS = 90;
    export const LINK_TOKEN_GRACE_MS = 24 * 3_600_000;
    export interface RetentionCounts {
      body: number;
      headers: number;
      triage: number;
      payloads: number;
      errors: number;
      tasks: number;
      outbox: number;
      tokens: number;
    }
    export interface Clearers {
      clearMailBodies: typeof clearMailBodies;
      clearMailHeaders: typeof clearMailHeaders;
      clearTriageTexts: typeof clearTriageTexts;
      clearActionPayloads: typeof clearActionPayloads;
      clearActionErrors: typeof clearActionErrors;
      clearDelegationTasks: typeof clearDelegationTasks;
      clearOutboxTexts: typeof clearOutboxTexts;
      deleteOldLinkTokens: typeof deleteOldLinkTokens;
    }
    // `clearers`: only for the test of an error in one organization (the `triageOne` pattern of TriageJobDeps); default = the module functions.
    export function createRetentionJob(deps: { db: Db; now: () => Date; clearers?: Partial<Clearers> }): {
      run(): Promise<void>;
      runOrg(org: { id: string; dataRetentionDays: number }, now: Date): Promise<RetentionCounts>;
    };
    ```

  - Decisions:
    - `run()`: `const now = deps.now()` once per run; `for (const org of await listOrganizations(db))` (every plan) → `runOrg(org, now)`; a throw for one organization logs `retention org ${id} failed: ${describeError(error)}` and the next goes on; `run()` never throws.
    - `runOrg`: `ctx = { orgId: org.id }`; `body = clearMailBodies(db, ctx, { before: now − org.dataRetentionDays × 24 h, pendingBefore: now − 7 d })`; `headers = clearMailHeaders(…, now − 90 d)`; `triage = clearTriageTexts(…, now − 90 d)`; `payloads = clearActionPayloads(…, now − 90 d)`; `errors = clearActionErrors(…, now − 90 d)`; `tasks = clearDelegationTasks(…, now − 90 d)`; `outbox = clearOutboxTexts(…, now − 90 d)`; `tokens = deleteOldLinkTokens(…, now − LINK_TOKEN_GRACE_MS)`. In this order; no transaction around them (each batch is its own statement; a crash in the middle is safe to repeat, A23).
    - Log: when the sum is above 0, `log.info(\`retention org ${id}: body ${n}, headers ${n}, triage ${n}, payloads ${n}, errors ${n}, tasks ${n}, outbox ${n}, tokens ${n}\`)`; always one line per run at the end, `retention: ${orgs} organizations, ${total} rows`. No text, no mail id.
    - Schedule in `main.ts`: `scheduler.add("platform.retention", "0 40 2 * * *", () => { retentionRun = retention.run(); return retentionRun; })`; `log.info("retention: daily at 02:40")`; `retentionRun` joins the shutdown wait list. The scheduler's no-overlap rule covers two runs at once in one process; two processes on one DB are not supported today (the committer has the same rule).
    - `job:run`: add `platform.retention` to `jobNames` and the usage text; `job-run.ts` builds `createRetentionJob({ db, now: () => new Date() })` and calls `run()`.
    - `sendAgain` guard (A24): after `failed` is locked and before the draft check, `if (!sendPayloadSchema.safeParse(failed.payload).success) return { kind: "draft_gone" };` (`sendPayloadSchema` from `@ea/core`).
    - Draft of a cleared mail (A24): no code change is expected (`bodyText: string | null` in `drafts.ts:52`); the test proves it. If the test fails, the fix is in the core builder (`buildOutgoingMessage` quotes nothing for `null`), in this step.
  - Test:
    1. `retention-job.test.ts` (`withRollback`; `now = 2026-11-12T02:40:00Z`; `run()` walks every organization of the worktree DB, so assert only on the rows of the test's own organizations): org A with `data_retention_days = 30`, org B with `7`, org C `suspended`; in each a `done` mail with `created_at = now − 10 d` and one with `now − 40 d` → after `run()` (with `db = trx`): A clears only the 40-day mail's body; B clears both; C clears the 40-day one (retention runs for suspended orgs).
    2. Same file: a full row set over the 90-day limit in A (one row per A23 row) → one `runOrg` returns 1 in every count; a second `runOrg` returns 0 in every count (idempotence).
    3. Same file: the log line holds counts and the org id only: spy on the log; the joined lines contain no subject, address or body text of the seed.
    4. Same file: two orgs; `clearers.clearMailBodies` throws for the first org id → `run()` resolves, one error line `retention org <first id> failed: …`, and the second org's rows are cleared.
    5. `job-run-args.test.ts`: `--name platform.retention` → parsed; `--name platform.retention --force` → null.
    6. `actions-approvals.test.ts`: a `failed` / `smtp_error` send with `payload = '{}'` and an `applied` draft → `sendAgain` → `draft_gone`; no new row.
    7. `actions-drafts.test.ts`: a `create_draft` for a mail whose `body_text` is null → the APPEND happens and the draft holds the template and no quote block (or the existing "no quote" marker of the builder).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`; then on the worktree DB: `bun run job:run --name platform.retention` → exit 0 and the summary line (paste it).
  - Done when: the checks pass; the hand run printed the summary line.
  - Out of scope: the backups (their period is the bucket rule, U8); `auth_verifications` rows (Better Auth owns them; S6b hashes the tokens; follow-up in stage 17); the docs (stage 17).
