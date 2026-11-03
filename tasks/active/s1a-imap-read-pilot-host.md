> **Status 2026-11-04 — in progress.** Done: stages 1–16, 17.2, most of 17.3. Left: 17.1 (48-hour test runs until 2026-11-05T23:17Z; the user moves one mail back to INBOX; check `~/ea-logs/rescan.log` and `audit.log`), then roadmap row, done-checklist and `git mv` to `done/`.

# S1a IMAP read + pilot host

Scope: `docs/roadmap.md` §2, row S1a. Modules: `docs/modules.md`. Needs: S0.

## Goal
The system reads the user's Interia INBOX over IMAP every 5 minutes and stores new mail, on the home VPS, with backups and a heartbeat. No LLM yet, no change to the mailbox.

## Done when
- `bun run mailbox:check` on the real Interia account prints the capabilities (IDLE, MOVE, UIDPLUS, CONDSTORE, SPECIAL-USE, keywords), the special-use folders, whether SMTP saves sent mail by itself, and whether `SEARCH HEADER` finds a custom `X-` header. The result is in `notes/`.
- `bun run mailbox:connect` stores the password encrypted; a test reads the raw DB row and finds no plain text.
- On the test mailbox: 48 hours of sync with no lost and no duplicate mail, while a timer APPENDs new synthetic mail every hour. The 48 hours include one manual move back to INBOX and one forced UIDVALIDITY rescan.
- Tests: a UIDVALIDITY change (known mail only gets its new `uid`), a mail without `Message-ID`, the same `Message-ID` with a different content hash (stored as a new mail), `UID FETCH n:*` returning a message below the cursor (ignored), a known mail that comes back to INBOX after a system move (`returned_at` set, not triaged again), a mail with the owner's `From:` (stored, not skipped), a mail with a known `X-EA-Action-Id` (skipped).
- Compose (`server` + `db`) runs on the home VPS with `restart: unless-stopped`; `db` has no public port. Docker or Podman is picked at the start; after a VPS reboot both containers run again (test once).
- The heartbeat reaches the external dead-man's-switch service; a stopped server raises its alert (test once).
- A nightly encrypted `pg_dump` is copied off the VPS; one restore test is done and logged.
- The IMAP adapter checks TLS certificates (no `rejectUnauthorized: false`).

## Plan

User steps (not done on 2026-11-03; the user does them while stages 1–15 are built): turn on "korzystam z programu pocztowego" in Interia; create a second Interia account for tests; install Docker on the home VPS.
Rules: `docs/architecture.md` §6.1 (IMAP), §8 (operations), §10 (deployment).

Stages 1–15 need no user step: they use a fake provider and a local GreenMail container. Stages 16–17 need the user steps.

### Decisions from the user (2026-11-03)

- Container runtime on the home VPS: **Docker** (not Podman). Restart after a reboot = `systemctl enable docker` + `restart: unless-stopped`.
- Interia app passwords: not known. Stage 16.3 finds out and writes the result in the note and in ADR 0010 (17.3).
- Dead-man's-switch service: **Healthchecks.io**. The code needs only the ping URL (`HEARTBEAT_URL`).
- Off-VPS backup target: **an S3-compatible bucket at Backblaze B2, copied with `rclone`**. The file is `age`-encrypted. The VPS has a bucket key that can only write.
- Step 12.4 (DB pool connection timeout, from `tasks/planned/db-pool-timeouts.md`) is part of S1a.
- `/health` per-mailbox sync data: **not in S1a**. S2 adds the "last sync older than 30 min" admin notice.
- `mailbox:connect` does **not** create the `AI/*` folders in S1a. S3 creates them before the first move.
- `mailbox:check`: **read-only on the real account; `--probe` only on the test account** (same Interia server). The note says which account ran the probe.
- Cross-tenant entry point: **`listSyncTargets(db)` in `mail/repo.ts`**, the one more exception to the `TenantContext` rule. 17.3 adds it to `docs/code-patterns.md`.

### Facts for all stages (read before each step)

- Bun 1.3.14 on the dev Mac and in CI. Docker CLI + Colima on the Mac. `age`, `rclone` and `shellcheck` are installed on the Mac (Homebrew).
- **A local Postgres listens on `127.0.0.1:5432` on the dev Mac.** The Compose `db` publishes on host port **5433**. CI uses port 5432 (service container).
- The root `.env` holds real secrets (Gemini key, DB passwords). Never print, log or commit it. To add a key, append it without printing the value, for example:
  `grep -q '^CREDENTIALS_KEY=' .env || printf 'CREDENTIALS_KEY=%s\n' "$(openssl rand -base64 32)" >> .env`.
- Packages: `@ea/server` (`apps/server`), `@ea/core` (`packages/core`), `@ea/web` (`apps/web`). Server deps now: `@google/genai`, `hono`, `imapflow` (installed 1.7.8), `kysely`, `pg`, `zod`. **Not installed yet:** `mailparser`, `html-to-text`, `nodemailer`, `croner` (and their `@types/*`). Add a dependency with `bun add <pkg> --cwd apps/server` (dev types: `bun add -d`).
- `imapflow` ships its own types (`node_modules/imapflow/lib/imap-flow.d.ts`). Confirmed in that file: `ImapFlowOptions` has `secure`, `doSTARTTLS`, `tls`, `auth: { user, pass }`, `logger: false`, `disableAutoIdle`, `connectionTimeout`; `MailboxObject.uidValidity` is `bigint`, `uidNext` is `number`, `permanentFlags?: Set<string>`; `client.capabilities: Map<string, boolean | number>`; `list()` returns `ListResponse` with `path` and `specialUse`; `search(query, { uid: true })` with `SearchObject.since` and `SearchObject.header`; `fetch(range, query, { uid: true })` and `fetchOne`; `FetchQueryObject` has `uid`, `size`, `internalDate`, `envelope`, `headers: boolean | string[]`, `source`; `append(path, content, flags?, idate?)`; `getMailboxLock(path)`; `mailboxCreate(path)`; `messageDelete(range, { uid: true })`; class `AuthenticationFailure` with `authenticationFailed: true`.
- Code patterns (from `CLAUDE.md` and `docs/code-patterns.md`): TypeScript strict; `const` / `let` only; template literals, never `+` for strings; `createLog("<module>")` from `platform/log`, never `console.log`; no mail bodies, passwords or keys in logs or error messages; a module exposes one `index.ts` and other modules import only from it; only `mail/imap/` imports `imapflow`, `mailparser`, `nodemailer`; `packages/core` has no I/O.
- Repository pattern (copy `apps/server/src/modules/tenancy/repo.ts`): `export async function name(db: Db | Transaction<DB>, ctx: TenantContext, input): Promise<...>`, one query per function, snake_case columns, filter by `org_id = ctx.orgId`.
- Service transaction pattern (copy `tenancy/service.ts`): `return db.isTransaction ? run(db) : db.transaction().execute(run);` so tests can pass a rollback transaction.
- CLI script pattern (copy `apps/server/src/scripts/org-create.ts`): `parseArgs` with `strict: true`, `loadConfig()`, `createDb`, `assertAppRole`, exit code 0 / 1, usage text on bad args, `log` util only, `db.destroy()` in `finally`.
- Tests: unit tests `*.test.ts` next to the code (`bun run test:unit` = `bun test packages/core apps/server/src`). Integration tests in `apps/server/test/integration/*.test.ts` (`bun run test:int` = `bun test apps/server/test`). Helpers: `testDb()` and `withRollback(db, fn)` in `apps/server/test/integration/helpers.ts`. Bun runs only files that match `*.test.*`, `*_test.*`, `*.spec.*`; a helper file such as `test/contract/mail-provider.ts` is not run by itself.
- Migrations: new file `db/migrations/YYYYMMDDHHMMSS_<name>.sql` with `-- migrate:up` / `-- migrate:down`; `bun run db:migrate` as `migrator`; then `bun run db:types` (never edit `platform/db/schema.ts` by hand). The default privileges (`20261103000001_app_grants.sql`) give `app` SELECT, INSERT, UPDATE, DELETE on new tables.
- `kysely-codegen` maps Postgres `bigint` to the `Int8` type (`string` on select). Convert with `Number(...)` in the repository. IMAP UIDs and UIDVALIDITY are 32-bit unsigned, so they need `bigint` columns and fit in a JS number.
- After each stage, these must pass: `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test:unit`, `bun run test:int` (Compose `db` up and migrated; from stage 8 also the GreenMail container up: `bun run dev:up`).

### Stage 1 — Credential encryption and config key [risky]
- [x] **1.1 `platform/crypto` (AES-256-GCM) and `CREDENTIALS_KEY`**
  - Goal: The server can encrypt and decrypt a mailbox secret with a key from env, and the start stops when the key is missing or bad.
  - Files: `apps/server/src/platform/crypto.ts` (new), `apps/server/src/platform/crypto.test.ts` (new), `apps/server/src/platform/config.ts`, `apps/server/src/platform/config.test.ts`, `.env.example`, `.github/workflows/ci.yml`, root `.env` (append the key without printing it, see Facts).
  - Interfaces:
    - `export interface EncryptedSecret { ciphertext: string; keyVersion: number }`
    - `export interface SecretBox { encrypt(plain: string, aad: string): EncryptedSecret; decrypt(secret: EncryptedSecret, aad: string): string }`
    - `export class CryptoError extends Error` (name `"CryptoError"`).
    - `export function createSecretBox(keyBase64: string, keyVersion: number): SecretBox`
    - Config schema: `CREDENTIALS_KEY: z.string()` with a refine: valid base64 (`/^[A-Za-z0-9+/]+={0,2}$/`) that decodes to exactly 32 bytes; `CREDENTIALS_KEY_VERSION: z.coerce.number().int().positive().default(1)`.
    - `.env.example`: `# 32 random bytes, base64: openssl rand -base64 32. Store a copy in a password manager: key loss = all mailboxes connect again.` then `CREDENTIALS_KEY=###` and `CREDENTIALS_KEY_VERSION=1`.
    - CI: a step before the tests: `run: echo "CREDENTIALS_KEY=$(openssl rand -base64 32)" >> "$GITHUB_ENV"` (no key in the YAML).
  - Decisions: ADR 0009: AES-256-GCM in the server, key `CREDENTIALS_KEY` from env with a key version; the secret is decrypted only in memory; it never goes to logs. Format of `ciphertext`: base64 of `iv (12 random bytes, new per call) || auth tag (16 bytes) || encrypted bytes`. The `aad` string binds the ciphertext to its row; callers pass `mailbox:<mailboxId>`. `decrypt` throws `CryptoError` on a key version that is not the configured one, on a bad tag, on a wrong `aad`, or on bad base64. Error messages never contain the plain text or the key. Only one key version is active in S1a (no rotation code).
  - Test: `crypto.test.ts`: round trip; two `encrypt` calls of the same text give different `ciphertext`; wrong `aad` throws `CryptoError`; one changed byte throws; another key throws; another `keyVersion` throws; the `ciphertext` does not contain the plain text or `Buffer.from(plain).toString("base64")`; a 16-byte key throws `CryptoError` at `createSecretBox`; the error message does not contain the plain text. `config.test.ts`: `fullEnv` gets a valid test key (build it in the test with `randomBytes(32).toString("base64")`); a missing key and a 16-byte key give `ConfigError` with `CREDENTIALS_KEY` in `keys`; the message has no key value; `CREDENTIALS_KEY_VERSION` defaults to 1.
  - Check: `bun run test:unit`, `bun run typecheck`, `bun run lint`, `bun run test:int` (the `org:create` CLI test loads the root `.env`, so the key must be there).
  - Done when: all tests pass; `grep -n CREDENTIALS_KEY .env.example` shows the placeholder; CI YAML has no key value.
  - Out of scope: DB tables, key rotation, any caller of the box.

