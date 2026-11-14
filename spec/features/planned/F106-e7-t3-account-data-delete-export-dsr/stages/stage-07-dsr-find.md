# F106 stage 07 — `org:dsr --find` and the address hash

Part of [`../plan.md`](../plan.md). `[risky]` (privacy).

## Step 1 — the find service, the hash and the CLI

**Goal.** The operator runs the dry run for one address, gets counts, and can hand an encrypted report to the owner (the controller). Nothing in the data changes; one audit row records the request.

**Files.** `modules/privacy/dsr.ts`; `platform/crypto.ts`; `apps/server/src/scripts/org-dsr.ts`; root `package.json` script `org:dsr`; tests.

**Interfaces** (stage 08 extends the CLI and reuses the counts):

```ts
export type DsrCounts = { mails: number; mentions: Record<string, number>; listed: { delegates: number; sender_rules: number }; open_actions: number };
export function dsrCounts(match: DsrMatch): DsrCounts;
export async function findSubjectData(db: Db, input: {
  orgId: string; address: string; credentialsKey: string; report?: { recipient: string; out: string };
}): Promise<
  | { kind: "found"; counts: DsrCounts; reportBytes: number | null }
  | { kind: "not_found" } | { kind: "own_address" } | { kind: "bad_address" } | { kind: "exists" }
>;
// platform/crypto.ts
export function dsrAddressHash(credentialsKeyBase64: string, address: string): string;
```

**Decisions.** D12, D13, D14, D17.

- `findSubjectData` normalizes the address (`bad_address`), checks the organization (`not_found`), runs `matchSubject` in one `REPEATABLE READ READ ONLY` transaction, refuses `ownAddress` (`own_address`, no audit row).
- `found`: one audit row `dsr.find`, actor `cli`, data `{ address_hash, counts }`. Never the address.
- **Report** (optional): `writeEncryptedFile` of stage 05 writes `{"format":"ea-dsr-report","version":1,"org_id","made_at","address","mails":[{id, mailbox_id, received_at, from_address, to_addresses, cc_addresses, subject, body_text, category}],"mentions":{"table.column":[ids]},"listed":{"delegates":[{id,name,email}],"sender_rules":[{id,kind,pattern}]},"open_actions":[ids]}`. `category` is the latest triage result. The address is in the file: the file is encrypted to the controller's key. `exists` as in stage 05; the audit row is written only after the file is complete.
- **Hash** (plan F6): HMAC-SHA256 hex of the normalized address; key = HKDF-SHA256 of the base64-decoded `CREDENTIALS_KEY`, empty salt, info `ea/dsr-address/v1`, 32 bytes. Pure function; the CLI passes the config value.
- **CLI.** `bun run org:dsr --org-id <uuid> --address <a> --find [--recipient <age1…> --out <path>]`. Stdout: `mails <n>`, one `mention <table.column> <n>` per non-zero key, `listed delegates <n>`, `listed sender_rules <n>`, `open actions <n>`, and `report <bytes> bytes` with a report. Never the address. Refusals → event `org_dsr_refused` with `reason` (`not_found`, `own_address`, `bad_address`, `exists`), exit 1. Usage errors (no mode, `--recipient` without `--out` or the reverse, bad recipient) → exit 2. Stage 08 adds `--erase`; a call with both modes is a usage error then.

**Test** (integration, `privacy-dsr-find.test.ts`, seed of stage 06 test 2–5):

1. `found` with `mails: 2`, `mentions["emails.to_addresses"]: 1`, `listed.delegates: 1`, `open_actions: 1`.
2. One `dsr.find` row: data `address_hash` is 64 hex characters and equals `dsrAddressHash(key, "p@x.test")`; the row's JSON text has no `p@x.test`.
3. `dsrAddressHash` with a fixed 32-byte test key gives one fixed value for `"p@x.test"` (pin it in the test after the first run) and another for a second key.
4. `own@x.test` → `own_address`, no audit row.
5. With a report: the file decrypts with the test identity; `mails` has the 2 ids; mode `600`; `reportBytes` equals the file size.
6. Report path exists → `exists`, no audit row, the file is unchanged.
7. CLI: exit 0 and the stdout lines of the decisions; stdout and log hold no `p@x.test`; exit 2 for `--recipient` without `--out`.
8. Every table has the same row count before and after (audit aside).

**Check.** `bun test apps/server/test/integration/privacy-dsr-find.test.ts`.

**Done when.** Tests 1–8 pass and the plan Proof (server chain) prints `PROOF_OK`.

**Out of scope.** Erase (stage 08); the security-log kind and the runbook (stage 09).
