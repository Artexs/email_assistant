# F106 stage 08 — `org:dsr --erase`

Part of [`../plan.md`](../plan.md). `[risky]` (data delete, privacy).

## Step 1 — the erase transaction and the CLI mode

**Goal.** On the owner's instruction the operator erases one person's data: their mail goes, other rows lose the address, and no rescan or backfill brings the mail back.

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
```

**Decisions.** D3, D10, D11, D14, D16, D17.

One transaction, in this order:

1. Normalize `address` and `confirm`; different → `confirm_mismatch`. Lock the organization row (`not_found`).
2. Lock every `mailbox_folders` row of the organization `FOR UPDATE`, by id. Sync applies each chunk under this lock (`lockSyncFolder`), so no chunk runs between match and commit. If backfill stores mail without it at `HEAD`, stop and ask.
3. `matchSubject` (stage 06) in the transaction. `ownAddress` → `own_address`. `openActions` not empty → `open_actions` with the ids; nothing changes.
4. Insert one `dsr_tombstones` row per mail that goes: `key_hash = tombstoneKeyHash(dedup_key)` (stage 01), `ON CONFLICT DO NOTHING`.
5. Delete those `emails` rows by id. Their triage results, feedback, actions, outbox rows, delegations, headers, flags and audit rows go by cascade (plan F2).
6. For each mention, by rule: `recipients` → remove every array element whose lower case is the address; `text` → `regexp_replace(col, addressRegex(a), '[removed]', 'gi')`; `json` → the same on `col::text`, cast back to `jsonb`; `equal` → NULL (or the column's empty value when it is `NOT NULL`). `list` rows are never changed.
7. One audit row `dsr.erase`, actor `cli`, data `{ address_hash, counts }`.

- A foreign-key error (`23503`) rolls everything back → `blocked` with the constraint name. A deadlock (`40P01`) retries the whole transaction once.
- A repeat run matches nothing and still writes a `dsr.erase` row (zero counts).
- Later mail from the person has another dedup key and is processed as normal.
- The mailbox is not touched (P2); the runbook (stage 09) says so.

**CLI.** `bun run org:dsr --org-id <uuid> --address <a> --erase --confirm <a>`. Stdout: `erased mails <n>`, `tombstones <n>`, one `scrubbed <table.column> <n>` per non-zero key, `kept delegates <n>`, `kept sender_rules <n>` (the owner decides about these). `open_actions` → stdout `open action <id>` per id, event `org_dsr_refused` `reason: "open_actions"`, exit 1. Other refusals as in stage 07, exit 1. `--find` with `--erase` → exit 2.

**Test** (integration, `privacy-dsr-erase.test.ts`, seed of stage 06 tests 2–5 without the open send):

1. Erase → `erased`; the two mails that go are gone with their triage results, actions, outbox rows, headers and audit rows; two tombstones exist.
2. The kept mail's `to_addresses` is `["q@x.test"]`; its body `"write p@x.test."` is `"write [removed]."`; `triage_results.fields` `{"to":["[removed]"]}` is valid JSON.
3. `matchSubject` afterwards: no mails, no mentions; listed delegates 1 and sender rules 1 (unchanged rows).
4. Re-import: the fake mail provider still holds the erased mails; a rescan (UIDVALIDITY changed) and a backfill store neither of them and store a new mail from `p@x.test` with another Message-ID.
5. The open send of stage 06 test 4 → `open_actions` with its id; every row is unchanged.
6. `confirm: "q@x.test"` → `confirm_mismatch`; nothing changes.
7. A second erase → `erased` with zero counts, a second `dsr.erase` row, no new tombstone.
8. A throw injected after step 5 (test hook or a failing trigger) → nothing changed, no tombstone, no audit row.
9. A kept mail's action that references an erased mail's action (`depends_on_action_id` or `reverses_action_id`, seeded by SQL) → `blocked` or a clean erase; the test pins the result and the final message reports it (plan § Not verified).
10. Organization B's identical rows are unchanged.
11. CLI stdout and the log hold no `p@x.test`; the `dsr.erase` row holds the hash and no address.

**Check.** `bun test apps/server/test/integration/privacy-dsr-erase.test.ts`.

**Done when.** Tests 1–11 pass and the plan Proof (server chain) prints `PROOF_OK`.

**Out of scope.** A panel page (PD-038: none now); changing delegates or rules.
