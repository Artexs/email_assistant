# test-mail-traffic — Stage 3

Part of [`../test-mail-traffic.md`](../test-mail-traffic.md). Read that file's "Facts checked", "Design decisions" (D3, D13, D15) and "Edge cases" first.

## Stage 3 — AgentMail client, fake server, config keys [risky]

Why risky: security (the API key) and sending to people (the send call). The client is the only code that talks to AgentMail.

- [x] **3.1 Config keys and the AgentMail client**
  - Goal: a small typed REST client over `fetch` for the 5 calls the tool needs, with typed errors that never hold the key or mail text.
  - Files: create `apps/server/src/modules/testmail/agentmail/client.ts`, `apps/server/src/modules/testmail/index.ts`; change `apps/server/src/platform/config.ts`
    (add `testmailConfigSchema`, `loadTestmailConfig`), `apps/server/src/platform/config.test.ts`, `.env.example`.
  - Interfaces:

    ```ts
    // platform/config.ts
    export const testmailConfigSchema = z.object({
      // Secret: never print or log it.
      AGENTMAIL_API_KEY: z.preprocess(emptyAsUndefined, z.string().min(10)),
      AGENTMAIL_BASE_URL: z.preprocess(emptyAsUndefined, z.string().url().default("https://api.agentmail.to/v0")),
      TEST_MAILBOX_ADDRESS: /* the same preprocess + regex as baseSchema, optional */,
    });
    export type TestmailConfig = z.infer<typeof testmailConfigSchema>;
    export function loadTestmailConfig(env?: Record<string, string | undefined>): TestmailConfig; // throws ConfigError(keys) like loadConfig

    // modules/testmail/agentmail/client.ts
    export interface AgentMailInbox { inboxId: string; email: string; displayName: string | null; status: string | null; statusUntil: string | null }
    export interface AgentMailSent { messageId: string; threadId: string }
    export interface AgentMailMessageItem { messageId: string; threadId: string; labels: string[]; timestamp: string }
    export class AgentMailError extends Error {
      // name "AgentMailError"; message `AgentMail <op> failed: HTTP <status> <name|-> <code|->`; never the response `message`, never request data
      constructor(readonly op: string, readonly status: number, readonly errorName: string | null, readonly code: string | null, readonly retryAfterSec: number | null);
    }
    export interface AgentMailClient {
      ensureInbox(input: { username: string; clientId: string; displayName: string }): Promise<AgentMailInbox>; // POST /inboxes (idempotent by client_id)
      getInbox(inboxId: string): Promise<AgentMailInbox>;                                                       // GET /inboxes/{id}
      setDisplayName(inboxId: string, displayName: string): Promise<AgentMailInbox>;                            // PATCH /inboxes/{id}
      send(inboxId: string, request: AgentMailSendRequest, idempotencyKey: string): Promise<AgentMailSent>;     // POST /inboxes/{id}/messages/send
      listByLabel(inboxId: string, label: string): Promise<AgentMailMessageItem[]>;                             // GET /inboxes/{id}/messages?labels=<label>&limit=20
    }
    export function createAgentMailClient(opts: { apiKey: string; baseUrl: string; timeoutMs?: number; fetch?: typeof fetch }): AgentMailClient;
    ```

  - Decisions:
    - Every request: `Authorization: Bearer <key>`, `Content-Type: application/json` for bodies, `AbortSignal.timeout(timeoutMs ?? 30_000)`. Path segments go through
      `encodeURIComponent` (the inbox id is an address with `@`). `send` adds the header `Idempotency-Key`.
    - The client does no retry and no sleep; it maps the outcome to errors (stage 4 decides the retry):
      - 2xx → parse with a Zod schema of the documented fields (`message_id`, `thread_id`; `inbox_id`, `email`, `display_name`, `status`, `status_until`;
        `messages[].{message_id, thread_id, labels, timestamp}`); a parse failure → `HardError("AgentMail <op>: unexpected response")`.
      - non-2xx → `AgentMailError` with `status`, `errorName` (= body `name` when it is a string ≤ 60 characters of `[A-Za-z]`), `code` (= body `code` when it matches
        `^[a-z_]{1,40}$`), `retryAfterSec` (= header `Retry-After` as an integer 0–3600, else null). The body `message`, `fix` and `errors` are dropped.
      - timeout, DNS or connection error → `SoftError("AgentMail <op>: network error")` with the original as `cause` (never put `cause` in a log line; use `describeError`).
      - 2xx but the body cannot be read (connection lost during the body) → `SoftError("AgentMail <op>: network error")`: for `send` the mail may be out, and a repeat
        with the same key is safe (D3). 2xx with a readable body that fails the schema → `HardError` (above).
    - Helpers next to the class: `isSoftAgentMailError(e)` = status 429, 5xx, or 409 with `errorName !== "IdempotencyKeyConflictError"`;
      `isIdempotencyConflict(e)` = 409 with `errorName === "IdempotencyKeyConflictError"`.
    - `listByLabel` passes `labels=<label>` once (the documented list form), reads the first page (20 items) and returns only the items whose `labels` array really
      contains `label` (a guard in case the server ignores the filter); the caller wants 0 or 1 match.
    - `.env.example` gets, after `TEST_MAILBOX_ADDRESS`: a comment `# Test tool only (bun run testmail:*): AgentMail key. Secret.`, `AGENTMAIL_API_KEY=` and
      `# AGENTMAIL_BASE_URL=https://api.agentmail.to/v0`.
    - `loadConfig()` and the server start do not change: the server never needs these keys.
  - Test (`apps/server/src/modules/testmail/agentmail/client.test.ts`, with an injected `fetch` that records each `Request`; the fake server is step 3.2):
    1. `send` builds `POST <base>/inboxes/ea-x%40agentmail.to/messages/send` with headers `Authorization: Bearer k-test-1234567890`, `Idempotency-Key`, and the JSON body of
       the request unchanged; the 200 body `{message_id, thread_id}` maps to `{ messageId, threadId }`.
    2. A 409 body `{name: "IdempotencyKeyConflictError", code: "conflict", message: "secret-looking text"}` → `AgentMailError` with `errorName`, `code`, status 409;
       `isIdempotencyConflict` true, `isSoftAgentMailError` false; `String(error)` and `error.message` do not contain `secret-looking text` nor the key.
    3. 429 with `Retry-After: 2` → `retryAfterSec` 2, soft; `Retry-After: abc` → null.
    4. 503 → soft; 400 → not soft; 401 → not soft.
    5. `fetch` rejects with `TypeError("fetch failed")` → `SoftError`, message `AgentMail send: network error`.
    6. A 200 with `{}` for `send` → `HardError` `unexpected response`.
    7. `loadTestmailConfig({})` throws `ConfigError` with `AGENTMAIL_API_KEY`; with the key only → base URL default; `loadConfig` of an env without the AgentMail keys still works (existing tests stay green).
    8. No test output contains the key: the tests use a fake key `k-test-1234567890` and assert it never appears in any error message.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: tests 1–8 pass; `.env.example` lists the keys.
  - Out of scope: retries, logging, the send loop (stage 4).

