# F106 stage 08 — `org:dsr --erase`

Part of [`../plan.md`](../plan.md). `[risky]` (data delete, privacy).

## Step 1 — the erase transaction and the CLI mode

**Goal.** On the owner's instruction the operator erases one person's data: their mail goes, other rows lose the address, no rescan or backfill brings the mail back.

**Files.** `modules/privacy/`; `scripts/org-dsr.ts`; tests.

**Interfaces.**

```ts
export async function eraseSubjectData(db: Db, input: {
  orgId: string; address: string; confirm: string; credentialsKey: string;
}): Promise<
  | { kind: "erased"; counts: DsrCounts; tombstones: number }
  | { kind: "not_found" } | { kind: "own_address" } | { kind: "bad_address" } | { kind: "confirm_mismatch" }
  | { kind: "open_actions"; actionIds: string[] } | { kind: "blocked"; constraint: string }
>;
// The seam for stage 09: one step inside the erase transaction, after step 5.
export type EraseStep = (trx: Transaction<DB>, orgId: string, erased: { mailIds: string[]; earliestCreatedAt: Date | null }) => Promise<Record<string, number>>;
```

**Decisions.** D3, D10, D11, D14, D17.

One transaction, in this order:

1. Normalize `address` and `confirm`; different → `confirm_mismatch`. Lock the organization row (`not_found`).
2. Lock the organization's `mailbox_folders` rows `FOR UPDATE`, by id: sync and backfill apply chunks under this lock (plan F8); a chunk planned earlier meets the base-key tombstone.
3. `matchSubject` (stage 06) in the transaction. `ownAddress` → `own_address`. `openActions` not empty → `open_actions` with the ids; nothing changes.
4. Insert one `dsr_tombstones` row per mail that goes (`tombstoneKeyHash(dedup_key)`, `ON CONFLICT DO NOTHING`).
5. Delete the `chainActions` rows, then the `emails` rows that go (their dependent rows go by cascade, plan F2).
6. The stage 09 step (an empty step until it lands).
7. For each mention, by rule: `recipients` → remove every array element whose lower case is the address; `text` → `regexp_replace(col, addressRegex(a), '[removed]', 'gi')`; `json` → the same on `col::text`, cast back to `jsonb`; `equal` → NULL (or the column's empty value when `NOT NULL`). `list` rows never change.
   Note (stage 06 owner decision, 2026-11-14): `email_headers.from_name` is a `text` column of the map, so this scrub covers it; its CHECK is `char_length <= 200`, so cut a scrubbed value to 200 characters.
8. One audit row `dsr.erase`, actor `cli`, data `dsrAuditData` plus `tombstones`, `chain_actions` and the counts of step 6 (stage 02 keys, all flat).

- Another foreign-key error (`23503`) rolls back → `blocked` with the constraint (a bug; runbook: report it). A deadlock (`40P01`) retries once.
- A repeat run matches nothing and still writes a `dsr.erase` row (zero counts).
- Later mail from the person is processed as normal. The mailbox is not touched (P2).

**CLI.** `bun run org:dsr --org-id <uuid> --address <a> --erase --confirm <a>`. Stdout: `erased mails <n>`, `tombstones <n>`, `chain actions <n>`, one `scrubbed <table.column> <n>` per non-zero key, `kept delegates <n>`, `kept sender_rules <n>` (the owner decides), and the line `record: dsr erase <org id> <UTC date>` for the operator's restore record (stage 10). `open_actions` → `open action <id>` per id, event `org_dsr_refused` `reason: "open_actions"`, exit 1. Other refusals as in stage 07, exit 1. `--find` with `--erase` → exit 2.

**Test** (integration, seed of stage 06 tests 2–5 without the open send):

1. `erased`; the mails that go are gone with their triage results, actions, outbox rows, headers, audit rows; one tombstone each.
2. The kept mail's `to_addresses` is `["q@x.test"]`; body `"write p@x.test."` is `"write [removed]."`; `triage_results.fields` `{"to":["[removed]"]}` is valid JSON.
3. `matchSubject` afterwards: no mails, no mentions; delegates 1 and sender rules 1 (unchanged).
4. Re-import: the fake mail provider still holds the erased mails; a rescan (UIDVALIDITY changed) and a backfill store none of them, also not as `#2`; a new mail from `p@x.test` with another Message-ID is stored.
5. The open send of stage 06 test 4 → `open_actions` with its id; nothing changes.
6. `confirm: "q@x.test"` → `confirm_mismatch`.
7. A second erase → zero counts, a second `dsr.erase` row, no new tombstone.
8. A throw injected after step 5 → nothing changed, no tombstone, no audit row.
9. The chain action of stage 06 test 4 is deleted and counted; the erase is not `blocked`.
10. B's identical rows stay.
11. CLI stdout and the log hold no `p@x.test`; the `dsr.erase` data is flat and holds the hash, no address.

**Done when.** Tests 1–11 pass and the plan Proof (server chain) prints `PROOF_OK`.

**Out of scope.** Multi-mail outbox rows (stage 09); a panel page (PD-038); changing delegates or rules.