### Stage 2 — Mail tables migration [risky]
- [x] **2.1 Migration for `mailboxes`, `mailbox_credentials`, `mailbox_settings`, `emails`; generated types**
  - Goal: The S1a tables exist with tenant-safe keys, and Kysely types are generated.
  - Files: `db/migrations/20261103100001_mail.sql` (new), `apps/server/src/platform/db/schema.ts` (generated by `bun run db:types`), `apps/server/test/integration/mail-schema.test.ts` (new).
  - Interfaces (SQL, all in `-- migrate:up`; `-- migrate:down` drops the four tables in reverse order):
    - `mailboxes`: `id uuid PK DEFAULT gen_random_uuid()`, `org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, `protocol text NOT NULL DEFAULT 'imap' CHECK (protocol IN ('imap'))`, `address text NOT NULL CHECK (length(address) > 0)`, `imap_host text NOT NULL`, `imap_port integer NOT NULL CHECK (imap_port BETWEEN 1 AND 65535)`, `smtp_host text NOT NULL`, `smtp_port integer NOT NULL CHECK (smtp_port BETWEEN 1 AND 65535)`, `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','auth_error','paused'))`, `uidvalidity bigint`, `last_uid bigint`, `last_synced_at timestamptz`, `capabilities jsonb NOT NULL DEFAULT '{}'`, `folder_map jsonb NOT NULL DEFAULT '{}'`, `created_at timestamptz NOT NULL DEFAULT now()`. `UNIQUE (id, org_id)` (target of the composite keys). `CREATE UNIQUE INDEX mailboxes_org_address_key ON mailboxes (org_id, lower(address))`.
    - `mailbox_credentials`: `mailbox_id uuid PRIMARY KEY`, `org_id uuid NOT NULL`, `FOREIGN KEY (mailbox_id, org_id) REFERENCES mailboxes (id, org_id) ON DELETE CASCADE`, `encrypted_secret text NOT NULL`, `secret_kind text NOT NULL CHECK (secret_kind IN ('password','app_password'))`, `key_version integer NOT NULL CHECK (key_version > 0)`, `created_at timestamptz NOT NULL DEFAULT now()`.
    - `mailbox_settings`: `mailbox_id uuid PRIMARY KEY`, `org_id uuid NOT NULL`, same composite FK with cascade, `mode text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow','assist'))`, `tool_switches jsonb NOT NULL DEFAULT '{}'`, `category_policy jsonb NOT NULL DEFAULT '{}'`, `updated_at timestamptz NOT NULL DEFAULT now()`.
    - `emails`: `id uuid PK DEFAULT gen_random_uuid()`, `org_id uuid NOT NULL`, `mailbox_id uuid NOT NULL`, composite FK `(mailbox_id, org_id) → mailboxes (id, org_id) ON DELETE CASCADE`, `dedup_key text NOT NULL`, `message_id_header text`, `content_hash text NOT NULL`, `uid bigint NOT NULL`, `folder text NOT NULL DEFAULT 'INBOX'`, `returned_at timestamptz`, `thread_key text NOT NULL`, `in_reply_to text`, `references_header text`, `from_address text`, `to_addresses text[] NOT NULL DEFAULT '{}'`, `cc_addresses text[] NOT NULL DEFAULT '{}'`, `subject text`, `received_at timestamptz NOT NULL`, `body_text text`, `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','triaged','done','skipped'))`, `skip_reason text`, `attempts integer NOT NULL DEFAULT 0`, `next_attempt_at timestamptz`, `locked_at timestamptz`, `created_at timestamptz NOT NULL DEFAULT now()`. `UNIQUE (mailbox_id, dedup_key)`. Indexes: `emails_mailbox_message_id_idx ON emails (mailbox_id, message_id_header)`, `emails_mailbox_hash_idx ON emails (mailbox_id, content_hash)`, `emails_org_id_idx ON emails (org_id)`.
  - Decisions: Columns from `docs/architecture.md` §5 (table rows marked S1a). Every domain table has `org_id`. The composite FK makes a row with a mailbox of another organization impossible. Column names avoid SQL reserved words. `tool_switches = {}` and `category_policy = {}` mean "all switches OFF, no automatic moves" (`docs/modules.md` §3.3: new mailbox = mode `shadow`, all automatic moves off). Status values from `docs/architecture.md` §4.6. Never edit an applied migration.
  - Test: `mail-schema.test.ts` (as `app`, in `withRollback`): insert an org + mailbox + email works; an email with the `mailbox_id` of org A and the `org_id` of org B fails with FK error code `23503`; a second email with the same `(mailbox_id, dedup_key)` fails with `23505`; the same `dedup_key` in another mailbox works; `status = 'x'` fails with `23514`; a mailbox with the same address in other case in the same org fails with `23505`; deleting the mailbox deletes its emails, credentials and settings. Use `savepoint` / `rollback to savepoint` around each expected error (see `tenancy.test.ts`).
  - Check: `bun run db:migrate`, `bun run db:rollback`, `bun run db:migrate` (all exit 0); `bun run db:types`; `bun run test:int`; `bun run typecheck`; `bun run lint`.
  - Done when: `schema.ts` has `Mailboxes`, `MailboxCredentials`, `MailboxSettings`, `Emails` and no `schema_migrations`; all tests pass.
  - Out of scope: S1b tables (`actions`, `triage_*`, `audit_log`, `sender_rules`); repository code.

### Stage 3 — Mail port, typed errors, fake provider, contract suite
- [x] **3.1 Typed errors, `MailProvider` port, seed message renderer**
  - Goal: The `mail` module has its read-side port, its message types and a pure MIME renderer for synthetic mail.
  - Files: `apps/server/src/platform/errors.ts` (new), `apps/server/src/modules/mail/port.ts` (new), `apps/server/src/modules/mail/seed.ts` (new), `apps/server/src/modules/mail/seed.test.ts` (new), `apps/server/src/modules/mail/index.ts` (new).
  - Interfaces:
    - `errors.ts`: `export class SoftError extends Error` and `export class HardError extends Error`, both `constructor(message: string, options?: { cause?: unknown })`, `name` set to the class name.
    - `port.ts`:
      ```ts
      export const INBOX = "INBOX";
      export interface MailCapabilities { idle: boolean; move: boolean; uidplus: boolean; condstore: boolean; specialUse: boolean; keywords: boolean }
      export interface MailFolder { path: string; specialUse: string | null }   // specialUse like "\\Drafts"
      export interface MailServerInfo { capabilities: MailCapabilities; folders: MailFolder[] }
      export interface InboxStatus { uidValidity: number; uidNext: number }
      export interface MessageMeta {
        uid: number; size: number; internalDate: Date; date: Date | null;
        messageId: string | null; inReplyTo: string | null; references: string[];
        from: string | null; to: string[]; cc: string[]; subject: string | null;
        actionId: string | null;   // header X-EA-Action-Id
      }
      export interface MailProvider {
        serverInfo(): Promise<MailServerInfo>;
        inboxStatus(): Promise<InboxStatus>;
        fetchAbove(lastUid: number): Promise<MessageMeta[]>;   // UID FETCH lastUid+1:* in INBOX; can also return uid <= lastUid (RFC 3501 `*` rule)
        searchInboxSince(since: Date): Promise<number[]>;     // UIDs in INBOX with INTERNALDATE on or after the day of `since`
        fetchByUids(uids: number[]): Promise<MessageMeta[]>;   // INBOX
        fetchBodyText(uid: number): Promise<string | null>;   // INBOX; null when larger than the size limit or no text
        findByMessageId(folder: string, messageId: string): Promise<number | null>;  // null also when the folder does not exist
        close(): Promise<void>;
      }
      export class MailAuthError extends HardError {}
      ```
    - `seed.ts` (pure): `export interface SeedMessage { messageId?: string; from: string; to: string[]; cc?: string[]; subject: string; date: Date; text?: string; html?: string; inReplyTo?: string; references?: string[]; headers?: Record<string, string> }` and `export function renderSeedMessage(msg: SeedMessage): string` (RFC 5322 text with CRLF line ends; `MIME-Version: 1.0`; `Content-Type: text/plain; charset=utf-8` or `text/html` when only `html`, or `multipart/alternative` with a fixed boundary when both; `Date` in RFC 2822 form via `toUTCString()`; no `Message-ID` line when `messageId` is missing; extra headers after the standard ones; header values must not contain CR or LF: throw `Error` if they do).
    - `index.ts`: re-export the public types from `port.ts` and `seed.ts`.
  - Decisions: Port shape from `docs/modules.md` §3.2, read part only: S1a reads and does not change the mailbox, so `move`, `setFlags`, `appendDraft`, `send`, `ensureFolders` are not in the port yet (S3/S4 add them). Soft errors = timeout, 429, 503, lost connection; hard errors = the rest (`docs/code-patterns.md`). Login failure is `MailAuthError` (the job sets the mailbox to `auth_error`, `docs/architecture.md` §8).
  - Test: `seed.test.ts`: plain text message has `Message-ID`, `From`, `To`, `Subject`, `Date` headers and CRLF ends; no `messageId` → no `Message-ID` line; html-only → `text/html`; both → `multipart/alternative` with two parts; a header value with `\n` throws.
  - Check: `bun run test:unit`, `bun run typecheck`, `bun run lint`.
  - Done when: tests pass; nothing outside `mail/` imports `mail/port.ts` directly.
  - Out of scope: IMAP code, DB code.
- [x] **3.2 Fake provider and the shared contract suite**
  - Goal: An in-memory `MailProvider` exists for tests, and one contract suite checks it (stage 9 runs the same suite on the IMAP adapter).
  - Files: `apps/server/src/modules/mail/fake/index.ts` (new), `apps/server/src/modules/mail/fake/fake.test.ts` (new), `apps/server/test/contract/mail-provider.ts` (new, not a `*.test.ts` file).
  - Interfaces:
    - `fake/index.ts`:
      ```ts
      export interface FakeMailProvider extends MailProvider {
        deliver(folder: string, msg: SeedMessage, opts?: { internalDate?: Date; size?: number }): number;  // returns the new uid; creates the folder
        userMove(fromFolder: string, uid: number, toFolder: string): number;  // returns the new uid in toFolder
        remove(folder: string, uid: number): void;
        resetUidValidity(next: number): void;   // INBOX: new UIDVALIDITY, uids renumbered from 1 in the old order
        failOn(method: keyof MailProvider, error: Error, times?: number): void;  // the next call(s) throw
        readonly calls: string[];   // method names in call order
        closed: boolean;
      }
      export function createFakeMailProvider(opts?: { uidValidity?: number; capabilities?: Partial<MailCapabilities>; bodyLimitBytes?: number; starQuirk?: boolean }): FakeMailProvider
      ```
      `size` defaults to `Buffer.byteLength(renderSeedMessage(msg))`; `internalDate` defaults to `new Date()`. Per folder: `uidValidity`, `uidNext` (starts at 1), messages. `fetchAbove(n)` returns messages with `uid > n`; when there is none and `starQuirk` (default `true`) and the folder is not empty, it returns the message with the highest uid (RFC 3501). `searchInboxSince(d)` compares the UTC day of `internalDate` with the UTC day of `d` (IMAP SINCE is by day). `fetchBodyText` returns `text`, else `html` with tags removed, and `null` when `size > bodyLimitBytes` (default 5_000_000). `findByMessageId` returns the uid or `null`.
    - `test/contract/mail-provider.ts`:
      ```ts
      export interface ContractEnv { provider: MailProvider; seed(folder: string, msg: SeedMessage): Promise<void>; cleanup(): Promise<void> }
      export function describeMailProviderContract(name: string, makeEnv: () => Promise<ContractEnv>): void
      ```
      Cases (each with a fresh env): `inboxStatus` gives a positive `uidValidity` and `uidNext`; after 3 seeded mails `fetchAbove(0)` returns 3 metas in ascending uid order with the right `messageId`, `from`, `to`, `subject`, `references`, `inReplyTo` and `actionId` (one mail seeded with header `X-EA-Action-Id: act-1`); `fetchAbove(maxUid)` returns no uid above `maxUid` (it may return `maxUid`); `fetchByUids` returns the asked uids; `searchInboxSince(yesterday)` contains all seeded uids; `fetchBodyText` of a text mail contains its text; of an html-only mail contains the visible text and no `<p>`; a mail without `messageId` gives `messageId: null`; `findByMessageId("Archive-test", id)` finds a mail seeded into that folder and returns `null` for an unknown id and for a folder that does not exist; `serverInfo().folders` contains `INBOX`.
  - Decisions: `docs/code-patterns.md`: the fake and the real adapter pass the same contract suite. The fake mimics the RFC 3501 `n:*` rule so that the sync test of stage 6 can show that the sync ignores the message below the cursor.
  - Test: `fake.test.ts` calls `describeMailProviderContract("fake", ...)` (seed = `deliver`), plus fake-only cases: `userMove` gives a new uid in the target folder and removes the source; `resetUidValidity` renumbers; `failOn` throws once; the star quirk on and off.
  - Check: `bun run test:unit`, `bun run typecheck`, `bun run lint`.
  - Done when: the contract suite passes on the fake.
  - Out of scope: IMAP adapter; DB.

