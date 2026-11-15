# F113 stage 15 — demo export and import `[risky]`

Part of [`../plan.md`](../plan.md). The demo org at a chosen day becomes one JSON seed file; a dev DB loads it as a new org that never syncs or sends (E10b screenshots). Decisions D16, P5. Risk: data integrity, private data. Review 1: T9, N5.

## Files

`apps/server/src/modules/lab/demo-seed/`, the two commands.

## Interfaces

```ts
type DemoSeed = { format: "ea-demo-seed/1"; scenario: string; runId: string; day: number; exportedAt: string; tables: Record<DemoTable, Record<string, unknown>[]> };
DEMO_TABLES: readonly DemoTable[];            // in insert order (parents first)
exportDemo(db, ctx, run: LabRun, day: number): Promise<DemoSeed>;
importDemo(db, seed: DemoSeed, opts: { ownerEmail: string; replace: boolean }): Promise<{ orgId: string; rows: Record<DemoTable, number> }>;
```

## Decisions

- **Tables.** `DEMO_TABLES`, the tenant tables the panel and reports read: the organization row, mailboxes, mailbox settings, sender rules, delegates, emails and their headers, triage results, triage feedback, actions, delegations, outbox, audit log. Users, sessions, memberships, Telegram links, invites, credentials and two-factor tables are never exported.
- **Columns** (review N5): one rule for secrets, the privacy module's `EXPORT_MAP` (`export: false` columns are dropped), the same map the account export uses. No second regex. Token counts (`tokens_in`, `tokens_out`) stay.
- **Day cut.** Rows created before 00:00 Warsaw after run day `day` (1–7).
- **Address check.** Before the file is written, every value that looks like an address (the DSR address pattern of the privacy module) must end in `.test`; else exit 1 `non_test_address` with the table and column (not the value), and no file.
- **Import target.** A new organization "Kordelan demo (import)" with new UUIDs for every row; each foreign key is mapped through the id map; `org_id` = the new org. JSON columns too (review T9): any string value in a `json`/`jsonb` column that equals an exported row id is replaced by its new id (for example `audit_log.data.mailbox_id`, which the M7 reader filters on, and `actions.payload.delegation_id`). The owner = the user with `--email` (made when missing, the way `org:create` does), with a membership.
- **Import safety.**
  - The mailbox has status `paused` and a placeholder secret, so no job logs in.
  - Actions that are not final become `expired`.
  - Outbox rows that are not sent or failed are dropped.
  - No Telegram link, so no notice goes anywhere.
- **Import guard.** Refuses when `SEND_SCOPE=all` (`import_needs_safe_send_scope`), when the seed `format` differs, or when an org named "Kordelan demo (import)" exists without `--replace`. `--replace` first deletes that org with the privacy delete function, in its own transaction; a failed import after it leaves no imported org (review N5).
- **Transaction.** The import itself runs in one transaction; any error leaves no new rows.
- **File.** Rows sorted by table order, then id, so two exports of the same rows are equal.

## Tests (integration, job DB)

Fixture org: 1 mailbox, 2 delegates, 5 emails with headers and triage, 1 action `awaiting_approval`, 1 applied, 1 delegation, 2 outbox rows (one pending).

1. Export day 7 → every table in `DEMO_TABLES` present with the fixture counts; no `export: false` column of `EXPORT_MAP` appears in the file.
2. An email with `x@gmail.com` in `to_addresses` → `non_test_address` naming the table and column; no file.
3. Day cut: an email created on day 2 is in `--day 2`; one created on day 3 is not.
4. Import into the same job DB → a new org; every id differs from the export; row counts equal (minus dropped outbox); every foreign key points into the new org; `audit_log.data.mailbox_id` and `actions.payload.delegation_id` hold new ids.
5. The open action is `expired`; the mailbox is `paused`; no Telegram link row exists.
6. Second import → refused; with `--replace` → still one imported org.
7. `SEND_SCOPE=all` → refused, nothing written.
8. An import that fails in the middle (a fake bad row) leaves no new org (transaction).
9. Tenant: the source org and a third org are unchanged by the import. Mutation: skip the id map for one foreign key → test 4 fails. Restore.

## Done when

Tests pass; `live-lab.md` has export and import rules; the Proof prints `PROOF_OK`. The final message lists each guard and its failing test.

## Out of scope

Committing a seed file (C6). Screenshots.
