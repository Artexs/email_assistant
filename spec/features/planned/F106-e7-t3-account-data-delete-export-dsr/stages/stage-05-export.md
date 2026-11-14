# F106 stage 05 — `org:export`

Part of [`../plan.md`](../plan.md). All data of an organization leaves the server: review before the land. The only `bun.lock` change of F106.

## Step 1 — the export map and its completeness test

**Goal.** One registry says, per table and column, whether the export holds it.

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
- `users` via `members` (users with a membership in the organization), columns `id`, `email`, `display_name`, `locale`, `terms_version`, `terms_accepted_at`, `two_factor_enabled`, `created_at`; every other column excluded with a reason.
- Not exported: `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_lockouts`, `auth_two_factors` (secrets and sessions), `mailbox_credentials` (credentials), `chat_link_tokens` (tokens), `dsr_tombstones` (hashes, no use to the controller), `schema_migrations`.
- Excluded columns: only a column that holds a secret; a worker who finds one at `HEAD` excludes it with the reason and names it in the final message.

**Test.**

1. Every table of `information_schema.tables` (schema `public`) is a key of `EXPORT_MAP`, and every key is a table.
2. For each exported table, `columns ∪ keys(excluded)` equals the table's columns in `information_schema.columns`.
3. No table of the skip list is exported.

## Step 2 — the encrypted writer and the CLI

**Goal.** The operator writes one encrypted file with an organization's data.

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

- `writeEncryptedFile`: `path` or `path.part` exists → `exists`; write `path.part` with mode `0o600` from the first byte, streaming `chunks` through `Encrypter.encrypt(ReadableStream)` (plan F3); rename to `path` at the end; any error removes `path.part` and rethrows. No plain text on disk.
- `exportOrganization`: one `REPEATABLE READ READ ONLY` transaction; tables in `EXPORT_MAP` key order; rows in batches of 500 ordered by primary key; JSON shape `{"format":"ea-org-export","version":1,"org_id":"…","exported_at":"<ISO>","tables":{"<table>":[{…},…],…}}`. `bigint` as string, dates as ISO, `jsonb` as JSON. After the file is renamed: one audit row `org.exported`, actor `cli`, data `{ tables, rows }` (counts only).
- CLI `bun run org:export --org-id <uuid> --recipient <age1…> --out <path>`: bad recipient or missing argument → usage, exit 2; `not_found` or `exists` → event `org_export_refused` with `reason`, exit 1; success → stdout `exported <org id>: <bytes> bytes` and one line `<table> <n>` per table, exit 0.
- `--recipient` takes one public key. No passphrase mode (Q5).

**Test** (integration; decrypt with a `generateX25519Identity` test identity):

1. Seed org A (two members, a mailbox with credentials, mail, triage, an action, an outbox row, a chat link, an unused chat link token, a reset token) and org B. Export A: the file decrypts; `tables` holds every exported table of `EXPORT_MAP`; row counts equal the seed; no row of B.
2. The decrypted text holds no `auth_accounts.password` value of the seed, no `encrypted_secret` value, no session token, no chat link token hash, no `auth_verifications` identifier.
3. The file mode is `600`; no `.part` file is left.
4. A second run with the same `--out` → exit 1 `exists`; the first file is unchanged.
5. A chunk source that throws after one table leaves no file, no `.part`, no audit row.
6. One `org.exported` row with `{ tables, rows }` and actor `cli`.
7. Stdout and the log hold no address or mail text of the seed.

**Check.** `bun test` on the new test files.

**Done when.** Tests pass, `bun.lock` changes only by `age-encryption` and its dependencies, and the plan Proof (server chain) prints `PROOF_OK`.

**Out of scope.** The runbook text (stage 09); the VPS folder (stage 11).
