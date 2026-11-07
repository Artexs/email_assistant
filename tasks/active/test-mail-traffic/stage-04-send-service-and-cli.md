# test-mail-traffic — Stage 4

Part of [`../test-mail-traffic.md`](../test-mail-traffic.md). Read that file's "Design decisions" (D2, D3, D5, D6, D8, D9, D12, D16) and "Edge cases" first.

## Stage 4 — Send service and CLI `testmail` (setup, validate, blind, send, status) [risky]

Why risky: this is the code that sends mail (sending to people, exactly-once). The recipient guard and the intent-before-send order are the core of the stage.

**Test safety:** the task file rule "Test safety" applies to every test of this stage (temp `cwd` for spawned `testmail.ts`, the fake's `AGENTMAIL_BASE_URL`,
explicit env for `loadTestmailConfig`).

- [ ] **4.1 Lock, log file I/O and the send service**
  - Goal: run a batch: plan, intent, display name, send with retries, sent/failed lines, pace, caps, exit code.
  - Review units (task file "Run mode"): **4.1a** = `paths.ts`, `lock.ts`, `log-file.ts` and their tests (tests 15–16, `paths.test.ts`); **4.1b** = `send.ts` and `send.test.ts`
    (tests 1–14, 17). Build, review and commit 4.1a first.
  - Files: create `apps/server/src/modules/testmail/lock.ts`, `apps/server/src/modules/testmail/log-file.ts`, `apps/server/src/modules/testmail/send.ts`,
    `apps/server/src/modules/testmail/send.test.ts`, `apps/server/src/modules/testmail/lock.test.ts`, `apps/server/src/modules/testmail/log-file.test.ts`,
    `apps/server/src/modules/testmail/paths.ts`; change `apps/server/src/modules/testmail/index.ts`.
  - Paths (`paths.ts`): `testmailPaths(env = process.env)` → `{ batchesDir, personasFile, targetFile, runsDir, lockFile, batchLog(id) }` (D6).
    `root` = `env.TESTMAIL_ROOT` when set, else `resolve(import.meta.dir, "../../../../..")` (the repo root from `apps/server/src/modules/testmail/`).
    `runsDir` = `<root>/evals/.runs/testmail` when `TESTMAIL_ROOT` is set (tests), else `join(homedir(), ".local/state/ea-testmail")` (the same folder for the main
    checkout and every worktree). `lockFile` = `<runsDir>/send.lock`, `batchLog(id)` = `<runsDir>/<id>.jsonl`. The runs folder is created with `mkdirSync(…, { recursive: true, mode: 0o700 })`
    on first write. `process.env` is read only here and in the scripts.
    Test (`paths.test.ts`, in 4.1a): with `{ TESTMAIL_ROOT: "/tmp/x" }` every path is under `/tmp/x`; with `{}` `runsDir` is `~/.local/state/ea-testmail` and
    `batchesDir` ends with `evals/testmail/batches`.
  - Interfaces:

    ```ts
    // lock.ts
    export function acquireSendLock(
      path: string,
      opts?: { pid?: number; isAlive?: (pid: number) => boolean }
    ): { release(): void };
    // log-file.ts
    export function appendSendLogLine(path: string, line: SendLogLine): void; // cut a partial last line (D3), then open "a", write formatSendLogLine, fsync, close
    export function readSendLog(path: string): ReturnType<typeof parseSendLog>; // missing file → empty result
    export function readAllSendLogs(dir: string): { lines: SendLogLine[]; badFiles: string[] }; // every *.jsonl in dir; badFiles = files with badLines (names only)
    // send.ts
    export function requestHash(inboxId: string, request: AgentMailSendRequest): string; // sha256 hex of JSON.stringify({ inboxId, request })
    export interface SendDeps {
      client: AgentMailClient;
      now(): Date;
      sleep(ms: number): Promise<void>;
      append(line: SendLogLine): void;
    }
    export interface SendRunInput {
      batch: Batch;
      personas: PersonaFile;
      inboxId: string;
      to: string;
      lines: SendLogLine[]; // this batch's log
      sentInLast24h: number; // from all logs
      dailyCap: number;
      limit: number | null;
      intervalMs: number;
      currentDisplayName: string | null;
    }
    export interface SendRunResult {
      sent: string[];
      recovered: string[];
      failed: { caseId: string; code: string }[];
      remaining: { caseId: string; reason: SkipReason | "open" }[];
      stoppedBy:
        | null
        | "cap"
        | "limit"
        | "rate_limit"
        | "network"
        | "rejected"
        | "auth"
        | "inbox_missing"
        | "duplicate_found";
      exitCode: 0 | 1 | 2;
    }
    export async function runSend(deps: SendDeps, input: SendRunInput): Promise<SendRunResult>;
    ```

  - Decisions:
    - Loop: compute states (`caseStates`), hashes (for each case without `replyTo`, or whose parent is `sent`: `requestHash(inboxId, buildSendRequest(...))` with the parent's
      `messageId`), `planSends` with `limit = input.limit - actionsDoneThisRun` (null stays null). No action → finish. Else execute the first action only, then loop.
    - `send` action, `reuse: false`: append `intent {attempt, key, hash, at: now}` **before** any HTTP call of this case. `reuse: true`: no new intent.
      Then: persona display name ≠ the current display name → `setDisplayName` (keep the new value as current). Then `client.send(inboxId, request, key)`.
    - `recover` action: `listByLabel(inboxId, caseLabel)`. 1 match → append `sent {via: "label", messageId, threadId, attempt}`. 0 → append `intent` with
      attempt + 1 and its new key, then send as above. 2 or more → stop, `stoppedBy: "duplicate_found"`, exit 1 (a human-visible problem; never send).
    - Retries of one HTTP call (send, setDisplayName, listByLabel): `isSoftAgentMailError` or `SoftError` → wait and repeat the identical call, at most 3 repeats.
      Wait: 429 → `min(60, retryAfterSec ?? 1) * 2^n` seconds; other soft → `5 * 2^n` seconds (n = 0, 1, 2). After the third repeat fails → stop; `stoppedBy`
      `rate_limit` (429) or `network`; exit 2. The open intent stays; the next run resolves it (D3).
    - `setDisplayName` hard errors: 404 → stop, `inbox_missing`; any other non-soft error → stop, `stoppedBy: "rejected"`, exit 1 (the intent stays open; no send
      happened, so the next run resends with the same key).
    - A `send` that throws `HardError` for an unreadable 2xx schema → rethrow (exit 1); the intent stays open and the next run (within 12 h) gets the same `message_id` by key reuse.
    - Every executed action counts for `--limit`, also one that ends in a `failed` line.
    - Hard outcomes of `send`: `isIdempotencyConflict` → append `failed {code: "idempotency_conflict"}`, go on. 400 → `failed http_400`, go on. 403 → `failed http_403`;
      the second 403 in a row → stop, `stoppedBy: "rejected"`. 401 → stop, `auth`. 404 → stop, `inbox_missing`. Other status → `failed http_<status>`, go on.
      Any other error (HardError, bug) → rethrow (the CLI prints `describeError` and exits 1).
    - Success → append `sent {via: "send", attempt, key, messageId, threadId, inbox: inboxId, at: now}`; `sentInLast24h += 1`; then `sleep(intervalMs)` before the next
      action (no sleep after the last).
    - Plan skips `cap` / `limit` → `stoppedBy` `cap` / `limit` (the first one met).
    - Exit code after the loop: any case in state `failed`, or skipped `changed`/`blocked`, or `stoppedBy` in (`rejected`, `auth`, `inbox_missing`, `duplicate_found`) → 1;
      else any case not `sent` → 2; else 0. (This refines D12: a case that needs an agent fix gives 1.)
    - Log lines (`createLog("testmail")`): `sent <batch>/<case> attempt <n>`, `recovered <batch>/<case> by label`, `failed <batch>/<case> <code>`,
      `waiting <ms> ms (<status>)`, `stopped: <stoppedBy>`. Never subject, body, address, display name or key value (the key is not secret, but keep lines short: log the attempt number).
    - Lock: `openSync(path, "wx")` writes `{"pid":<pid>,"at":"<iso>"}`. `EEXIST` → read it; pid alive (`process.kill(pid, 0)` does not throw, or throws `EPERM`) and
      `at` younger than 24 h → `HardError("another testmail send runs (pid <pid>)")`; else (`ESRCH`, older, unreadable) → unlink, try once more. `release()` unlinks only
      when the file still holds our pid.
    - `appendSendLogLine`: when the file exists and its last byte is not `\n`, truncate it to the byte after the last `\n` (or to 0) before the append.
  - Test (`send.test.ts` with the fake server from 3.2 and the real client; `now` advances by a fake clock; `sleep` records the ms and resolves at once):
    1. 3 cases (a, b replyTo a, c), empty log → `sent` [a, b, c] in this order; the fake has 3 sends; b's request has `In-Reply-To` = a's `messageId`;
       the log has intent→sent pairs in that order; sleeps `[30000, 30000]`; exit 0.
    2. Repeat of test 1 with the full log → no HTTP send call, exit 0.
    3. Crash after the provider accepted: `holdResponseNext("send", 1000)` on case a, client `timeoutMs: 200` → the call repeats with the same key after 5 s and gets the stored `messageId`;
       the fake `sent.length` for a is 1; the log has one intent and one sent for a.
    4. Open intent for a (same hash, 1 h old, the fake already has a's mail with that key) → `reuse` send, no new intent line, the fake returns the first `messageId`, `sent.length` stays 1.
    5. Open intent 13 h old, the fake has a mail with a's label → `recovered` [a], `sent {via: "label"}`, no send call.
    6. Open intent 13 h old, no mail with the label → new intent with attempt 2 and key `…-a2`, then send.
    7. Two fake mails with a's label → `stoppedBy: "duplicate_found"`, exit 1, no send.
    8. Open intent whose hash differs (case edited) → no HTTP call for a; b `blocked`; c sent; exit 1.
    9. 429 on every send (failNext times 4) → waits `[1000, 2000, 4000]` ms, then `stoppedBy: "rate_limit"`, exit 2, a stays `open`.
    10. 409 `IdempotencyKeyConflictError` on a → `failed idempotency_conflict`; b `blocked`; c sent; exit 1.
    11. Two 403 in a row → `stoppedBy: "rejected"`, exit 1. 401 → `auth`, exit 1, nothing after it is sent.
    12. `sentInLast24h: 49`, cap 50 → one send, then `stoppedBy: "cap"`, exit 2.
    13. Persona display names: a (Anna), c (Jan) → PATCH before a and before c; two cases of the same persona in a row → one PATCH.
    14. Every request in the fake goes to `to: [input.to]` only (assert over all sends); no log line (capture the log output) contains a subject, a body word, the display name or the API key.
    15. Lock (`lock.test.ts`): second acquire with a live pid → throws; with a dead pid (`isAlive: () => false`) → takes the lock; a lock 25 h old with a live pid → taken;
        `release` of a lock that another pid now holds keeps the file.
    16. Log file (`log-file.test.ts`, new): a file `<line>\n{"type":"int` → `appendSendLogLine` → the file is `<line>\n<new line>\n` and `readSendLog` has no bad line.
    17. `setDisplayName` answers 403 → `stoppedBy: "rejected"`, exit 1, no send call, the intent stays open.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: tests 1–17 pass.
  - Out of scope: the CLI (4.2), deliver, compare.

- [ ] **4.2 CLI `testmail` and package scripts**
  - Goal: the PC-side commands for agents: `setup`, `validate`, `blind`, `send`, `status`.
  - Files: create `apps/server/src/scripts/testmail.ts`, `apps/server/test/integration/testmail-cli.test.ts`, `apps/server/src/modules/testmail/target.ts`,
    `apps/server/src/modules/testmail/target.test.ts`, `evals/testmail/target.json`; change `package.json` (scripts), `apps/server/src/modules/testmail/index.ts`.
  - Target file (`modules/testmail/target.ts`; stage 7 uses the same schema):

    ```ts
    export const remoteTargetSchema = z
      .object({
        testAddress: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/), // the only allowed recipient (D2)
        host: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/), // an ssh config alias; no leading "-" (it would be an ssh option)
        remoteDir: z
          .string()
          .regex(/^~?\/?[A-Za-z0-9_./-]{1,120}$/)
          .refine((s) => !s.includes("..")),
        composeArgs: z.literal("-f deploy/compose.yaml --env-file .env"),
        orgId: z.uuid(),
        mailboxId: z.uuid(),
      })
      .strict();
    export type RemoteTarget = z.infer<typeof remoteTargetSchema>;
    export function loadRemoteTarget(file: string): RemoteTarget; // readFileSync + JSON.parse + parse; errors print paths and codes only
    ```

    `evals/testmail/target.json` (committed; ids from `notes/2026-11-03-pilot-vps.md`):

    ```json
    {
      "testAddress": "artekstryszowski@interia.pl",
      "host": "home_vm",
      "remoteDir": "~/email_assistant",
      "composeArgs": "-f deploy/compose.yaml --env-file .env",
      "orgId": "ac6ed6a2-ee37-461f-9632-cc08cf549e40",
      "mailboxId": "8bc7f572-a7f5-4fa5-aaab-db16dc663e96"
    }
    ```

    `target.test.ts`: the committed file parses; `host: "-oProxyCommand=x"`, `host: "home_vm; rm -rf /"`, `remoteDir: "~/x && curl"`, `remoteDir: "~/../etc"` and an extra field → throw.

  - Interfaces (usage text of the CLI, printed on a usage error with exit 1):

    ```text
    usage: bun run testmail:setup
           bun run testmail:validate --batch <id> [--allow-unlabelled]
           bun run testmail:blind --batch <id> [--apply <labels.json> --checker <model id>]
           TEST_MAILBOX_ADDRESS=<address> bun run testmail:send --batch <id> [--limit n] [--interval-sec 30] [--daily-cap 50] [--dry-run]
           bun run testmail:status --batch <id>
      Files: evals/testmail/{batches/,personas.json,target.json}, logs and lock in ~/.local/state/ea-testmail/.
      send refuses every recipient except TEST_MAILBOX_ADDRESS, and TEST_MAILBOX_ADDRESS must equal testAddress in evals/testmail/target.json.
      Exit codes: 0 done, 1 error or a case needs a fix, 2 run again later.
    ```

    `package.json`: `"testmail:setup": "bun apps/server/src/scripts/testmail.ts setup"`, and the same for `validate`, `blind`, `send`, `status`.

  - Decisions:
    - Argument parsing with `parseArgs` (`strict: true`) and a Zod schema per subcommand, as in `eval.ts`. `--batch` must match `BATCH_ID_PATTERN`; the file is
      `<batchesDir>/<id>.json` (`testmailPaths()`). Numbers: `--limit` int ≥ 0, `--interval-sec` int 5–600, `--daily-cap` int 1–95.
    - Loading: personas with `personaFileSchema`, batch with `batchSchema`. A Zod error prints each issue as `<path>: <code>` only (no input values), exit 1.
    - `setup`: `loadTestmailConfig()` (key required) → `getInbox(<username>@agentmail.to)`; only on 404 → `ensureInbox({username, clientId, displayName: defaultDisplayName})`
      and `getInbox` again (the Free plan has 3 of 3 inboxes in use; whether a `POST` with a known `client_id` still answers 200 then is not verified) → print from the GET result
      `inbox <email> status <status ?? "active"> status_until <statusUntil ?? "-">`. `email` ≠ `<username>@agentmail.to` → print `inbox address differs from the persona file`, exit 1.
    - `validate`: `validateBatch(batch, personas, { fileBatchId, testAddress: loadRemoteTarget(targetFile).testAddress, requireBlind: !allowUnlabelled })` (`send` passes the same `testAddress`). Print one line per issue
      (`case <id|-> <code> <detail>`), then counts by expected category and by persona, then `valid` or `invalid (<n> issues)`. Exit 0 / 1. No API key needed.
    - `blind` without `--apply`: print `JSON.stringify(blindView(...), null, 2)` to stdout, exit 0. With `--apply`: read the labels file with `blindLabelsSchema`;
      `--checker` required; write the batch back with `JSON.stringify(batch, null, 2)` + `\n` (then the agent runs prettier on the file); print
      `agree <n>, disagree <n>, missing <n>, unknown <n>` and one line `disagree <id>: expected <a>, blind <b>` per disagreement. Exit 0 (1 when `unknown` > 0).
    - `send`: guard first, before any read of the log and before any HTTP call, each exit 1: `TEST_MAILBOX_ADDRESS` missing → `TEST_MAILBOX_ADDRESS is not set: send refused`;
      not matching `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` → `TEST_MAILBOX_ADDRESS is not an address: send refused`; ends with `@agentmail.to` →
      `TEST_MAILBOX_ADDRESS is an AgentMail address: send refused`; ≠ `testAddress` of `target.json` (read with `remoteTargetSchema` below) →
      `TEST_MAILBOX_ADDRESS differs from evals/testmail/target.json: send refused`. Then `validateBatch` with
      `requireBlind: true`; issues → print them, exit 1. Then the lock (`lockFile`, D6), `readAllSendLogs` (`badFiles` not empty → `send log damaged: <file names>`, exit 1),
      the batch log `batchLog(id)`. `--dry-run`: no API key needed, no HTTP call, no log line written: print the first plan of `planSends` (`would send <case> attempt <n>`,
      `skip <case> <reason>`), exit 0. Else `getInbox(<username>@agentmail.to)` (404 → `inbox not found: run bun run testmail:setup`, exit 1) and `runSend`.
      Print a summary: `sent <n>, recovered <n>, failed <n>, remaining <n>`, the failed and remaining case ids with reasons, and `stopped: <stoppedBy>` when set. Exit `result.exitCode`.
    - `status`: no HTTP. Per case: `<case> <expected> <state> [<delivered folder/result>]`; then counts. Exit 0.
    - Every command that reads a send log refuses (exit 1, `send log damaged: <file names>; stop and ask the user`) when a log has a bad line that is not the last one.
    - The CLI prints with `process.stdout.write` (report) and `log` (errors), as `eval.ts`. Errors: `describeError(error)`, exit 1. The lock is released in `finally`.
  - Test (`testmail-cli.test.ts`: spawn `bun <abs path>/testmail.ts` with `cwd` = a new temp folder, env = `PATH` + the fake's `AGENTMAIL_BASE_URL`, a fake key,
    `TESTMAIL_ROOT` = the temp folder (fixture files `evals/testmail/personas.json`, `evals/testmail/target.json` with `testAddress: "boss@interia.test"`, and batches,
    written by the test), and `TEST_MAILBOX_ADDRESS: "boss@interia.test"` unless the test says otherwise):
    1. `send` without `TEST_MAILBOX_ADDRESS` → exit 1, stderr has `send refused`, the fake saw 0 requests, no log file and no lock file exist.
    2. `TEST_MAILBOX_ADDRESS=x@agentmail.to` → exit 1, 0 requests.
    3. A batch with one `blind_disagrees` case → `send` exit 1, 0 requests; `validate` prints `blind_disagrees`, exit 1; `validate --allow-unlabelled` on a batch without `blind` → exit 0.
    4. `send --dry-run` without `AGENTMAIL_API_KEY` → exit 0, prints `would send` lines, 0 requests, no log file.
    5. (test timeout 20 s) `send` of a valid 2-case batch with `--interval-sec 5` → exit 0, 2 fake sends to `boss@interia.test`, the log has 2 `sent` lines; `status` shows both `sent`.
    6. `send` again → exit 0, no new fake send.
    7. A damaged log (a bad line in the middle) → exit 1 `send log damaged`, 0 send requests.
    8. `blind` prints JSON without `expected`; `blind --apply` with 1 disagreeing label → exit 0, the file has `blind` and `checker`, the output has `disagree`.
    9. `setup` against the fake → prints `inbox <username>@agentmail.to status active status_until 2026-12-07T14:40:11.000Z`, exit 0; the first run makes
       `GET` (404), `POST`, `GET`; a second run makes one `GET` and no `POST` (check the fake's `requests`).
    10. A live lock file with the test runner's pid → `send` exit 1 `another testmail send runs`.
    11. `TEST_MAILBOX_ADDRESS=other@interia.test` (valid, but ≠ `target.json`) → exit 1 `differs from evals/testmail/target.json`, 0 requests; `not-an-address` → exit 1.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–11 pass; `bun run testmail:validate --batch 2026-01-01-x` prints a clear "file not found" error (no stack trace) and exits 1.
  - Out of scope: deliver, compare, remote (stages 5–7); writing real batches (stage 9).