### Stage 4 — Pure sync rules: dedup key, content hash, thread key, decisions [risky]
- [x] **4.1 `mail/sync-rules.ts`**
  - Goal: All dedup and "is this mail new" rules are pure functions with unit tests.
  - Files: `apps/server/src/modules/mail/sync-rules.ts` (new), `apps/server/src/modules/mail/sync-rules.test.ts` (new).
  - Interfaces:
    ```ts
    export function normalizeMessageId(raw: string | null | undefined): string | null;   // trim; "" → null; keep the angle brackets
    export function contentHash(meta: Pick<MessageMeta, "from" | "date" | "internalDate" | "size">): string;
    export function baseDedupKey(messageId: string | null, hash: string): string;
    export function copyDedupKey(base: string, n: number): string;     // n = 1 → base; n >= 2 → `${base}#${n}`
    export function threadKey(meta: Pick<MessageMeta, "references" | "inReplyTo" | "messageId">, fallback: string): string;
    export function filterAboveCursor(metas: MessageMeta[], lastUid: number): { kept: MessageMeta[]; ignored: number };
    export interface KnownCopy { id: string; dedupKey: string; folder: string }
    export type IncomingDecision =
      | { kind: "update_uid"; emailId: string }
      | { kind: "check_folder"; emailId: string; folder: string }
      | { kind: "new"; dedupKey: string };
    export function decideIncoming(input: { baseKey: string; copies: KnownCopy[]; matched: ReadonlySet<string> }): IncomingDecision;
    export type FolderCheckResult = { kind: "returned"; emailId: string } | { kind: "new"; dedupKey: string };
    export function resolveFolderCheck(input: { emailId: string; stillInFolder: boolean; baseKey: string; copyCount: number }): FolderCheckResult;
    ```
  - Decisions (`docs/architecture.md` §6.1, written out):
    - `contentHash` = SHA-256 hex (`node:crypto`) of `${from.trim().toLowerCase() or ""}\n${date ISO or internalDate ISO}\n${size}`. Use `internalDate` when `date` is `null` or an invalid date. (Hash of the From address, the Date header, else INTERNALDATE, and RFC822.SIZE.)
    - `baseDedupKey` = `mid:${messageId}:${hash}` when there is a Message-ID, else `hash:${hash}`. The same Message-ID with a different hash is a new mail (a different key).
    - A second identical copy gets `#2`, a third `#3` (`copyDedupKey`).
    - `threadKey` = first entry of `references`, else `inReplyTo`, else `messageId`, else `fallback` (the caller passes the dedup key).
    - `filterAboveCursor`: keep only `uid > lastUid` (trap: `UID FETCH n:*` also returns the highest message when its uid is below n), drop repeated uids, sort ascending; `ignored` = count of dropped metas.
    - `decideIncoming` (`copies` = DB rows with the same Message-ID and hash; sort them by copy number: base first, then `#2`, `#3` …; `matched` = email ids that this sync run already used):
      1. The first copy with `folder = "INBOX"` that is not in `matched` → `update_uid` ("If `emails.folder` = INBOX, update `uid` silently").
      2. Else the first copy with another folder that is not in `matched` → `check_folder` (the system moved it; the caller searches that folder by Message-ID).
      3. Else → `new` with `copyDedupKey(baseKey, copies.length + 1)` (or `baseKey` when there are no copies).
    - `resolveFolderCheck`: still in its folder → `new` with `copyDedupKey(baseKey, copyCount + 1)` (a second identical copy: store and triage it); gone → `returned` (the user moved it back: the caller sets `returned_at` and `folder = INBOX`).
    - A known mail is never triaged again: `update_uid` and `returned` never change `status`.
  - Test: `sync-rules.test.ts`: hash is stable and changes with each of from / date / size; `From` in other case gives the same hash; `date: null` uses `internalDate`; invalid date uses `internalDate`; no Message-ID → `hash:` key; same Message-ID + other hash → other key; `copyDedupKey` 1/2/3; `threadKey` order (references, in-reply-to, own id, fallback); `filterAboveCursor([uid 7], 9)` → kept `[]`, ignored 1; repeated uids dropped; `decideIncoming` cases: no copies → `new` base; one INBOX copy → `update_uid`; INBOX copy already matched → `new #2`; copy in `AI/Info` → `check_folder`; copies base(INBOX, matched) + `#2`(AI/Info) → `check_folder #2`; sorting `#10` after `#2`; `resolveFolderCheck` both outcomes.
  - Check: `bun run test:unit`, `bun run typecheck`, `bun run lint`.
  - Done when: all cases pass.
  - Out of scope: DB and provider calls; the X-EA-Action-Id check (stage 6, it needs a DB lookup).

### Stage 5 — Mail and config repositories, tenant filter tests [risky]
- [x] **5.1 `mail/repo.ts`, `config` module, `org_id` filter tests**
  - Goal: Typed repository functions for the S1a tables exist, and a test shows each one filters by `org_id`.
  - Files: `apps/server/src/modules/mail/repo.ts` (new), `apps/server/src/modules/config/repo.ts` (new), `apps/server/src/modules/config/index.ts` (new), `apps/server/test/integration/fixtures.ts` (new), `apps/server/test/integration/mail-repo.test.ts` (new), `apps/server/src/modules/mail/index.ts` (export the row types only).
  - Interfaces (`type DbOrTrx = Db | Transaction<DB>`; `Cursor = { uidValidity: number | null; lastUid: number | null }`):
    - `export type MailboxRow` = mailbox row with `uidvalidity` and `last_uid` as `number | null` (convert from `Int8`), `capabilities` typed as `MailCapabilities | Record<string, never>`, `folder_map` as `Record<string, string>`.
    - `insertMailbox(db, ctx, input: { id: string; address: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; capabilities: MailCapabilities; folderMap: Record<string, string> }): Promise<void>`
    - `getMailbox(db, ctx, mailboxId): Promise<MailboxRow | undefined>`
    - `lockMailbox(trx: Transaction<DB>, ctx, mailboxId): Promise<MailboxRow | undefined>` (`FOR UPDATE`)
    - `updateCursor(db, ctx, mailboxId, expected: Cursor, next: Cursor): Promise<boolean>` — conditional update: `WHERE org_id AND id AND uidvalidity IS NOT DISTINCT FROM expected.uidValidity AND last_uid IS NOT DISTINCT FROM expected.lastUid`; returns `true` when 1 row changed.
    - `markSynced(db, ctx, mailboxId, at: Date): Promise<void>`; `setMailboxStatus(db, ctx, mailboxId, status: "active" | "auth_error" | "paused"): Promise<void>`
    - `insertCredentials(db, ctx, input: { mailboxId: string; encryptedSecret: string; secretKind: "password" | "app_password"; keyVersion: number }): Promise<void>`; `getCredentials(db, ctx, mailboxId): Promise<{ encrypted_secret: string; secret_kind: string; key_version: number } | undefined>`
    - `findCopies(db, ctx, mailboxId, key: { messageId: string | null; contentHash: string }): Promise<KnownCopy[]>` — `message_id_header = messageId` (or `IS NULL` when `null`) and `content_hash = contentHash`.
    - `export interface NewEmail` (all `emails` insert columns except `id`, `org_id`, `status`, `attempts`, `created_at`); `insertEmail(db, ctx, row: NewEmail): Promise<boolean>` — `ON CONFLICT (mailbox_id, dedup_key) DO NOTHING`, returns `true` when a row was inserted. `org_id` comes from `ctx`, never from `row`.
    - `updateEmailUid(db, ctx, emailId, uid: number): Promise<void>`; `markEmailReturned(db, ctx, emailId, uid: number, at: Date): Promise<void>` (sets `returned_at = at`, `folder = 'INBOX'`, `uid`).
    - System function (user decision 2026-11-03): `listSyncTargets(db: DbOrTrx): Promise<{ orgId: string; mailboxId: string }[]>` — all mailboxes with `status = 'active'`. Comment above it: `// Scheduler entry point: lists work across tenants, so it takes no TenantContext. Callers build a TenantContext from orgId for every later call.`
    - `config/repo.ts`: `insertDefaultSettings(db, ctx, mailboxId): Promise<void>` (uses the column defaults); `getMailboxSettings(db, ctx, mailboxId)`. `config/index.ts` exports both.
    - `fixtures.ts`: `createOrgWithMailbox(trx, opts?: { address?: string }): Promise<{ orgId: string; userId: string; mailboxId: string }>` (uses `createOrganizationWithOwner` and `insertMailbox` with test capabilities).
  - Decisions: `docs/code-patterns.md`: every repository function takes a `TenantContext` and filters by `org_id`; a test checks each new function for the filter; only `insertOrganization`, `insertUser` and `listSyncTargets` (user decision 2026-11-03) take none. The `mail` module owns `mailboxes`, `mailbox_credentials`, `emails`; the `config` module owns `mailbox_settings` (`docs/modules.md` §3.2, §3.3). Conditional updates guard state changes. Repository functions do not log.
  - Test: `mail-repo.test.ts` (in `withRollback`, two orgs A and B each with a mailbox): for each read function, the context of B gets nothing for A's ids; for each update function, the context of B changes 0 rows of A (check A's row is unchanged); `insertEmail` with ctx B and A's `mailbox_id` fails with `23503`; `insertEmail` twice with the same key returns `true` then `false`; `updateCursor` with a wrong `expected` returns `false` and changes nothing; `findCopies` with `messageId: null` finds only rows with no Message-ID; `listSyncTargets` lists active mailboxes of both orgs and not a `paused` one; `getMailboxSettings` after `insertDefaultSettings` gives `mode = 'shadow'`, `{}`, `{}`.
  - Check: `bun run test:int`, `bun run typecheck`, `bun run lint`.
  - Done when: every exported repository function has an `org_id` filter test.
  - Out of scope: services, provider calls, CLI.