- [ ] **3.2 AgentMail fake server**
  - Goal: a local HTTP fake of the 5 calls for unit and integration tests, with the probe-verified idempotency rules (Facts checked).
  - Files: create `apps/server/src/modules/testmail/agentmail/fake.ts`, `apps/server/src/modules/testmail/agentmail/fake.test.ts`; change `apps/server/src/modules/testmail/index.ts` (no export of the fake from `index.ts`: tests import the file directly).
  - Interfaces:

    ```ts
    export interface FakeAgentMail {
      baseUrl: string; // http://127.0.0.1:<port>/v0
      readonly sent: {
        inboxId: string;
        key: string;
        body: AgentMailSendRequest;
        displayName: string;
        messageId: string;
      }[]; // real sends only (no idempotent replays)
      readonly requests: { method: string; path: string; authorization: string | null }[];
      failNext(
        op: "send" | "patch" | "list" | "create" | "get",
        response: { status: number; body?: unknown; headers?: Record<string, string> },
        times?: number
      ): void;
      holdResponseNext(op: "send", holdMs: number): void; // performs and stores the send at once, then waits holdMs before it answers (the provider accepted the mail, the client timed out)
      stop(): Promise<void>;
    }
    export function startFakeAgentMail(opts: { apiKey: string; now?: () => Date }): Promise<FakeAgentMail>; // Bun.serve on port 0
    ```

  - Decisions:
    - Auth: a wrong or missing Bearer key → 401 `{name: "UnauthorizedError"}` for every route.
    - `POST /v0/inboxes`: same `client_id` → the same inbox; a new one → `inbox_id = email = <username>@agentmail.to`, `display_name` as given.
    - `PATCH /v0/inboxes/{id}` sets `display_name`; `GET` returns the inbox with `status_until` `2026-12-07T14:40:11.000Z`. `GET`, `PATCH` and `send` of an
      unknown inbox → 404 `{name: "NotFoundError"}` (stage 4.2 `setup` and `send` depend on it).
    - `POST …/messages/send`: no `Idempotency-Key` → 400 (the client must always send one); key seen with a byte-equal body and the same inbox → 200 with the first
      `message_id`, no new entry in `sent`; key seen with another body → 409 `{name: "IdempotencyKeyConflictError", code: "conflict"}`; else a new
      `message_id` `<fake-<n>@email.amazonses.test>` and `thread_id` `t-<n>`, and the message is stored with its labels and the inbox's current display name.
      Key expiry is not simulated (a test that needs an expired key uses a new fake instance).
    - `GET …/messages?labels=x` → `{count, messages}` with the stored messages of that inbox that have label `x`, newest first.
    - `failNext` returns the given response instead of the normal handling, for the next `times` calls (default 1) of that op.
  - Test (`fake.test.ts`, using the real client from 3.1 against the fake):
    1. create twice with the same `client_id` → same `inboxId`; `requests` shows two calls.
    2. send with key `k1` twice (same body) → same `messageId`, `sent.length` 1; with `k1` and another subject → `isIdempotencyConflict`.
    3. send without a key (raw fetch) → 400.
    4. `listByLabel` finds the message by its case label; an unknown label → `[]`.
    5. `failNext("send", {status: 429, headers: {"Retry-After": "1"}})` → the client throws soft 429 once, the next call works.
    6. `holdResponseNext("send", 1000)` with a client of `timeoutMs: 200` → the client throws `SoftError`; `sent.length` is 1; a repeat with the same key returns the stored `messageId`.
    7. `listByLabel` when the fake ignores the filter (a `failNext("list", {status: 200, body: {count: 1, messages: [<item without the label>]}})`) → `[]`.
    8. `setDisplayName` then send → the `sent` entry has the new display name.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: tests 1–8 pass; the fake stops cleanly (no open port after `stop()`).
  - Out of scope: anything that is not in the 5 calls.
