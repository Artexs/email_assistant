# test-mail-traffic — Stage 2

Part of [`../test-mail-traffic.md`](../test-mail-traffic.md). Read that file's "Design decisions" (D3, D6, D8, D9, D12) and "Edge cases" first.

## Stage 2 — Core: send log and send plan [risky]

Why risky: this logic decides whether a mail goes out once, twice or never (exactly-once, sending to people). Pure code: every rule has a unit test with fixed times.

- [ ] **2.1 Send log lines, parser, case states, send request**
  - Goal: the JSONL send log format (D6), a tolerant parser, the state of each case, and the AgentMail send request of a case.
  - Files: create `packages/core/src/testmail/send-log.ts`, `packages/core/src/testmail/send-log.test.ts`, `packages/core/src/testmail/request.ts`,
    `packages/core/src/testmail/request.test.ts`; change `packages/core/src/testmail/index.ts`.
  - Interfaces:

    ```ts
    // send-log.ts — every line has `type`, `batch`, `case`, `at` (ISO UTC). No subject, body or address in any line.
    export const deliverFolderKeys = ["inbox", "offers", "social", "bills", "junk", "db"] as const;
    export const sendLogLineSchema = z.discriminatedUnion("type", [
      z.object({
        type: z.literal("intent"),
        batch: z.string(),
        case: z.string(),
        attempt: z.number().int().min(1),
        key: z.string(),
        hash: z.string().regex(/^[0-9a-f]{64}$/),
        at: z.iso.datetime(),
      }),
      z.object({
        type: z.literal("sent"),
        batch: z.string(),
        case: z.string(),
        attempt: z.number().int().min(1),
        key: z.string(),
        messageId: z.string().min(3),
        threadId: z.string(),
        inbox: z.string(),
        via: z.enum(["send", "label"]),
        at: z.iso.datetime(),
      }),
      z.object({
        type: z.literal("failed"),
        batch: z.string(),
        case: z.string(),
        attempt: z.number().int().min(1),
        key: z.string(),
        code: z.string().regex(/^[a-z0-9_]{1,40}$/),
        at: z.iso.datetime(),
      }),
      z.object({
        type: z.literal("delivered"),
        batch: z.string(),
        case: z.string(),
        folder: z.enum(deliverFolderKeys),
        result: z.enum(["moved", "in_inbox", "duplicate_removed", "synced"]),
        at: z.iso.datetime(),
      }),
    ]);
    export type SendLogLine = z.infer<typeof sendLogLineSchema>;
    export function parseSendLog(text: string): { lines: SendLogLine[]; badLines: number[]; partialLast: boolean };
    export function formatSendLogLine(line: SendLogLine): string; // JSON + "\n"

    export type CaseState =
      | { kind: "due" }
      | { kind: "open"; attempt: number; key: string; hash: string; at: Date }
      | { kind: "sent"; attempt: number; messageId: string; threadId: string; inbox: string; at: Date }
      | { kind: "failed"; attempt: number; code: string };
    export function caseStates(
      batchId: string,
      caseIds: readonly string[],
      lines: readonly SendLogLine[]
    ): Map<string, CaseState>;
    export function sentInWindow(lines: readonly SendLogLine[], now: Date, windowMs: number): number;
    export function idempotencyKey(batchId: string, caseId: string, attempt: number): string; // `ea-${batch}-${case}-a${attempt}`
    export function caseLabel(batchId: string, caseId: string): string; // `ea-${batch}-${case}`
    export const TESTMAIL_LABEL = "ea-testmail";

    // request.ts
    export interface AgentMailSendRequest {
      to: string[];
      subject: string;
      text: string;
      headers: Record<string, string>;
      labels: string[];
    }
    export function buildSendRequest(input: {
      batchId: string;
      testCase: BatchCase;
      to: string;
      parentMessageId: string | null;
    }): AgentMailSendRequest;
    ```

  - Decisions:
    - `parseSendLog`: split on `\n`; skip empty lines; a line that is not JSON or fails the schema goes to `badLines` (1-based line numbers), except the last
      non-empty line when the text does not end with `\n`: then `partialLast` is true and the line is ignored (a crash during the append). The caller (stage 4)
      refuses to run when `badLines` is not empty.
    - `caseStates`: only lines with `batch === batchId` and a known case id count. Per case, the line with the highest attempt decides; for the same attempt,
      `sent` > `failed` > `intent`. A `sent` line of any attempt makes the case `sent` (the earliest `sent` wins: a second one is a log error that the state ignores).
      `delivered` lines never change the state.
    - `sentInWindow`: counts `sent` lines with `via: "send"` and `at > now - windowMs`, over all lines given (the caller passes all batch logs).
    - `idempotencyKey` and `caseLabel` throw `Error` when the result has a character outside `A-Z a-z 0-9 - . _ ~` or is longer than 256 (batch and case ids are already
      restricted, so this is a guard).
    - `buildSendRequest`: `to: [to]`; `subject` and `text` from the case as written; `headers`: `{ "X-EA-Testmail": "<batch>/<case>" }`, plus `In-Reply-To` and
      `References` = `parentMessageId` when it is not null; `labels: [TESTMAIL_LABEL, caseLabel(batch, case)]`. Key order in every object is fixed as written, so
      the JSON of the same input is byte-equal (the request hash in stage 4 depends on it). It never reads a `from` or a recipient from the case.
  - Test:
    1. `parseSendLog` of 3 valid lines → 3 lines, no bad lines; of `valid\n{"type":"sent"` (no final `\n`) → 1 line, `partialLast` true, `badLines` [];
       of `valid\nnot json\nvalid\n` → `badLines` [2].
    2. `caseStates`: no lines → `due`; intent a1 → `open` a1; intent a1 + sent a1 → `sent`; intent a1 + failed a1 → `failed`; intent a1 + intent a2 → `open` a2;
       sent a1 + intent a2 → `sent` (a1); lines of another batch are ignored; a `delivered` line alone → `due`.
    3. `sentInWindow` with `now = 2026-11-08T12:00:00Z`, window 24 h: sent at `2026-11-07T12:00:01Z` counts, at `2026-11-07T11:59:59Z` does not; a `via: "label"` line does not count.
    4. `idempotencyKey("2026-11-08-a", "c1", 2)` → `ea-2026-11-08-a-c1-a2`; a case id with `@` → throws.
    5. `buildSendRequest` without parent → no `In-Reply-To`/`References` keys; with parent `<p@x.test>` → both equal `<p@x.test>`; labels `["ea-testmail", "ea-<batch>-<case>"]`;
       `JSON.stringify` of two calls with the same input is equal.
    6. `formatSendLogLine` output parses back with `parseSendLog` to the same object.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: tests 1–6 pass.
  - Out of scope: file I/O, hashing (stage 4), HTTP (stage 3).