### Stage 6 — Incremental sync [risky]
- [x] **6.1 `syncMailbox` for a mailbox with a cursor**
  - Goal: A sync run stores each new INBOX mail exactly once, updates known mail without a new triage, and moves the cursor only with the stored rows.
  - Files: `apps/server/src/modules/mail/sync.ts` (new), `apps/server/test/integration/mail-sync.test.ts` (new), `apps/server/src/modules/mail/index.ts` (export `syncMailbox`, `SyncResult`, `SyncDeps`).
  - Interfaces:
    ```ts
    export interface SyncDeps {
      db: Db | Transaction<DB>;
      provider: MailProvider;
      isOwnActionId(ctx: TenantContext, mailboxId: string, actionId: string): Promise<boolean>;
      now(): Date;
      chunkSize?: number;   // default 50
    }
    export interface SyncResult { mode: "initial" | "incremental" | "rescan"; fetched: number; stored: number; uidUpdated: number; returned: number; skippedOwn: number; ignoredBelowCursor: number }
    export class CursorMovedError extends SoftError {}
    export async function syncMailbox(deps: SyncDeps, ctx: TenantContext, mailboxId: string): Promise<SyncResult>
    ```
  - Decisions:
    - In this stage `syncMailbox` handles only a mailbox whose `uidvalidity` equals `inboxStatus().uidValidity` (incremental). For `uidvalidity = null` or a different value it throws `HardError("initial sync and rescan come in stage 7")`; stage 7 replaces this.
    - Flow: `getMailbox` → `inboxStatus()` → `fetchAbove(last_uid ?? 0)` → `filterAboveCursor` → chunks of `chunkSize` in uid order. `matched` (a `Set<string>`) lives for the whole run.
    - Per chunk, phase 1 (no DB writes): for each meta, in this order:
      1. `actionId` set and `isOwnActionId(...)` is `true` → skip (count `skippedOwn`). This is the only skip reason: the owner's address in `From:` is **not** a reason to skip.
      2. `messageId = normalizeMessageId(meta.messageId)`, `hash = contentHash(meta)`, `baseKey`, `copies = findCopies(...)`, `decideIncoming(...)`.
      3. `check_folder`: when `messageId` is `null` → treat as returned (the system cannot search a folder without a Message-ID); else `provider.findByMessageId(folder, messageId)` and `resolveFolderCheck`.
      4. For `new`: `body = provider.fetchBodyText(uid)`.
      5. Add the used email id (`update_uid`, `check_folder`) to `matched`.
    - Per chunk, phase 2 (one transaction, service pattern): `lockMailbox`; when its cursor differs from the cursor read at the start → throw `CursorMovedError` (another run moved it). Then apply: `insertEmail` (status `pending`, `folder = 'INBOX'`, `received_at = internalDate`, `thread_key = threadKey(meta, dedupKey)`, `references_header = references.join(" ")`, `from_address`, `to_addresses`, `cc_addresses`, `subject`, `in_reply_to`, `body_text`), `updateEmailUid`, `markEmailReturned(now())`. Then `updateCursor(expected = cursor read at start of this chunk, next = { same uidValidity, lastUid: highest uid of the chunk })`; `false` → throw `CursorMovedError`. Each chunk commits by itself, so a crash after chunk k keeps chunks 1…k and the next run starts after them.
    - `body_text` is cut to 100_000 characters. No subject, address or body in any log line; log counts only (`[mail]` prefix).
    - Wiring for S1a: the job (stage 12) passes `isOwnActionId = async () => false`, because the `actions` table comes in S1b. The test passes a stub.
    - `markSynced` is not called here (the job calls it, stage 12).
  - Test: `mail-sync.test.ts` (fake provider + `withRollback`, mailbox cursor set to the fake's uidValidity and `last_uid = 0` by `updateCursor`). Cases (the done-when list):
    - `UID FETCH n:*` returns a message below the cursor (fake star quirk, no new mail) → `ignoredBelowCursor = 1`, no new row, cursor unchanged.
    - A mail without `Message-ID` → stored with a `hash:` key; a second sync stores nothing new.
    - Same `Message-ID`, different content hash (other size) → two rows.
    - A known mail that comes back to INBOX after a system move: store mail, set its row `folder = 'AI/Info'` by SQL, `userMove` it in the fake from INBOX to `AI/Info` and back to INBOX → next sync sets `returned_at`, `folder = 'INBOX'`, the new `uid`, and `status` stays `pending` (no new row).
    - The same, but the mail is still in `AI/Info` (fake: `deliver` a second identical copy into INBOX) → a new row with `#2`.
    - A mail with the owner's address in `From:` → stored.
    - A mail with a known `X-EA-Action-Id` (stub returns `true` for `act-1`) → not stored, `skippedOwn = 1`, the cursor still moves past it.
    - Exactly once: two syncs in a row store each mail once; 120 mails with `chunkSize = 50` → 3 chunks, 120 rows, cursor = highest uid.
    - Crash: `failOn("fetchBodyText", new SoftError("x"), 1)` in the second chunk → the run rejects; rows of chunk 1 stay; cursor = highest uid of chunk 1; the next run stores the rest; no duplicates.
    - Cursor guard: change the cursor by SQL between two chunks (use a provider wrapper that runs the SQL on its second `fetchBodyText`) → `CursorMovedError`.
  - Check: `bun run test:int`, `bun run test:unit`, `bun run typecheck`, `bun run lint`.
  - Done when: all cases pass.
  - Out of scope: initial sync, UIDVALIDITY rescan, auth errors, the scheduler, IMAP.

### Stage 7 — First sync and UIDVALIDITY rescan [risky]
- [x] **7.1 `syncMailbox` modes `initial` and `rescan`**
  - Goal: A new mailbox stores only the last 24 hours of INBOX mail, and a UIDVALIDITY change rescans 7 days without duplicates.
  - Files: `apps/server/src/modules/mail/sync.ts`, `apps/server/test/integration/mail-sync.test.ts`.
  - Interfaces: no new exports. Internal: `selectMode(mailbox, status): "initial" | "incremental" | "rescan"`.
  - Decisions (`docs/architecture.md` §6.1):
    - `initial` when `mailbox.uidvalidity` is `null`: `uids = searchInboxSince(now − 24 h)`, `metas = fetchByUids(uids)`, keep only `internalDate >= now − 24 h` (SINCE is by day), sort by uid.
    - `rescan` when `mailbox.uidvalidity !== status.uidValidity`: the same with 7 days. The dedup key stops duplicates; known mail only gets its new `uid` (`update_uid`). Mail older than 7 days in INBOX is not read again.
    - Both modes use the same chunk phases as stage 6, but phase 2 does **not** move the cursor per chunk. After the last chunk, one more transaction sets the cursor: `updateCursor(expected = cursor read at start, next = { uidValidity: status.uidValidity, lastUid: max(status.uidNext − 1, highest stored uid) })`. A crash in the middle keeps the old cursor, so the next run does the same scan again, and the dedup key stops duplicates.
    - An empty INBOX: the cursor becomes `{ status.uidValidity, status.uidNext − 1 }`.
    - Remove the stage 6 `HardError` placeholder.
  - Test (add to `mail-sync.test.ts`): first sync with mails at now − 2 h, now − 23 h, now − 25 h, now − 3 days → 2 rows; cursor set; a new mail after that is stored by the next (incremental) sync. UIDVALIDITY change: 3 known mails, `resetUidValidity`, one new mail → one new row, 3 rows have the new uids, `status` of known rows unchanged, `mode = "rescan"`. A crash in the middle of a rescan (`failOn("fetchBodyText")` on the new mail) → the old `uidvalidity` stays; the next run finishes with no duplicate. A mail 8 days old in INBOX during a rescan → not stored. After an outage (50 mails above the cursor, `chunkSize = 20`) → all 50 stored.
  - Check: `bun run test:int`, `bun run typecheck`, `bun run lint`.
  - Done when: all stage 6 and stage 7 cases pass.
  - Out of scope: IMAP, scheduler, the `mailbox:rescan` CLI (stage 13).

### Stage 8 — Dev Compose split, GreenMail test server, CI service
- [x] **8.1 `compose.dev.yaml` with the db port and GreenMail**
  - Goal: The base Compose file has no host port, and dev runs the db port and a local IMAP/SMTP test server from a second file.
  - Files: `deploy/compose.yaml`, `deploy/compose.dev.yaml` (new), root `package.json` (scripts), `README.md` (dev commands, if it names `db:up`).
  - Interfaces:
    - `deploy/compose.yaml`: remove the `ports` block of `db`. Add `restart: unless-stopped` to `db`.
    - `deploy/compose.dev.yaml`: `services.db.ports: ["127.0.0.1:5433:5432"]`; `services.greenmail`: `image: greenmail/standalone:2.1.15`, `environment: GREENMAIL_OPTS: "-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled -Dgreenmail.verbose=false"`, `ports: ["127.0.0.1:3025:3025", "127.0.0.1:3143:3143", "127.0.0.1:3993:3993"]`.
    - Root scripts: `db:up` = `docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml --env-file .env up -d --wait db`; new `dev:up` = the same with `db greenmail`; `db:down` = `docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml --env-file .env down`.
  - Decisions: `docs/architecture.md` §10: on the VPS, `db` has no public port. §9: CI runs the IMAP adapter against a local mail-server container (GreenMail). GreenMail test ports: SMTP 3025, IMAP 3143, IMAPS 3993 (https://hub.docker.com/r/greenmail/standalone/). GreenMail has UIDPLUS, IDLE and MOVE (https://github.com/greenmail-mail-test/greenmail/blob/master/greenmail-core/src/main/java/com/icegreen/greenmail/imap/commands/CapabilityCommand.java).
  - Test: none (config). The check is the commands.
  - Check: `docker compose -f deploy/compose.yaml --env-file .env config | grep -c published` → `0`; `bun run dev:up` exits 0; `nc -z 127.0.0.1 3143` and `nc -z 127.0.0.1 5433` succeed; `bun run test:int` passes.
  - Done when: the checks pass.
  - Out of scope: the `server` service (stage 14).
- [x] **8.2 GreenMail in CI and test env keys**
  - Goal: CI has a GreenMail service, and the tests find it through env.
  - Files: `.github/workflows/ci.yml`, `.env.example`.
  - Interfaces: CI `services.greenmail`: `image: greenmail/standalone:2.1.15`, `env: GREENMAIL_OPTS: <same as 8.1>`, `ports: ["3025:3025", "3143:3143", "3993:3993"]`. Job `env`: `TEST_IMAP_HOST: 127.0.0.1`, `TEST_IMAP_PORT: "3143"`, `TEST_IMAPS_PORT: "3993"`, `TEST_SMTP_PORT: "3025"`. `.env.example`: the same four keys with these values under a comment `# Local GreenMail test server (bun run dev:up)`.
  - Decisions: The tests read these env keys directly (test code only), with the defaults above when missing.
  - Test: none in this step (stage 9 adds the tests that use GreenMail).
  - Check: `actionlint .github/workflows/ci.yml` if installed, else review the YAML by eye; `bun run lint`.
  - Done when: the workflow has the service and the env keys.
  - Out of scope: tests.

### Stage 9 — IMAP adapter (read) with TLS checks [risky]
- [x] **9.1 `mail/imap/` client and mapper; contract suite and TLS test on GreenMail**
  - Goal: The real `MailProvider` reads INBOX over IMAP, always checks TLS certificates, and passes the same contract suite as the fake.
  - Files: `apps/server/src/modules/mail/imap/client.ts` (new), `apps/server/src/modules/mail/imap/mapper.ts` (new), `apps/server/src/modules/mail/imap/mapper.test.ts` (new), `apps/server/src/modules/mail/imap/client.test.ts` (new), `apps/server/src/modules/mail/imap/tools.ts` (new), `apps/server/test/integration/imap-contract.test.ts` (new), `apps/server/test/integration/imap-tls.test.ts` (new), `apps/server/package.json` (add `mailparser`, `html-to-text`, dev `@types/mailparser`, `@types/html-to-text`), `bun.lock`, `apps/server/src/modules/mail/index.ts` (export `openImapProvider`, `ImapConnectOptions`).
  - Interfaces:
    - `client.ts`:
      ```ts
      export interface ImapConnectOptions { host: string; port: number; user: string; password: string; secure?: boolean; bodyLimitBytes?: number; connectionTimeoutMs?: number }
      export function isLoopbackHost(host: string): boolean;   // "127.0.0.1", "localhost", "::1"
      export function imapFlowOptions(opts: ImapConnectOptions): ImapFlowOptions;   // pure, unit-tested
      export async function openImapProvider(opts: ImapConnectOptions): Promise<MailProvider>;   // connects and logs in
      ```
      `secure` default = `!isLoopbackHost(host)`. `secure: false` with a non-loopback host throws `HardError("plain IMAP is allowed only to a loopback host")`. Options: `{ host, port, secure, auth: { user, pass }, logger: false, disableAutoIdle: true, connectionTimeout: connectionTimeoutMs ?? 30_000 }`, plus `doSTARTTLS: false` only when `secure` is `false`. Never set `tls`.
      Methods: each INBOX call takes `getMailboxLock("INBOX")` and releases it in `finally`. `inboxStatus` from the opened mailbox (`Number(uidValidity)`, `uidNext`). `fetchAbove(n)`: `fetch(\`${n + 1}:*\`, query, { uid: true })`. `fetchByUids`: `fetch(uids.join(","), query, { uid: true })` (empty list → `[]` without a call). Query: `{ uid: true, size: true, internalDate: true, envelope: true, headers: ["references", "x-ea-action-id"] }`. `searchInboxSince`: `search({ since }, { uid: true })` (`false` → `[]`). `fetchBodyText`: `fetchOne(String(uid), { size: true, source: true }, { uid: true })`; size above `bodyLimitBytes` (default 5_000_000) → `null` without the source (fetch size first). `findByMessageId`: lock that folder; a missing folder → `null`; `search({ header: { "message-id": id } }, { uid: true })` → first uid or `null`. `serverInfo`: capabilities from `client.capabilities` keys `IDLE`, `MOVE`, `UIDPLUS`, `CONDSTORE`, `SPECIAL-USE`; `keywords` = INBOX `permanentFlags` has `\\*`; folders from `list()` (`path`, `specialUse ?? null`). `close()`: `logout()`, ignore errors.
      Errors: an error with `authenticationFailed === true` → `MailAuthError` (message without the password); connection errors (codes `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`, `EPIPE`, `ENOTFOUND`, or imapflow `NoConnection`) → `SoftError`; others → `HardError`. Keep the original as `cause`.
    - `mapper.ts`: `parseHeaderBlock(raw: Buffer | undefined): Map<string, string>` (lower-case names, unfolds continuation lines); `toMessageMeta(msg: FetchMessageObject): MessageMeta` (envelope `from[0].address`, `to`/`cc` addresses, `subject`, `date`, `messageId`, `inReplyTo`; `references` split on whitespace from the header block; `actionId` from `x-ea-action-id`, trimmed); `bodyTextFromSource(source: Buffer): Promise<string | null>` (`simpleParser`: `text`, else `html-to-text` of `html`; cut to 100_000 characters; parse error → `null`).
    - `tools.ts` (test and dev tools only, not on the port): `appendRaw(opts: ImapConnectOptions, folder: string, raw: string, flags?: string[]): Promise<void>` (creates the folder when missing).
  - Decisions: `docs/architecture.md` §6.1 and §7: IMAP over TLS on port 993; TLS certificates are always checked; the old code turned the check off (`rejectUnauthorized: false`) and that must never come back. Plain IMAP exists only for the local GreenMail test server on a loopback host. Only `mail/imap/` imports `imapflow`, `mailparser` (`html-to-text` is not limited). `UID FETCH n:*` filtering stays in `sync-rules` (the adapter returns what the server returns). No mail text in logs.
  - Mapper rules (coordinator, from the stage 4 review): `internalDate` is always a valid `Date` (an invalid or missing INTERNALDATE throws `HardError`); empty `In-Reply-To` / `References` / `Message-ID` headers map to `null` / `[]`, never `""`, because `threadKey` uses `??` and `contentHash` calls `toISOString()`. The mapper tests cover both.
  - NUL rule (coordinator, from the stage 6 review): Postgres `text` rejects `\u0000`, so the mapper removes NUL characters from the subject, addresses and body text. Otherwise one mail fails `insertEmail` on every run and blocks the cursor. The mapper tests cover it.
  - Test:
    - `client.test.ts`: `imapFlowOptions` for `poczta.interia.pl:993` → `secure: true`, no `tls` key, no `doSTARTTLS`; for `127.0.0.1:3143` → `secure: false`, `doSTARTTLS: false`; `secure: false` with `poczta.interia.pl` throws.
    - `mapper.test.ts`: header folding; `references` with 3 ids; `actionId` trim; html-only source → text without tags; broken source → `null`.
    - `imap-contract.test.ts`: `describeMailProviderContract("imap-greenmail", ...)` with a new random user `u-<uuid>@localhost` per env (GreenMail with auth off accepts it), `seed` = `renderSeedMessage` + `appendRaw`.
    - `imap-tls.test.ts`: `openImapProvider({ host: "127.0.0.1", port: TEST_IMAPS_PORT, secure: true, ... })` rejects (GreenMail has a self-signed certificate), and the error is not a `MailAuthError`.
  - Check: `bun run dev:up`, `bun run test:int`, `bun run test:unit`, `bun run typecheck`, `bun run lint`, and `grep -rn "rejectUnauthorized" apps/server/src` prints nothing.
  - Done when: the contract suite passes on the fake and on GreenMail; the TLS test passes; the grep is empty.
  - Out of scope: SMTP (stage 10/11), move/flag/append on the port, IDLE.

### Stage 10 — `mailbox:connect` with the encrypted password [risky]
- [x] **10.1 Connect service, SMTP login check, CLI**
  - Goal: `bun run mailbox:connect` tests the IMAP and SMTP login, stores the mailbox with its capabilities and folder map, the encrypted password and default settings, in one transaction.
  - Files: `apps/server/src/modules/mail/connect.ts` (new), `apps/server/src/modules/mail/imap/smtp.ts` (new), `apps/server/src/modules/mail/imap/smtp.test.ts` (new), `apps/server/src/scripts/mailbox-connect.ts` (new), `apps/server/test/integration/mail-connect.test.ts` (new), `apps/server/package.json` (add `nodemailer`, dev `@types/nodemailer`), `bun.lock`, root `package.json` (script `mailbox:connect` = `bun apps/server/src/scripts/mailbox-connect.ts`), `apps/server/src/modules/mail/index.ts`.
  - Interfaces:
    - `smtp.ts`: `export interface SmtpConnectOptions { host: string; port: number; user: string; password: string; secure?: boolean }`; `export function smtpTransportOptions(opts): SMTPTransport.Options` (pure: `secure` default `!isLoopbackHost(host)`; `secure: false` only for a loopback host, then `ignoreTLS: true`; never `tls`); `export async function verifySmtpLogin(opts): Promise<void>` (`createTransport(...).verify()`; auth error (`code === "EAUTH"`) → `MailAuthError`; connection errors → `SoftError`; close the transport).
    - `connect.ts`:
      ```ts
      export interface ConnectInput { address: string; password: string; secretKind: "password" | "app_password"; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }
      export interface ConnectDeps { db: Db | Transaction<DB>; secrets: SecretBox; openProvider(opts: ImapConnectOptions): Promise<MailProvider>; verifySmtp(opts: SmtpConnectOptions): Promise<void> }
      export async function connectMailbox(deps: ConnectDeps, ctx: TenantContext, input: ConnectInput): Promise<{ mailboxId: string; info: MailServerInfo }>
      export function buildFolderMap(folders: MailFolder[]): Record<string, string>
      ```
    - CLI: `bun run mailbox:connect --org-id <uuid> --address <email> [--secret-kind password|app_password (default password)] [--imap-host poczta.interia.pl] [--imap-port 993] [--smtp-host poczta.interia.pl] [--smtp-port 465]`. The password comes **only from stdin** (read all, strip one trailing `\n` / `\r\n`; empty → usage error). Usage text shows: `read -rs P && printf '%s' "$P" | bun run mailbox:connect ...`. Prints `connected mailbox <id>` and one line per capability (`MOVE=yes` …). Exit codes: 0 ok; 1 bad args, login error or other error; a unique violation prints `mailbox with this address already exists`.
  - Decisions:
    - `docs/architecture.md` §6.1 "Connect": ask for address and password (an app password if the provider has one), test the IMAP and SMTP login, read the capabilities and special-use folders, store the encrypted secret. TLS certificates are always checked. Interia: IMAP `poczta.interia.pl:993`, SMTP `poczta.interia.pl:465`, both SSL/TLS, login = the full address.
    - Order: validate input (Zod: email, ports 1–65535) → `openProvider` → `serverInfo()` → `close()` → `verifySmtp` → `mailboxId = randomUUID()` → `secrets.encrypt(password, \`mailbox:${mailboxId}\`)` → one transaction: `insertMailbox`, `insertCredentials` (`keyVersion` from the box result), `insertDefaultSettings`. A login error writes no row.
    - `buildFolderMap`: `drafts`, `sent`, `trash`, `junk` from the folders with `\\Drafts`, `\\Sent`, `\\Trash`, `\\Junk` (missing → key absent); plus `ai_spam: "AI/Spam"`, `ai_info: "AI/Info"`, `ai_notifications: "AI/Notifications"`, `ai_manual: "AI/Manual"`.
    - User decision 2026-11-03: connect does not create the `AI/*` folders in S1a (the goal says "no change to the mailbox"); S3 creates them before the first move. Do not add `ensureFolders` to the port.
    - The password never goes to logs, stdout, stderr, error messages or argv. The CLI never echoes stdin.
    - Secure flag: connect and the job use the default (`!isLoopbackHost(host)`), so no secure column is stored.
  - Test:
    - `smtp.test.ts`: options for `poczta.interia.pl:465` → `secure: true`, no `tls`; loopback → `secure: false`, `ignoreTLS: true`; `secure: false` with a public host throws.
    - `mail-connect.test.ts` (in `withRollback`, fake provider and stub `verifySmtp`): the raw row `select encrypted_secret from mailbox_credentials` does not contain the password, its base64 or its hex; `secrets.decrypt(row, \`mailbox:${id}\`)` returns the password; `capabilities` and `folder_map` are stored; `mailbox_settings.mode = 'shadow'`; `openProvider` throws `MailAuthError` → no mailbox row; `verifySmtp` throws → no row; the fake is closed after the run.
    - CLI test (same file, needs GreenMail): spawn the script with stdin = a password, `--address u-<uuid>@localhost --imap-host 127.0.0.1 --imap-port 3143 --smtp-host 127.0.0.1 --smtp-port 3025` and an org made by the test (clean up the org in `finally`, like the `org:create` CLI test) → exit 0; stdout and stderr do not contain the password; the raw DB row does not contain it. No stdin → exit 1 with `usage`.
  - Check: `bun run dev:up`, `bun run test:int`, `bun run test:unit`, `bun run typecheck`, `bun run lint`; `grep -rn "rejectUnauthorized" apps/server/src` prints nothing.
  - Done when: the tests pass; the done-when line "a test reads the raw DB row and finds no plain text" is covered.
  - Out of scope: mailbox remove / pause; web form (S5); sending mail.

### Stage 11 — `mailbox:check` with write probes [risky]
- [x] **11.1 Capability report and the two probes**
  - Goal: `bun run mailbox:check` prints the capabilities, the special-use folders and, with `--probe`, whether `SEARCH HEADER` finds a custom `X-` header and whether SMTP saves sent mail by itself.
  - Files: `apps/server/src/modules/mail/check.ts` (new), `apps/server/src/modules/mail/imap/probe.ts` (new), `apps/server/src/modules/mail/imap/smtp.ts` (add `sendProbeToSelf`), `apps/server/src/scripts/mailbox-check.ts` (new), `apps/server/test/integration/mail-check.test.ts` (new), root `package.json` (script `mailbox:check`), `apps/server/src/modules/mail/index.ts`.
  - Interfaces:
    - `probe.ts`: `probeHeaderSearch(imap: ImapConnectOptions, draftsFolder: string, opts: { uidplus: boolean }): Promise<{ found: boolean; deleted: boolean }>` — APPEND to Drafts one message with flag `\\Draft`, header `X-EA-Probe: <uuid>`, subject `EA probe <uuid>`, from and to = the mailbox address; `SEARCH HEADER X-EA-Probe <uuid>`; delete the probe only when `uidplus` is true (`messageDelete(uid, { uid: true })`), else leave it. `probeSentAutosave(imap, smtp: SmtpConnectOptions, address: string, sentFolder: string, opts: { pollMs?: number; timeoutMs?: number; searchByHeader: boolean }): Promise<{ saved: boolean }>` — `sendProbeToSelf` then search the Sent folder every `pollMs` (default 5000) up to `timeoutMs` (default 60_000) by the probe header (or by subject when `searchByHeader` is false).
    - `smtp.ts`: `sendProbeToSelf(opts: SmtpConnectOptions, input: { address: string; probeId: string }): Promise<void>` — `from = to = input.address`, header `X-EA-Probe`, subject `EA probe <probeId>`, short fixed text.
    - `check.ts`: `export interface CheckReport { capabilities: MailCapabilities; folders: MailFolder[]; searchHeader: "yes" | "no" | "skipped"; sentAutosave: "yes" | "no" | "skipped"; notes: string[] }`; `checkMailbox(deps: { db; secrets }, ctx, mailboxId: string, opts: { probe: boolean }): Promise<CheckReport>` — reads the mailbox and decrypts its password; without `probe` it is read-only.
    - CLI: `bun run mailbox:check --org-id <uuid> --mailbox-id <uuid> [--probe]`. Output lines: `capabilities: IDLE=yes MOVE=yes UIDPLUS=no CONDSTORE=yes SPECIAL-USE=yes KEYWORDS=no`; `folder <path> <specialUse or ->` per folder; `search-header: yes|no|skipped`; `smtp-saves-sent: yes|no|skipped`; then each note. Exit 0 when the report is complete.
  - Decisions:
    - Done-when: the check prints IDLE, MOVE, UIDPLUS, CONDSTORE, SPECIAL-USE, keywords (`PERMANENTFLAGS \\*`), the special-use folders, whether SMTP saves sent mail by itself, and whether `SEARCH HEADER` finds a custom `X-` header.
    - The probes change the mailbox (one draft, one mail to self). They run only with `--probe`. The SMTP probe sends **only to the mailbox's own address**; the recipient never comes from an argument. User decision 2026-11-03: `--probe` runs only on the test account; the real account gets the read-only check.
    - No `\\Drafts` folder → `search-header: skipped` with a note. No `\\Sent` folder → `smtp-saves-sent: skipped` with a note.
    - The probe never runs EXPUNGE without UIDPLUS (a plain EXPUNGE would also delete the user's own `\\Deleted` mail, `docs/architecture.md` §6.1). When it leaves a probe, it adds the note `delete the probe draft "EA probe <id>" by hand`. It always adds the note `the probe mail "EA probe <id>" is in INBOX (and Sent if saved); delete it by hand`.
  - Test: `mail-check.test.ts` (GreenMail): connect a GreenMail mailbox with `connectMailbox` (folders `Drafts` and `Sent` made with `appendRaw` first); without `--probe` no message is added to any folder; with `probe`: `capabilities.uidplus = true`, `move = true`, `idle = true` [not verified for `condstore`]; `searchHeader = "yes"`; the probe draft is deleted (UIDPLUS); the probe mail arrives in the user's INBOX; `sentAutosave = "no"` with `timeoutMs = 3000` (GreenMail does not save sent mail) [not verified]. CLI: the output has the `capabilities:` line and no password.
  - Check: `bun run dev:up`, `bun run test:int`, `bun run typecheck`, `bun run lint`.
  - Done when: the tests pass.
  - Out of scope: running the check on Interia (stage 16); the note in `notes/` (stage 16).

### Stage 12 — Scheduler, sync job, heartbeat, server wiring
- [x] **12.1 `platform/scheduler`**
  - Goal: Jobs run on a cron pattern, and one tick never overlaps the next.
  - Files: `apps/server/src/platform/scheduler.ts` (new), `apps/server/src/platform/scheduler.test.ts` (new), `apps/server/package.json` (add `croner`), `bun.lock`.
  - Interfaces: `export interface Scheduler { add(name: string, pattern: string, fn: () => Promise<void>): void; stop(): void }`; `export function createScheduler(): Scheduler` — `new Cron(pattern, { protect: true, catch: (error) => log.error(\`${name} failed:\`, message) }, fn)`; a skipped tick (protect) logs `debug`.
  - Decisions: `docs/architecture.md` §8: the scheduler runs in the server process with `croner`; one tick never overlaps the next. Error logs carry only `error.message`.
  - Test: pattern `* * * * * *` (every second) with a job that takes 1500 ms: over 3.5 s the job never runs twice at the same time (counter of running jobs ≤ 1); a throwing job does not stop the next tick; `stop()` stops all.
  - Check: `bun run test:unit`, `bun run typecheck`, `bun run lint`.
  - Done when: tests pass.
  - Out of scope: other jobs of later slices.
- [x] **12.2 `platform/heartbeat` and `HEARTBEAT_URL`**
  - Goal: The server pings the dead-man's-switch URL every 5 minutes while the DB answers.
  - Files: `apps/server/src/platform/heartbeat.ts` (new), `apps/server/src/platform/heartbeat.test.ts` (new), `apps/server/src/platform/config.ts`, `apps/server/src/platform/config.test.ts`, `.env.example`.
  - Interfaces: config `HEARTBEAT_URL`: optional URL; an empty string counts as missing (`z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional())`). `export function createHeartbeat(deps: { url: string | undefined; checkDb: () => Promise<boolean>; fetch?: typeof fetch; timeoutMs?: number }): { tick(): Promise<void> }` — no URL → `tick` does nothing (main logs one `warn` at start); DB down → no ping, `warn`; DB up → `GET url` with `AbortSignal.timeout(timeoutMs ?? 10_000)`; non-2xx or error → `warn` with the status or `error.message` only. `tick` never throws. The URL is never logged (it is a secret token for most services).
  - Decisions: `docs/architecture.md` §8: heartbeat every 5 min to an external dead-man's-switch service, outbound only; the service alerts when heartbeats stop. The service is Healthchecks.io (user decision 2026-11-03); the code needs only the ping URL and has no Healthchecks.io-specific code. `.env.example`: `# Dead-man's-switch ping URL (empty = heartbeat off)` and `HEARTBEAT_URL=`.
  - Test: a local `Bun.serve` on port 0 counts requests: DB up → 1 request; DB down → 0; server answers 500 → no throw; no URL → no request; a server that never answers with `timeoutMs = 100` → resolves within 1 s. Config: `HEARTBEAT_URL=""` → `undefined`; `"not a url"` → `ConfigError`.
  - Check: `bun run test:unit`, `bun run typecheck`, `bun run lint`.
  - Done when: tests pass.
  - Out of scope: Telegram admin notice for an old sync (S2).
- [x] **12.3 Mail sync job and `main.ts` wiring**
  - Error rule (coordinator, from the stage 10 review): nodemailer gives `ETLS` "Connection closed unexpectedly" when the server drops the TLS handshake; `smtp.ts` maps it to HardError. If the job sees SMTP errors, map this case to SoftError so one network drop does not log `error` on each tick.
  - Goal: The server syncs every active mailbox every 5 minutes, marks login errors, and sends the heartbeat.
  - Files: `apps/server/src/modules/mail/jobs.ts` (new), `apps/server/test/integration/mail-jobs.test.ts` (new), `apps/server/src/modules/mail/index.ts`, `apps/server/src/main.ts`.
  - Interfaces: `export function createMailSyncJob(deps: { db: Db | Transaction<DB>; secrets: SecretBox; openProvider(opts: ImapConnectOptions): Promise<MailProvider>; isOwnActionId: SyncDeps["isOwnActionId"]; now(): Date }): { run(): Promise<void> }`. `run`: `listSyncTargets` → for each target in turn: `ctx = { orgId }`; `getMailbox`; `getCredentials` + `decrypt` (aad `mailbox:<id>`); `openProvider({ host: imap_host, port: imap_port, user: address, password })`; `syncMailbox`; `markSynced(now())`; log one `info` line with the counts. `MailAuthError` → `setMailboxStatus("auth_error")` + `warn`; `SoftError` / `CursorMovedError` → `warn`, next tick tries again; other errors → `error`. One mailbox error never stops the others. Always `close()` the provider.
    `main.ts`: `secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION)`; `scheduler.add("mail.sync", "*/5 * * * *", job.run)`; `scheduler.add("platform.heartbeat", "*/5 * * * *", heartbeat.tick)`; call `heartbeat.tick()` once after the server starts; `isOwnActionId: async () => false` with the comment `// The actions table comes in S1b; until then no mail is the system's own.`; `shutdown` calls `scheduler.stop()` before `server.stop()`.
  - Decisions: `docs/architecture.md` §8: mail sync every 5 min per mailbox; IMAP/SMTP login error → mailbox `auth_error` (the Telegram notice comes in S2), other mailboxes continue; connection errors → backoff (here: the next tick). The job never logs a password, subject or address.
  - Test: `mail-jobs.test.ts` (in `withRollback`, fake providers keyed by address): two active mailboxes → both get rows and `last_synced_at`; `openProvider` throws `MailAuthError` for one → its status becomes `auth_error`, the other still syncs; `SoftError` → status stays `active`, `last_synced_at` unchanged; a `paused` mailbox is not opened; every opened fake is closed.
  - Check: `bun run test:int`, `bun run test:unit` (`main.test.ts` still passes), `bun run typecheck`, `bun run lint`. Manual: `bun run start` with the dev db → log lines `[main] listening`, no error; Ctrl-C exits 0.
  - Done when: tests pass and the manual start works.
  - Out of scope: `/health` per-mailbox data (user decision 2026-11-03: not in S1a); Telegram notices.
- [x] **12.4 DB pool connection timeout**
  - Goal: `checkDb` returns `false` fast when the DB host drops packets, so `/health` and the heartbeat do not hang.
  - Files: `apps/server/src/platform/db/index.ts`, `apps/server/test/integration/db-role.test.ts`, `tasks/planned/db-pool-timeouts.md` (`git mv` to `tasks/done/`, status `done`, log line).
  - Interfaces: `new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 })`.
  - Decisions: from `tasks/planned/db-pool-timeouts.md`: the `pg` `Pool` gets `connectionTimeoutMillis` (5000); a test shows `checkDb` returns `false` within the timeout against an address that does not answer.
  - Test: `checkDb(createDb(...))` on a local `Bun.listen` TCP listener (`127.0.0.1`, port 0) that accepts and never answers resolves `false` in less than 7 s. The test fails without `connectionTimeoutMillis`.
  - Check: `bun run test:int`.
  - Done when: the test passes.
  - Out of scope: statement timeouts.

### Stage 13 — Test tools for the 48-hour run
- [x] **13.1 `mailbox:seed` (APPEND synthetic mail to the test mailbox only)**
  - Goal: A script APPENDs synthetic mail into the INBOX of the test mailbox, and refuses every other mailbox.
  - Files: `apps/server/src/scripts/mailbox-seed.ts` (new), `apps/server/src/platform/config.ts` (+ test), `.env.example`, root `package.json` (script `mailbox:seed`), `apps/server/test/integration/mail-seed.test.ts` (new).
  - Interfaces: config `TEST_MAILBOX_ADDRESS`: optional email, empty = missing. CLI `bun run mailbox:seed --org-id <uuid> --mailbox-id <uuid> [--count 1]`. Each mail: `messageId = <seed-<uuid>@ea-seed.test>`, `from = seed@ea-seed.test`, `to = [mailbox address]`, `subject = EA seed <ISO time>`, short text, header `X-EA-Seed: 1`; `renderSeedMessage` + `appendRaw(…, "INBOX", raw)`. Prints `appended <n>`.
  - Decisions: `docs/architecture.md` §9: a seed script APPENDs synthetic mail into the test mailbox INBOX (APPEND does not send). It refuses (exit 1, no connection) when `TEST_MAILBOX_ADDRESS` is missing or differs from the mailbox address (case-insensitive), so it can never write into the real mailbox. `.env.example`: `# Address of the test mailbox (mailbox:seed refuses all others)` and `TEST_MAILBOX_ADDRESS=`.
  - Test (GreenMail): wrong or missing `TEST_MAILBOX_ADDRESS` → exit 1 and the INBOX stays empty; right address, `--count 3` → 3 mails in INBOX with distinct Message-IDs.
  - Check: `bun run test:int`, `bun run typecheck`, `bun run lint`.
  - Done when: tests pass.
  - Out of scope: eval cases (S1b).
- [x] **13.2 `mailbox:rescan` (force a UIDVALIDITY rescan)**
  - Goal: The operator can force the next sync to run the UIDVALIDITY rescan.
  - Files: `apps/server/src/modules/mail/repo.ts` (add `forceRescan`), `apps/server/src/scripts/mailbox-rescan.ts` (new), root `package.json` (script `mailbox:rescan`), `apps/server/test/integration/mail-repo.test.ts`, `apps/server/test/integration/mail-sync.test.ts`.
  - Interfaces: `forceRescan(db, ctx, mailboxId): Promise<boolean>` — `UPDATE mailboxes SET uidvalidity = 0 WHERE org_id AND id AND uidvalidity IS NOT NULL`. CLI `bun run mailbox:rescan --org-id <uuid> --mailbox-id <uuid>` → prints `rescan forced` or exits 1 when no row changed.
  - Decisions: done-when: the 48 hours include one forced UIDVALIDITY rescan. A real server never has UIDVALIDITY 0 (RFC 3501: non-zero), so the next sync sees a change and rescans 7 days.
  - Test: `org_id` filter test for `forceRescan`; after `forceRescan` the next `syncMailbox` has `mode = "rescan"` and stores no duplicate.
  - Check: `bun run test:int`, `bun run typecheck`, `bun run lint`.
  - Done when: tests pass.
  - Out of scope: other admin commands.
- [x] **13.3 `mailbox:audit` (no lost, no duplicate mail)**
  - Goal: A script compares the INBOX with the stored rows and reports lost and duplicate mail.
  - Files: `apps/server/src/modules/mail/audit.ts` (new), `apps/server/src/modules/mail/audit.test.ts` (new), `apps/server/src/modules/mail/repo.ts` (add `listInboxEmailKeys`), `apps/server/src/scripts/mailbox-audit.ts` (new), root `package.json` (script `mailbox:audit`), `apps/server/test/integration/mail-repo.test.ts`.
  - Interfaces: `listInboxEmailKeys(db, ctx, mailboxId, since: Date): Promise<{ message_id_header: string | null; content_hash: string }[]>` (rows with `folder = 'INBOX'` and `received_at >= since`); pure `compareInboxWithDb(inbox: { messageId: string | null; hash: string }[], rows: { messageId: string | null; hash: string }[]): { inbox: number; stored: number; missing: number; duplicates: number }` — count per `(messageId, hash)`: `missing` = sum of max(0, inbox count − stored count); `duplicates` = sum of max(0, stored count − inbox count). CLI `bun run mailbox:audit --org-id <uuid> --mailbox-id <uuid> --since <ISO time>`: reads INBOX metas (`searchInboxSince` + `fetchByUids`, keep `internalDate >= since`), computes the keys with `normalizeMessageId` and `contentHash`, prints `inbox=<n> stored=<n> missing=<n> duplicates=<n>`; exit 0 when `missing = 0` and `duplicates = 0`, else exit 2. Read-only.
  - Decisions: done-when: 48 hours with no lost and no duplicate mail. Mail that arrived in the last 5 minutes can show as missing before the next sync: run the audit right after a sync.
  - Test: `audit.test.ts`: equal sets → 0/0; one inbox mail without a row → missing 1; two rows for one inbox mail → duplicates 1; two identical inbox copies and two rows → 0/0. `org_id` filter test for `listInboxEmailKeys`.
  - Check: `bun run test:unit`, `bun run test:int`, `bun run typecheck`, `bun run lint`.
  - Done when: tests pass.
  - Out of scope: any fix of found differences.

### Stage 14 — Server image, VPS Compose, runbook
- [x] **14.1 Server Dockerfile**
  - Goal: An image of the server builds from the repo and has `bun` and `dbmate`.
  - Files: `deploy/Dockerfile` (new), `.dockerignore` (new).
  - Interfaces: `FROM oven/bun:1.3.14`; `WORKDIR /app`; copy `package.json`, `bun.lock`, `apps/server/package.json`, `apps/web/package.json`, `packages/core/package.json` to their paths; `RUN bun install --frozen-lockfile` (dev dependencies stay: `dbmate` and `kysely-codegen` are needed for `db:migrate`); copy `apps/server`, `packages/core`, `db`, `tsconfig.base.json`; `USER bun`; `EXPOSE 8080`; `CMD ["bun", "apps/server/src/main.ts"]`. `.dockerignore`: `node_modules`, `**/node_modules`, `.env`, `.env.*`, `.git`, `apps/web/dist`, `apps/web/.astro`, `tasks`, `notes`, `docs`, `.ai`.
  - Decisions: `docs/architecture.md` §9–10: `oven/bun` base; the dependency layer is cached while `bun.lock` does not change; the image is built on the VPS from the repo. No `.env` in the image.
  - Test: none (build).
  - Check: `docker build -f deploy/Dockerfile -t ea-server .` exits 0; `docker run --rm ea-server bun --version` prints `1.3.14`; `docker run --rm ea-server bunx dbmate --version` prints a version; `docker run --rm ea-server ls -a /app | grep -c '^.env$'` prints `0`.
  - Done when: the checks pass.
  - Out of scope: the web build (S5).
- [x] **14.2 `server` service in Compose**
  - Goal: Compose runs `server` and `db` with `restart: unless-stopped`, and `db` has no host port outside dev.
  - Files: `deploy/compose.yaml`.
  - Interfaces: `services.server`: `build: { context: .., dockerfile: deploy/Dockerfile }`, `image: ea-server`, `restart: unless-stopped`, `env_file: ../.env`, `environment: DATABASE_URL: postgres://app:${APP_PASSWORD:?}@db:5432/email_assistant?sslmode=disable` and `MIGRATOR_DATABASE_URL: postgres://migrator:${MIGRATOR_PASSWORD:?}@db:5432/email_assistant?sslmode=disable` (they override the dev URLs of the env file), `depends_on: { db: { condition: service_healthy } }`, `healthcheck: test: ["CMD", "bun", "-e", "const r = await fetch('http://127.0.0.1:8080/health'); process.exit(r.ok ? 0 : 1)"]`, `interval: 30s`, `retries: 3`. No `ports` (no inbound port in the pilot).
  - Decisions: `docs/architecture.md` §10: two services; `db` = `postgres:17`, named volume, no public port; `server` = an image built on the VPS from the repo, `restart: unless-stopped`, env file with mode 600; no inbound port. DB passwords must be URL-safe (the runbook says: make them with `openssl rand -hex 24`).
  - Test: none (config).
  - Check: `docker compose -f deploy/compose.yaml --env-file .env config` is valid and has no `published` port; on the Mac: `docker compose -f deploy/compose.yaml --env-file .env up -d --build --wait` exits 0 (server healthy); `docker compose -f deploy/compose.yaml --env-file .env run --rm server bun run db:migrate` exits 0; `docker compose -f deploy/compose.yaml --env-file .env logs server | grep -c listening` ≥ 1; then `docker compose -f deploy/compose.yaml --env-file .env stop server`. `bun run db:up` still works for dev.
  - Done when: the checks pass.
  - Out of scope: VPS work (stage 16).
- [x] **14.3 Runbook `deploy/README.md`**
  - Goal: A later agent or the user can install, update and test the pilot on the home VPS from one file.
  - Files: `deploy/README.md` (new).
  - Interfaces (sections): Requirements (Docker with the Compose plugin, git; `age` public recipient and `rclone` for backups); First install (clone; root `.env` from `.env.example` with `chmod 600 .env`; which keys are needed on the VPS: `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD` (URL-safe), `CREDENTIALS_KEY`, `CREDENTIALS_KEY_VERSION`, `HEARTBEAT_URL`, `TEST_MAILBOX_ADDRESS`, `LOG_LEVEL`; `DATABASE_URL` / `MIGRATOR_DATABASE_URL` are set by Compose); start `db`; migrate (`docker compose … run --rm server bun run db:migrate`); `org:create`; `mailbox:connect` with the password on stdin; start `server`); Update (`git pull`, `up -d --build`, migrate); Logs; Reboot (`sudo systemctl enable docker`; the services have `restart: unless-stopped`); Heartbeat (Healthchecks.io: make one check with period 5 min and grace 10 min, add an email or Telegram integration, put its ping URL in `HEARTBEAT_URL`; how to test a stop); The 48-hour test procedure (stage 17.1 text); Backups (stage 15 fills it).
  - Decisions: Use the commands that stages 14.1–14.2 checked. Docker only (user decision 2026-11-03): no Podman text.
  - Test: none (doc).
  - Check: every command in the file exists in `package.json` or is a `docker compose` command checked in 14.2.
  - Done when: the file exists and the main session has read it.
  - Out of scope: S5 web access.

### Stage 15 — Nightly encrypted backup and restore test [risky]
- [x] **15.1 `deploy/backup.sh`, `deploy/restore-test.sh`, schedule**
  - Goal: A nightly job writes an encrypted `pg_dump`, copies it off the VPS, and a restore script proves that a backup restores.
  - Files: `deploy/backup.sh` (new, executable), `deploy/restore-test.sh` (new, executable), `deploy/backup.env.example` (new), `.gitignore` (add `deploy/backup.env`), `deploy/README.md` (section Backups).
  - Interfaces:
    - `backup.sh` (bash, `set -euo pipefail`; reads `deploy/backup.env`): `BACKUP_DIR`, `AGE_RECIPIENT` (public key `age1…`), `BACKUP_REMOTE`, `KEEP_DAYS` (default 7), `COMPOSE` (default `docker compose`). Steps: `$COMPOSE -f deploy/compose.yaml --env-file .env exec -T db pg_dump -U postgres -d email_assistant -Fc | age -r "$AGE_RECIPIENT" -o "$BACKUP_DIR/ea-<UTC time>.dump.age.part"`; check the file is not empty; rename to `.dump.age`; copy to `BACKUP_REMOTE` with `rclone copyto <file> "$BACKUP_REMOTE/<name>"` (`BACKUP_REMOTE` = `<rclone remote>:<bucket>/<path>`, for example `b2:ea-backups/pilot`); delete local files older than `KEEP_DAYS` (the script never deletes remote files: the write-only key cannot, and remote retention is a B2 lifecycle rule on the bucket); print `backup ok <name> <bytes>`. Any failure → non-zero exit and no `.dump.age` file.
    - `restore-test.sh <backup file> <age identity file>` (runs on a machine that has the private key, for example the Mac): `age -d -i` → start a throwaway container `postgres:17` (name `ea-restore-test`, no port, random password) → `pg_restore --no-owner --no-privileges -d email_assistant` → print `select count(*)` of `organizations`, `users`, `mailboxes`, `emails` → remove the container (also on error, `trap`).
    - Schedule: a crontab line in `deploy/README.md`: `30 3 * * * cd <repo> && deploy/backup.sh >> <log> 2>&1`.
  - Decisions: `docs/architecture.md` §8 and ADR 0011: a nightly `pg_dump`, encrypted (for example with `age`), copied off the VPS; one restore test per month (S1a does one and logs it). ADR 0009: backups are encrypted too. The `age` private key never lives on the VPS; only the public recipient does. `backup.env` is not committed. Off-VPS target (user decision 2026-11-03): an S3-compatible Backblaze B2 bucket, copied with `rclone`; the VPS has a bucket key that can only write (no read, no delete), so a stolen VPS cannot read or delete old backups. The rclone config with the key lives on the VPS only (`~/.config/rclone/rclone.conf`, mode 600), never in git. `deploy/backup.env.example` shows `BACKUP_REMOTE=b2:<bucket>/pilot` and a comment that the remote is made with `rclone config`. `deploy/README.md` § Backups describes: make the bucket (private), a write-only application key limited to that bucket, a lifecycle rule for old files, `rclone config` on the VPS, the crontab line, and how the Mac gets a file for `restore-test.sh` (B2 web UI download or `rclone` with a read key on the Mac only). If `rclone copyto` fails with the write-only key because it lists or reads the destination, add `--no-check-dest` (and for the `s3` backend `--s3-no-check-bucket`) [not verified]; 17.2 checks this on the real bucket.
  - Test (on the Mac with the dev Compose db): make a key with `age-keygen -o <tmp>/key.txt`; set `BACKUP_REMOTE` to a local folder (rclone accepts a local path as the destination [not verified]; `rclone` is installed on the Mac); run `backup.sh` → one `.dump.age` file locally and in the remote folder; `head -c 21` of the file shows the `age` header, not `PGDMP`; run `restore-test.sh` → the counts equal the counts of the dev db; stop the db during a run → exit non-zero and no `.dump.age` file.
  - Check: `bash -n deploy/backup.sh deploy/restore-test.sh`; `shellcheck deploy/*.sh` prints nothing (installed on the Mac); the test above.
  - Done when: the local backup + restore round trip works.
  - Out of scope: the monthly restore schedule (manual); alerting for a failed backup (follow-up idea).

### Stage 16 — Pilot host live (user + main session)
Needs: the user steps done (Interia IMAP on, test account, Docker on the VPS). The main session does these steps with the user (SSH to the VPS). No subagent builds them. Write each result into the log.
- [x] **16.1 Deploy and reboot test**
  - Goal: `server` and `db` run on the home VPS and start again after a reboot.
  - Files: none in git (VPS `.env`, mode 600).
  - Decisions: Docker (user decision 2026-11-03); `sudo systemctl enable docker`. Follow `deploy/README.md`. `db` has no public port.
  - Test: `docker compose -f deploy/compose.yaml --env-file .env ps` shows both healthy; `ss -ltnp | grep 5432` on the VPS host shows nothing; `sudo reboot`; after the boot `ps` shows both running again without a manual command.
  - Check: the commands above; log the output.
  - Done when: both containers run after the reboot.
  - Out of scope: S5 inbound access.
- [x] **16.2 Heartbeat and stop alert**
  - Goal: The dead-man's-switch service gets the heartbeat, and a stopped server raises its alert.
  - Decisions: Healthchecks.io (user decision 2026-11-03): one check, period 5 min, grace about 10 min, an email or Telegram integration (set in the service); its ping URL goes into `HEARTBEAT_URL` in the VPS `.env`, never into git or the log.
  - Test: the service shows pings; `docker compose … stop server`; wait for the alert (email or the channel of the service); `start server`; the check goes back to up.
  - Check: log the alert time and channel.
  - Done when: one alert was received and the check recovered.
- [x] **16.3 Connect the mailboxes and run `mailbox:check`**
  - Goal: The test mailbox and the real Interia mailbox are connected on the VPS, and the capability facts are in `notes/`.
  - Files: `notes/2026-11-XX-interia-imap-capabilities.md` (new; date of the run).
  - Decisions: `org:create` for the pilot org; `mailbox:connect` for the test account and the real account (password on stdin). `mailbox:check` read-only on the real account; `--probe` only on the test account (user decision 2026-11-03). The note lists: each capability of both accounts, the special-use folders, `search-header`, `smtp-saves-sent`, whether Interia offers app passwords (not known on 2026-11-03; the user checks the Interia account settings; ADR 0010: check in S1a), the date, and that the test account ran the probe. If Interia offers app passwords, connect the real account with an app password and `--secret-kind app_password`. Delete the probe mails by hand after the run.
  - Check: the CLI output; log it (no addresses of third parties, no secrets).
  - Done when: the note exists.

### Stage 17 — 48-hour sync test, restore test, docs (user + main session)
- [ ] **17.1 48-hour sync test on the test mailbox**
  - Goal: 48 hours of sync with no lost and no duplicate mail, with hourly synthetic mail, one manual move back to INBOX and one forced rescan.
  - Decisions (procedure): start time `T0`; cron on the VPS: `0 * * * * cd <repo> && docker compose -f deploy/compose.yaml --env-file .env run --rm server bun run mailbox:seed --org-id <org> --mailbox-id <test mailbox>`. Move back (simulated system move, because shadow mode moves nothing): the user makes a folder `EA-test` in Interia webmail and moves one stored test mail from INBOX into it; the main session sets that row's `folder = 'EA-test'` (`docker compose … exec db psql -U postgres -d email_assistant -c "update emails set folder = 'EA-test' where id = '<id>'"`); the user moves the mail back to INBOX; after the next sync the row has `returned_at` set and no new row exists. Forced rescan: at about hour 24, `bun run mailbox:rescan …` in the container; the next sync log line has `sync <mailbox id> rescan:`. At the end (≥ 48 h, right after a sync): `bun run mailbox:audit … --since <T0>` → `missing=0 duplicates=0`, exit 0. Remove the cron line.
  - Check: the audit output, the `returned_at` query, the rescan log line; log all three.
  - Done when: the audit exits 0 after ≥ 48 hours and both events are logged.
- [x] **17.2 Nightly backup and one restore test**
  - Goal: The nightly backup runs on the VPS, the copy is off the VPS, and one restore test is done and logged.
  - Decisions: Backblaze B2 bucket with `rclone` and a write-only key (user decision 2026-11-03); set it up on the VPS as `deploy/README.md` § Backups says; one manual `deploy/backup.sh` run first proves that the write-only key can copy. The `age` private key stays off the VPS (password manager / the Mac); `restore-test.sh` runs on the Mac with a file fetched from the target.
  - Check: the cron log line `backup ok …` of one night; `restore-test.sh` counts equal the VPS counts at backup time; log both.
  - Done when: one restore test is logged.
- [ ] **17.3 Docs, notes, alerts, follow-ups**
  - Goal: The docs describe what S1a built, and the done-checklist is complete.
  - Files: `docs/architecture.md` (§6.1 Interia facts, §8 heartbeat service and backup target, §10 Docker decision and `compose.dev.yaml`), `docs/modules.md` (§3.2 real file list of `mail/`, port read part; §3.3 `config` repo), `docs/roadmap.md` (S1a done), `docs/code-patterns.md` (the `listSyncTargets` exception; real `platform` paths `crypto.ts`, `errors.ts`, `scheduler.ts`, `heartbeat.ts`), `docs/decisions/0010-imap-first.md` (one dated line: app password at Interia yes/no), `docs/known-alerts.md` (new alerts seen in the run), `tasks/planned/` (follow-ups), this task file (done-checklist, status).
  - Decisions: one source per fact (`tasks/README.md`). Docs describe the built state, not steps.
  - Check: `grep -rn "Docker or Podman is picked" docs` shows the decision, not the open text; `bun run lint` (Prettier on `.md` is not required, see S0 log).
  - Done when: the done-checklist is ticked and the task moves to `tasks/done/`.

## Questions for the user

None. The user answered Questions 1–8 on 2026-11-03; the answers are in "Decisions from the user (2026-11-03)" at the top of the plan.

## Not verified

- GreenMail options `-Dgreenmail.auth.disabled`, `-Dgreenmail.hostname=0.0.0.0` and that a login with auth off creates the user (stage 8, 9). Fallback: create users with `-Dgreenmail.users=<user>:<pass>@localhost`.
- GreenMail behaviour: CONDSTORE support; `UID FETCH n:*` star rule; whether imapflow finds `Drafts` / `Sent` by name without SPECIAL-USE (`specialUseSource: "name"` exists in the types); GreenMail does not save SMTP mail to Sent; its IMAPS certificate is self-signed (stage 9 TLS test, stage 11).
- imapflow: `doSTARTTLS: false` turns STARTTLS off for plain loopback; `messageDelete(..., { uid: true })` uses `UID EXPUNGE` when UIDPLUS is there; the error codes of connection errors (stage 9). Check in `node_modules/imapflow/lib/`.
- `mailparser` `simpleParser` and `html-to-text` APIs and `@types` packages; `nodemailer` `verify()` and the `EAUTH` code (stages 9–11).
- croner options `protect` and `catch`, and the seconds field in `* * * * * *` (stage 12.1). Check in `node_modules/croner` after install.
- `10.255.255.1` gives ECONNREFUSED in ~13 ms on the dev network, so the test does not use it (step 12.4).
- The `oven/bun:1.3.14` image tag; the `dbmate` npm package installs its Linux binary in the image from a `bun.lock` made on macOS (stage 14.1).
- `rclone` accepts a local path as the destination (stage 15 test); `age` header text.
- `rclone copyto` works with a B2 key that can only write, and whether it needs `--no-check-dest` (stage 15, 17.2).
- Healthchecks.io free plan, period/grace settings and email/Telegram integrations (stage 16.2); Backblaze B2 write-only application keys limited to one bucket and lifecycle rules (stages 15, 17.2).
- Interia: capabilities, `SEARCH HEADER` on `X-` headers, auto-save of sent mail, app passwords (stage 16 finds out).

## Done-checklist
- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log
- 2026-11-02: Created from the cold review (`tasks/done/mvp-plan-review.md`, findings F2, F8) and the user's answers (Interia IMAP, home VPS).
- 2026-11-03: Planner wrote the plan (17 stages; 1, 2, 4, 5, 6, 7, 9, 10, 11, 15 are `[risky]`; 16–17 are manual with the user). Open: Questions 1–8.
- 2026-11-03: User approved the plan and answered: Q1 user steps not done yet, Docker on the VPS, app passwords not known (stage 16 finds out); Q2 Healthchecks.io; Q3 Backblaze B2 + rclone, write-only key, age-encrypted file; Q4 yes (step 12.4); Q5 no; Q6 no AI/* folders in S1a; Q7 read-only check on the real account, probe on the test account; Q8 listSyncTargets in mail/repo.ts. age, rclone, shellcheck installed on the Mac. Planner updated the plan.
- 2026-11-03: Stage 1 done (1.1 crypto + CREDENTIALS_KEY). Checks: test:unit 30 pass, test:int 14 pass, lint + typecheck exit 0. Reviewer PASS (2 minor: duplicate key regex, base64 length; not fixed).
- 2026-11-03: Stage 2 done (mail tables migration). Migration 20261103100001_mail.sql (mailboxes, mailbox_credentials, mailbox_settings, emails), generated schema.ts, 6 schema tests. Checks: db:migrate/rollback/migrate exit 0; lint + typecheck exit 0; test:unit 30 pass; test:int 20 pass. Reviewer PASS.
- 2026-11-03: Stage 3 done (mail port, typed errors, fake provider, contract suite). SoftError/HardError, MailProvider port, MailAuthError, seed renderer (ASCII only), fake provider, contract suite; reviewer minors fixed (meta copies, body limit test, empty Message-ID, ASCII headers). Checks: lint + typecheck exit 0; test:unit 53 pass 0 fail. Reviewer PASS.
- 2026-11-03: Stage 4 done (pure sync rules). sync-rules.ts (Message-ID normalize, content hash, dedup keys, thread key, cursor filter, decideIncoming, resolveFolderCheck), 29 tests. Review questions decided: stage 9 mapper gives a valid internalDate and null/[] for empty headers (added to 9.1). Checks: lint + typecheck exit 0; test:unit 82 pass; test:int 20 pass. Reviewer PASS.
- 2026-11-03: Stage 5 done (mail and config repositories, tenant filter tests). mail/repo.ts (mailboxes, credentials, emails, conditional cursor update, listSyncTargets exception), config module (mailbox_settings), test fixtures, 14 org_id filter tests. Checks: lint + typecheck exit 0; test:unit 82 pass; test:int 34 pass. Reviewer PASS.
- 2026-11-03: Stage 6 done (incremental sync). syncMailbox with a cursor: plan phase outside the transaction, one transaction per chunk, guarded cursor, CursorMovedError. Accepted deviations: same-run copies get #2, thread_key uses the normalized Message-ID. Review minors fixed (tests, references_header null, per-chunk commit test); NUL rule added to 9.1. Checks: lint + typecheck exit 0; test:unit 82 pass; test:int 53 pass. Reviewer PASS.
- 2026-11-03: Stage 7 done (first sync and UIDVALIDITY rescan). Modes initial (24 h) and rescan (7 days), cursor set once after the last chunk. Accepted deviations: lastUid = max(uidNext-1, highest scanned uid); no fetch for an empty search. Review minors fixed: SINCE one day earlier, tests for mail that arrives during the scan. S1b input added to tasks/planned/s1b-shadow-triage.md (old uids after a rescan). Checks: lint + typecheck exit 0; test:unit 82 pass; test:int 62 pass. Reviewer PASS.
- 2026-11-03: Stage 8 done (dev Compose split, GreenMail, CI service). compose.yaml without db port + restart unless-stopped; compose.dev.yaml (db 127.0.0.1:5433, GreenMail 2.1.15); dev:up; CI greenmail service and TEST_* env; README. Checks: base compose publishes 0 ports; dev:up healthy; lint + typecheck exit 0; test:unit 82 pass; test:int 62 pass. Reviewer PASS.
- 2026-11-03: Stage 9 done (IMAP adapter (read) with TLS checks). mail/imap client, mapper, tools; contract suite passes on GreenMail; self-signed IMAPS cert is rejected; no rejectUnauthorized. Accepted deviations: TLS test host localhost (imapflow IP servername bug under Bun, see notes/2026-11-03-imapflow-tls-under-bun.md), LIST check before 'mail gone', empty INBOX gives []. Checks: lint + typecheck exit 0; test:unit 109 pass; test:int 75 pass. Reviewer PASS.
- 2026-11-03: Stage 10 done (mailbox:connect with the encrypted password). connectMailbox (IMAP + SMTP login check, AES-GCM secret with aad mailbox:<id>, default settings), SMTP adapter (nodemailer 10.3.1), CLI with password on stdin only. Tests read the raw row: no plain text, base64 or hex of the password. Accepted deviations: no @types/nodemailer, html5 email pattern. SMTP TLS facts appended to notes/2026-11-03-imapflow-tls-under-bun.md. Checks: lint + typecheck exit 0; test:unit 117 pass; test:int 84 pass. Reviewer PASS.
- 2026-11-03: Stage 11 done (mailbox:check with write probes). checkMailbox read-only report + --probe (SEARCH HEADER draft, Sent auto-save via mail to self); delete only with UIDPLUS; probe failures name 'EA probe <id>' for cleanup; tests prove the user's own \\Deleted mail survives. GreenMail facts in notes/2026-11-03-greenmail-facts.md. Checks: lint + typecheck exit 0; test:unit 117 pass; test:int 94 pass. Reviewer PASS.
- 2026-11-03: Stage 12 done (scheduler, sync job, heartbeat, server wiring). croner scheduler (protect, no overlap), heartbeat (HEARTBEAT_URL, never logged, never throws), mail sync job (one mailbox error never stops others, provider always closed), main.ts wiring, pg connectionTimeoutMillis 5000 (db-pool-timeouts moved to done). Two FAIL rounds on test strength (silent-DB timeout test, mailbox order in the login-error test), both fixed; user said go. Manual start: /health ok, db up, heartbeat-off warn. Checks: lint + typecheck exit 0; test:unit 129 pass; test:int 99 pass. Reviewer PASS.
- 2026-11-03: Stage 13 done (test tools for the 48-hour run). mailbox:seed (refuses any mailbox that is not TEST_MAILBOX_ADDRESS, before credentials), mailbox:rescan (forceRescan), mailbox:audit (missing/duplicates multiset, shared fetchSince with the one-day SINCE shift). Review minors fixed. Checks: lint + typecheck exit 0; test:unit 135 pass; test:int 106 pass. Reviewer PASS.
- 2026-11-03: Stage 14 done (server image, VPS Compose, runbook). deploy/Dockerfile (oven/bun:1.3.14, USER bun, no .env), .dockerignore, server service (no ports, unless-stopped, healthcheck /health), deploy/README.md runbook. FAIL round 1 fixed (Update migrates from a rebuilt image: run --build; nested .env ignore; read -rsp + unset P; cron log), round 2 minors fixed (real sync log format, bash note). Follow-up: tasks/planned/server-env-scope.md. Checks: docker build ok; prod compose: 0 published ports, db + server healthy, migrate exit 0; lint exit 0; test:unit 135 pass; test:int 106 pass. Reviewer PASS.
- 2026-11-03: Stage 15 done (nightly encrypted backup and restore test). deploy/backup.sh (pg_dump -Fc piped to age, PGDMP check, copy to rclone remote then rename, local retention, absolute BACKUP_DIR), deploy/restore-test.sh (throwaway postgres:17, --network none, counts), backup.env.example, README Backups with cron PATH. Reviewer tested counts 2/3/1/57 restored and all failure paths leave no .dump.age. Coordinator re-ran backup + restore on the dev db: exit 0 both. Checks: shellcheck exit 0; lint exit 0; test:unit 135 pass; test:int 106 pass. Reviewer PASS.
- 2026-11-03: Stage 16 (live, main session + user). One Interia account only (user decision): `TEST_MAILBOX_ADDRESS` = the pilot address, probe ran on it. VPS facts: `notes/2026-11-03-pilot-vps.md`.
  16.1: `ps` after `sudo reboot`: `email-assistant-server-1 Up 23 minutes (healthy)`, `email-assistant-db-1 Up 23 minutes (healthy)`; host listens only on 22.
  16.2: `HEARTBEAT_URL` set (Healthchecks.io, period 5 min, grace 10 min, email); the user confirmed pings and the alert during the reboot.
  16.3: org `Pilot` created; mailbox connected with the normal password (app passwords not checked). First sync failed (`bigint "NaN"`: no UIDNEXT on SELECT); fixed in 2 commits (STATUS / highest UID fallback). `initial: fetched 2, stored 0, uid updated 2`. Capabilities and probe: `notes/2026-11-03-interia-imap-capabilities.md`. Found: `SEARCH HEADER Message-ID` finds nothing at Interia; S3 input written.
- 2026-11-03: 17.1 started. T0 = 2026-11-03T23:12:42Z, first seed `appended 1`, next sync stored it once. Cron: hourly seed, one rescan `5 11 4 11 *`, `~/ea-48h-end.sh` at `17 23 5 11 *` (audit, then removes the test lines). Row `f4d83c99-…` (the first seed mail) set to `folder = 'EA-test'`; the user makes the move to `EA-test` and back.
- 2026-11-03: 17.2 done. rclone 1.75.2 in `~/bin` (apt 1.53 fails); `backup.sh` now uses `copyto --no-check-dest` (write-only key gave 401). `backup ok ea-20261103T231230Z.dump.age 21042`; nightly cron 03:30. Restore test on the Mac (`restore-test.sh`, key `~/.config/ea-backup/age-key.txt`): organizations 1, users 1, mailboxes 1, emails 2 = VPS counts at backup time.
- 2026-11-04: 17.3 docs: architecture §6.1/§8/§10, modules §3.2/§3.3, code-patterns, ADR 0010 line, known-alerts (NaN, 401), deploy README (rclone), S3 input. Roadmap and done-checklist after 17.1.
