# s5c-web-settings-rules — Stage 3

Part of [`../s5c-web-settings-rules.md`](../s5c-web-settings-rules.md). Read that file's "Done when", "Owns", S1–S11, "Facts checked", B1–B16, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 3 — Rules service and repository, the rule audit events, `rules:add` refactor, the sync-folder actor [risky]

Two steps. Tenant isolation and audit privacy: a rule pattern is an e-mail address (personal data) and must never reach an audit row or a log line.

- [ ] **3.1 Repository and service: list with ids, add with audit and cap, delete with audit (B7)**
  - Goal: the web and the CLI add and remove sender rules through one service that writes the audit rows.
  - Files: change `apps/server/src/modules/config/repo.ts`, `config/index.ts`, `apps/server/src/modules/audit/repo.ts`, `apps/server/test/integration/rules-audit-repo.test.ts`; create `apps/server/src/modules/config/rules.ts`, `apps/server/test/integration/config-rules.test.ts`.
  - Interfaces:

    ```ts
    // audit/repo.ts, auditEvents (with a data comment like the S5b lines)
    ruleAdded: "rule.added", // data: rule_id, kind, scope, mailbox_id when scope is "mailbox"
    ruleRemoved: "rule.removed", // data: the same
    orgTimezoneChanged: "org.timezone_changed", // data: from, to (stage 4 uses it)
    orgStyleChanged: "org.style_changed", // data: set (stage 4 uses it)

    // config/repo.ts
    export interface SenderRuleRow { id: string; mailbox_id: string | null; pattern: string; kind: SenderRuleKind; created_at: Date }
    export async function insertSenderRule(db, ctx, input: { mailboxId: string | null; pattern: string; kind: SenderRuleKind }): Promise<SenderRuleRow | null>; // null = duplicate
    export async function listSenderRuleRows(db, ctx, opts: { mailboxId?: string }): Promise<SenderRuleRow[]>;
    export async function deleteSenderRule(db, ctx, ruleId: string): Promise<SenderRuleRow | undefined>;
    export async function mailboxInOrg(db, ctx, mailboxId: string): Promise<boolean>;

    // config/rules.ts
    export type AddRuleResult =
      | { kind: "added"; rule: SenderRuleRow }
      | { kind: "exists" }
      | { kind: "limit" }
      | { kind: "mailbox_not_found" };
    export async function addSenderRule(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      input: { mailboxId: string | null; pattern: string; kind: SenderRuleKind; actor: string; now: Date }
    ): Promise<AddRuleResult>;
    export async function removeSenderRule(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      ruleId: string,
      input: { actor: string; now: Date }
    ): Promise<{ kind: "removed" } | { kind: "not_found" }>;
    ```

  - Decisions:
    - `insertSenderRule` keeps the trim and lower case and `onConflict doNothing`, adds `.returning(["id", "mailbox_id", "pattern", "kind", "created_at"])` and `executeTakeFirst()`; no row → `null`. Parse `kind` with the existing `senderRuleKindSchema`. Update its test (`rules-audit-repo.test.ts:78-112`): `toBe(true)` → `not.toBeNull()` and the returned `pattern`; `toBe(false)` → `toBeNull()`.
    - `listSenderRuleRows`: `where org_id`; with `mailboxId`: `mailbox_id IS NULL OR mailbox_id = $1`; order `created_at`, `id`. `deleteSenderRule`: `DELETE … WHERE org_id AND id RETURNING …`. `mailboxInOrg`: `SELECT id FROM mailboxes WHERE org_id AND id` (the precedent of `getMovesSupported`: `config` reads `mailboxes` because it cannot import `mail`).
    - `addSenderRule`: `pattern = normalizeSenderPattern(input.pattern)`; `!isValidSenderPattern(pattern)` → `throw new HardError("invalid sender pattern")` (the message holds no pattern). One transaction (`db.isTransaction ? run(db) : db.transaction().execute(run)`): `mailboxId !== null && !(await mailboxInOrg(...))` → `mailbox_not_found`; `countSenderRules(trx, ctx) >= SENDER_RULE_LIMIT` → `limit`; `insertSenderRule` → `null` → `exists` (no audit row); else `recordAudit(trx, ctx, { actor, event: auditEvents.ruleAdded, data: { rule_id, kind, scope, ...(mailboxId ? { mailbox_id } : {}) }, at: now })` and `added`. When the service opened the transaction itself (`!db.isTransaction`), an error with `code === "23503"` (the mailbox was removed between the check and the insert) → `mailbox_not_found`; inside a caller's transaction the error aborted that transaction, so the service rethrows it. Rethrow everything else. Two adds at the same time can pass the cap by a row or two, and at the cap a duplicate answers `limit`, not `exists`: both accepted (B7).
    - `removeSenderRule`: one transaction: `deleteSenderRule` → `undefined` → `not_found`; else the `rule.removed` row with the same data, `removed`.
    - The `mailbox_id` in the audit data lets `delete_mailbox` remove the row with the mailbox (it deletes `audit_log` rows by `data->>'mailbox_id'`, S5b B7).
    - No log line in the service (the CLI and the routes decide). Export from `config/index.ts`: `addSenderRule`, `removeSenderRule`, `listSenderRuleRows`, `type SenderRuleRow`, `type AddRuleResult`.
  - Test (`config-rules.test.ts`, `withRollback`, two tenants as in `rules-audit-repo.test.ts:27-47`, `NOW = 2026-11-11T12:00:00Z`):
    1. `addSenderRule` org-wide `" Boss@Firma.TEST "` vip, actor `user-1` → `added` with pattern `boss@firma.test`; one `rule.added` row with actor `user-1`, `created_at` = NOW, `data` = `{ rule_id: <id>, kind: "vip", scope: "org" }`; `JSON.stringify(data)` does not contain `firma`.
    2. The same again → `exists`; still one audit row.
    3. Mailbox scope on A's mailbox → `added`; data `{ rule_id, kind: "whitelist", scope: "mailbox", mailbox_id: <A's mailbox> }`.
    4. B's mailbox id with A's context → `mailbox_not_found`; no row, no audit row.
    5. `"@x.pl"` → rejects with `HardError` whose message is `invalid sender pattern`.
    6. Cap: insert 1000 rows for A with one `INSERT … SELECT generate_series` (`pattern` `r<n>.test`, kind `vip`) in the test transaction → `addSenderRule` → `limit`; B (no rows) can still add.
    7. `removeSenderRule` of test 1's id → `removed`; the row is gone; one `rule.removed` row with the same data shape; again → `not_found`; B's context with A's rule id → `not_found` and A's row stays.
    8. Tenant filters (one assertion each, the code-patterns rule): `listSenderRuleRows(B ctx, {})` never returns A's rows; `listSenderRuleRows(A ctx, { mailboxId: B's mailbox })` returns only A's org-wide rows; `deleteSenderRule(B ctx, A's id)` → `undefined`; `mailboxInOrg(A ctx, B's mailbox)` → false; `insertSenderRule(B ctx, { mailboxId: A's mailbox, … })` rejects with code `23503` (the composite foreign key). A failed statement aborts the test transaction: use the savepoint helper `expectFailure` of `triage-schema.test.ts:32-46` (a SQL `savepoint`, the failing call, then `rollback to savepoint`; copy the helper into the test file). Kysely's `Transaction` has no savepoint method.
    9. `listSenderRuleRows(A ctx, {})` returns org-wide and every mailbox's rows of A in `created_at, id` order with the five fields.
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; `grep -rn "pattern" apps/server/src/modules/config/rules.ts` shows no pattern in an audit `data` object or a log call.
  - Out of scope: the routes (stage 6).

- [ ] **3.2 `rules:add` on the service, the sync-folder actor (B5, B7)**
  - Goal: the CLI writes the same audit row as the web; the sync-folder setter accepts a user id as actor.
  - Files: change `apps/server/src/scripts/rules.ts`, `apps/server/src/modules/mail/folders.ts`; create `apps/server/test/integration/rules-cli.test.ts`.
  - Interfaces:

    ```ts
    // mail/folders.ts
    export async function setSyncFolderEnabled(
      db,
      ctx,
      mailboxId,
      key,
      enabled,
      actor: string,
      at: Date
    ): Promise<SyncFolderSwitchResult>;
    ```

  - Decisions:
    - `scripts/rules.ts`: delete `domainPattern`, `addressPattern`, `isValidPattern`; use `normalizeSenderPattern` and `isValidSenderPattern` from `@ea/core` (same rule, B1). `add` calls `addSenderRule(db, ctx, { mailboxId, pattern, kind, actor: "cli", now: new Date() })`: `added` → `added <kind> <pattern>` (stdout, exit 0); `exists` → `already there: <kind> <pattern>` (exit 0); `limit` → `refused: rule limit reached (1000)` (exit 1; the number from `SENDER_RULE_LIMIT`); `mailbox_not_found` → `refused: mailbox not found` (exit 1). The pattern stays on stdout only (the user's own setting; the script's comment says so). `list` is unchanged.
    - `setSyncFolderEnabled`: only the type of `actor` widens; the CLI still passes `"cli"`, the sync job `"system"`.
  - Test (`rules-cli.test.ts`, spawn as in `mail-folders-cli.test.ts:22-36`, committed organization with `createOrgWithMailbox` in `db.transaction().execute`, cleanup `DELETE FROM organizations WHERE id` in `afterAll`):
    1. `bun apps/server/src/scripts/rules.ts add --org-id <org> --pattern Boss@Firma.test --kind vip` (the `rules:add` script with its positional `add`) → exit 0, stdout `added vip boss@firma.test`; one `rule.added` row with actor `cli`.
    2. The same again → exit 0, stdout `already there: vip boss@firma.test`; still one audit row.
    3. `--pattern @firma.test` → exit 1 with the usage (as today).
    4. `--mailbox-id <a random uuid>` → exit 1, `refused: mailbox not found`.
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; `mail-folders-cli.test.ts` passes unchanged.
  - Out of scope: a CLI remove command (not asked).
