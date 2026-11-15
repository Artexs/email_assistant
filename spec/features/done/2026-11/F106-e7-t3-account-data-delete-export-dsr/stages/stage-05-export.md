# F106 stage 05 — `org:export`

Part of [`../plan.md`](../plan.md). All data of an organization leaves the server: review before the land. The only `bun.lock` change of F106.

## Step 1 — the export map and its completeness test

**Goal.** One registry says, per table and column, what the export holds.

**Files.** `modules/privacy/export-map.ts`; a unit or integration test.

**Interfaces.**

```ts
type ExportTable =
  | { export: true; via: "org_id" | "members"; columns: readonly string[]; excluded: Readonly<Record<string, string>> }
  | { export: false; reason: string };
export const EXPORT_MAP: Readonly<Record<string, ExportTable>>;
```

**Decisions.** D6, D17, S6 D14.

- Exported by `org_id`: `organizations` (by `id`) and every table with `org_id` at `HEAD` that is not in the skip list.
- `users` via `members` (users with a membership in the organization): an allow-list `id`, `email`, `display_name`, `locale`, `terms_version`, `terms_accepted_at`, `two_factor_enabled`, `created_at`; every other column is in `excluded` with the reason "not needed" or "auth".
- Not exported: `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_lockouts`, `auth_two_factors` (secrets and sessions), `mailbox_credentials` (credentials), `chat_link_tokens` (tokens), `dsr_tombstones` (hashes, no use to the controller), `schema_migrations`.
- In `org_id` tables, exclude only a column that holds a secret; name each one in the final message.

**Test.**

1. Every table of `information_schema.tables` (schema `public`) is a key of `EXPORT_MAP`, and every key is a table.
2. For each exported table, `columns ∪ keys(excluded)` equals the table's columns in `information_schema.columns`.
3. No table of the skip list is exported.

## Step 2 — the encrypted writer and the CLI

**Goal.** The operator writes one encrypted file of an organization.

**Files.** `apps/server/package.json` (`age-encryption` exact `0.3.1`), `bun.lock`; `modules/privacy/encrypted-file.ts`, `modules/privacy/export.ts`; `apps/server/src/scripts/org-export.ts`; root `package.json` script `org:export`.

**Interfaces** (stage 07 reuses the writer):

```ts
export function isAgeRecipient(value: string): boolean; // starts with "age1", parses with age-encryption
export async function writeEncryptedFile(path: string, recipient: string, chunks: AsyncIterable<string>): Promise<{ kind: "written"; bytes: number } | { kind: "exists" }>;
export async function exportOrganization(db: Db, input: { orgId: string; recipient: string; out: string; now: Date }): Promise<
  { kind: "written"; bytes: number; rows: Record<string, number> } | { kind: "not_found" } | { kind: "exists" }
>;
```

**Decisions.** D6, D14, D17.

- `writeEncryptedFile`: open `path.part` with flag `wx` (create only) and mode `0o600`; stream `chunks` through `Encrypter.encrypt(ReadableStream)` (plan F3); at the end `link(path.part, path)` then `unlink(path.part)`, so an existing `path` is never replaced (`EEXIST` → `exists`, part removed). Any error removes `path.part` and rethrows. No plain text on disk (review 1, N11).
- `exportOrganization`: one `REPEATABLE READ READ ONLY` transaction; tables in `EXPORT_MAP` key order; rows in batches of 500 ordered by primary key; JSON shape `{"format":"ea-org-export","version":1,"org_id":"…","exported_at":"<ISO>","tables":{"<table>":[{…},…],…}}`. `bigint` as string, dates as ISO, `jsonb` as JSON. After the file is complete: one audit row `org.exported`, actor `cli`, data `tables` and `rows` (two totals).
- CLI `bun run org:export --org-id <uuid> --recipient <age1…> --out <path>`: bad recipient or missing argument → usage, exit 2; `not_found` or `exists` → event `org_export_refused` with `reason`, exit 1; success → stdout `exported <org id>: <bytes> bytes` and one line `<table> <n>` per table, exit 0.
- `--recipient` takes one public key. No passphrase mode (Q5).

**Test** (integration; decrypt with a `generateX25519Identity` test identity):

1. Seed org A (two members, a mailbox with credentials, mail, triage, an action, an outbox row, a chat link, an unused chat link token, a reset token) and org B. Export A: the file decrypts; `tables` holds every exported table of `EXPORT_MAP`; row counts equal the seed; no row of B.
2. The decrypted text holds no `auth_accounts.password` value of the seed, no `encrypted_secret` value, no session token, no chat link token hash, no `auth_verifications` identifier.
3. File mode `600`; no `.part` file left.
4. A second run with the same `--out` → exit 1 `exists`; the first file is unchanged.
5. A chunk source that throws after one table leaves no file, no `.part`, no audit row.
6. One `org.exported` row, actor `cli`, data `tables` and `rows` as numbers.
7. Stdout and log hold no address or mail text.

**Check.** `bun test` on the new test files.

**Done when.** Tests pass, `bun.lock` changes only by `age-encryption` and its dependencies, and the plan Proof (server chain) prints `PROOF_OK`.

**Out of scope.** The runbook text (stage 10); the VPS folder (stage 12).