- [ ] **2.2 Send plan**
  - Goal: one pure function that says, for the current log, what the sender does next for each case (D3, D8, D9).
  - Files: create `packages/core/src/testmail/plan.ts`, `packages/core/src/testmail/plan.test.ts`; change `packages/core/src/testmail/index.ts`.
  - Interfaces:

    ```ts
    export const KEY_REUSE_MS = 12 * 3_600_000; // margin for a wrong PC clock against the 24 h server-side key expiry
    export type SendAction =
      | { kind: "send"; caseId: string; attempt: number; key: string; reuse: boolean } // reuse = an open intent with the same hash, younger than 12 h
      | { kind: "recover"; caseId: string; attempt: number; key: string }; // open intent of 12 h or more: label lookup first
    export type SkipReason = "sent" | "failed" | "changed" | "waiting_parent" | "blocked" | "cap" | "limit";
    export interface SendPlan {
      actions: SendAction[];
      skipped: { caseId: string; reason: SkipReason }[];
    }
    export function planSends(input: {
      batch: Batch;
      states: Map<string, CaseState>;
      hashes: Map<string, string>; // current request hash per case; a case whose parent is not sent has none
      now: Date;
      sentInLast24h: number;
      dailyCap: number;
      limit: number | null; // remaining sends allowed in this run; null = no limit
    }): SendPlan;
    ```

  - Decisions:
    - Cases are handled in batch order. Each case gets exactly one entry: an action or a skip.
    - `sent` → skip `sent`. `failed` → skip `failed`.
    - `open`: `hashes.get(id) !== state.hash` → skip `changed`. Same hash and `now - at < KEY_REUSE_MS` → `send` with the open attempt and key, `reuse: true`.
      Same hash and older → `recover` with the open attempt and key.
    - `due` with `replyTo`: parent `sent` → as a case without parent; parent `failed`, `changed` or `blocked` (in this plan) → skip `blocked`; parent in any other
      state → skip `waiting_parent`.
    - `due` without a parent problem → `send` with attempt 1, `idempotencyKey(batch, id, 1)`, `reuse: false`.
    - Cap and limit apply to `send` and `recover` actions in order: once `sentInLast24h + actions.length >= dailyCap` the next would-be action becomes skip `cap`;
      once `actions.length >= limit` it becomes skip `limit`. Cap is checked before limit.
    - A `send` with `reuse: true` still counts against cap and limit (it may be the first real send).
    - The service (stage 4) calls `planSends` again after each executed action, so a child becomes due in the same run after its parent is sent.
  - Test (now = `2026-11-08T12:00:00Z`, batch `2026-11-08-a`, cases `a`, `b` (replyTo `a`), `c`):
    1. All `due`, cap 50, no limit → actions `send a`, `send c`; skipped `b: waiting_parent`; keys `…-a-a1`, `…-c-a1`.
    2. `a` sent → actions `send b`, `send c`.
    3. `a` failed → `b` skipped `blocked`; `c` sent.
    4. `a` open (at `2026-11-08T11:00:00Z`, hash `h1`), hashes `a: h1` → `send a` with `reuse: true`, attempt 1.
    5. `a` open at `2026-11-08T00:00:00Z` (exactly 12 h) → `recover a`; open at `2026-11-08T00:00:01Z` → `send a` with `reuse: true`.
    6. `a` open with hash `h1`, hashes `a: h2` → skip `a: changed`, `b: blocked`.
    7. `sentInLast24h: 49`, cap 50 → only the first action; the second case is skipped `cap`.
    8. `limit: 1` → one action, the next skipped `limit`; `limit: 0` → no action.
    9. Each case appears exactly once in `actions` ∪ `skipped` (property check over tests 1–8).
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: tests 1–9 pass.
  - Out of scope: executing the plan, the lock, label lookup (stage 4).
