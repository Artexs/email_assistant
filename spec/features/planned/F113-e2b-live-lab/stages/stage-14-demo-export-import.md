# F113 stage 14 — demo export and import `[risky]`

Part of [`../plan.md`](../plan.md). Decisions D16, P5. Risk area: data integrity and private data (a file leaves the stack).

## Goal

The demo organization at a chosen day becomes one JSON seed file; a dev database loads it as a new organization that never syncs or sends (for E10b screenshots).

## Files

`apps/server/src/modules/lab/demo-seed/` (`export.ts`, `import.ts`, `tables.ts`), the two commands.

## Interfaces

```ts
type DemoSeed = { format: "ea-demo-seed/1"; scenario: string; runId: string; day: number; exportedAt: string; tables: Record<DemoTable, Record<string, unknown>[]> };
DEMO_TABLES: readonly DemoTable[];            // in insert order (parents first)
exportDemo(db, ctx, run: LabRun, day: number): Promise<DemoSeed>;
importDemo(db, seed: DemoSeed, opts: { ownerEmail: string; replace: boolean }): Promise<{ orgId: string; rows: Record<DemoTable, number> }>;
```

## Decisions

- **Tables.** `DEMO_TABLES` lists the tenant tables that the panel and the reports read for one organization: the organization row, mailboxes, mailbox settings, sender rules, delegates, emails and their headers, triage results, triage feedback, actions, delegations, outbox, audit log. Check the list at `HEAD` against the panel pages; name any table you add. Users, sessions, memberships, Telegram links, invites, credentials and two-factor tables are never exported.
- **Columns.** A column whose name matches `password|secret|token|credential|key_hash|totp|backup` is dropped from every table; a test lists the dropped columns. The mailbox row keeps address and settings; its connection secret is not exported.
- **Day cut.** Rows created before 00:00 Warsaw after run day `day` (stage 01 time rules). `day` from 1 to 7.
- **Address check.** Before the file is written, every value that looks like an address (the DSR address pattern of the privacy module) must end in `.test`; else exit 1 `non_test_address` with the table and column (not the value), and no file.
- **Import target.** A new organization "Kordelan demo (import)" with new UUIDs for every row; each foreign key is mapped through the id map; `org_id` = the new org. The owner = the user with `--email` (made when missing, the way `org:create` does), with a membership.
- **Import safety.**
  - The mailbox is paused or disconnected (the status that stops sync; the worker finds it at `HEAD`) with a placeholder secret, so no job logs in.
  - Actions that are not final become `expired`.
  - Outbox rows that are not sent or failed are dropped.
  - No Telegram link, so no notice goes anywhere.
- **Import guard.** Refuses when `SEND_SCOPE=all` (`import_needs_safe_send_scope`), when the seed `format` differs, or when an org named "Kordelan demo (import)" exists without `--replace`. `--replace` deletes that org with the privacy delete function first.
- **Transaction.** The import runs in one transaction; any error leaves nothing.
- **File.** Rows sorted by table order, then id, so two exports of the same rows are equal.

## Tests (integration, job DB)

Fixture org: 1 mailbox, 2 delegates, 5 emails with headers and triage, 1 action `awaiting_approval`, 1 applied, 1 delegation, 2 outbox rows (one pending).

1. Export day 7 → every table in `DEMO_TABLES` present with the fixture counts; no dropped column name appears anywhere in the file.
2. An email with `x@gmail.com` in `to_addresses` → `non_test_address` naming the table and column; no file.
3. Day cut: an email created on day 2 is in `--day 2`; one created on day 3 is not.
4. Import into the same job DB → a new org; every id differs from the export; row counts equal (minus dropped outbox); every foreign key points into the new org.
5. The open action is `expired`; the mailbox is in the status that stops sync; no Telegram link row exists.
6. Second import → refused; with `--replace` → still one imported org.
7. `SEND_SCOPE=all` → refused, nothing written.
8. An import that fails in the middle (a fake bad row) leaves no new org (transaction).
9. Tenant: the source org and a third org are unchanged by the import. Mutation: skip the id map for one foreign key → test 4 fails. Restore.

## Done when

Tests pass; `live-lab.md` has export and import rules; the Proof prints `PROOF_OK`. The final message lists each guard (address check, column drop, send scope, transaction) and its failing test.

## Out of scope

Committing a seed file (C6). Screenshots.
