# test-mail-traffic — Stage 6

Part of [`../test-mail-traffic.md`](../test-mail-traffic.md). Read that file's "Design decisions" (D1, D4, D10, D11, D12, D15) first.

## Stage 6 — Compare: repository, report, CLI `testmail-target`

`testmail-target` is the DB side of the tool. It runs where the mailbox's DB is: in tests and on the dev DB locally, on the VPS through stage 7.
Its input comes on stdin as JSON (no mail text), so the VPS needs no batch file and no send log.

- [ ] **6.1 Target input, compare rows and table (core); latest triage query (triage repo)**
  - Goal: the stdin format, the per-case compare rows, a Markdown table, and the query for the latest triage result per mail.
  - Files: create `packages/core/src/testmail/target.ts`, `packages/core/src/testmail/target.test.ts`; change `packages/core/src/testmail/index.ts`,
    `apps/server/src/modules/triage/repo.ts`, `apps/server/src/modules/triage/index.ts`, `apps/server/test/integration/triage-repo.test.ts`.
  - Interfaces:

    ```ts
    // packages/core/src/testmail/target.ts
    export const targetInputSchema = z
      .object({
        batch: z.string().regex(BATCH_ID_PATTERN),
        sender: z.string().regex(/^[^\s@]+@[^\s@]+$/),
        cases: z
          .array(
            z
              .object({
                caseId: z.string().regex(/^[a-z0-9-]{1,40}$/),
                persona: z.string().regex(/^[a-z0-9-]{1,40}$/),
                expected: z.enum(testmailCategories),
                marker: z.enum(["none", "borderline", "attack"]),
                parentCaseId: z
                  .string()
                  .regex(/^[a-z0-9-]{1,40}$/)
                  .nullable(), // replyTo
                messageId: z.string().min(3).max(300).nullable(), // null = not sent
                sentAt: z.iso.datetime().nullable(),
              })
              .strict()
          )
          .min(1)
          .max(200),
      })
      .strict();
    export type TargetInput = z.infer<typeof targetInputSchema>;
    export function buildTargetInput(batch: Batch, lines: readonly SendLogLine[], sender: string): TargetInput; // marker from note prefix

    export interface CompareRow {
      caseId: string;
      persona: string;
      expected: TestmailCategory;
      marker: "none" | "borderline" | "attack";
      state: "not_sent" | "not_synced" | "not_triaged" | "triaged";
      emailId: string | null;
      category: Category | null;
      confidence: number | null;
      reasonCode: string | null;
      model: string | null;
      promptVersion: string | null; // triage_results.prompt_version
      ok: boolean | null; // null unless triaged
      thread: "ok" | "MISSING" | null; // only for cases with a parent and a stored mail: in_reply_to set or not
    }
    export function buildCompareRows(
      input: TargetInput,
      emails: readonly { id: string; message_id_header: string; status: string; in_reply_to: string | null }[],
      results: readonly {
        email_id: string;
        category: Category;
        confidence: number;
        reason_code: string;
        model: string | null;
        prompt_version: string | null;
      }[]
    ): CompareRow[];
    export function renderCompareTable(rows: readonly CompareRow[]): string; // Markdown

    // apps/server/src/modules/triage/repo.ts
    export async function listLatestTriageByEmailIds(
      db: DbOrTrx,
      ctx: TenantContext,
      emailIds: readonly string[]
    ): Promise<
      {
        email_id: string;
        category: Category;
        confidence: number;
        reason_code: string;
        model: string | null;
        prompt_version: string | null;
        fields: unknown;
      }[]
    >; // latest per email_id (created_at desc, id desc), org filter; [] for []; chunks of 500
    ```

  - Decisions:
    - `buildTargetInput`: one entry per batch case in batch order; `messageId`/`sentAt` from the `sent` state (`caseStates`), else null. `marker` = `attack` when `note`
      starts with `attack:`, `borderline` when it starts with `borderline:`, else `none`; `parentCaseId` = `replyTo ?? null`.
    - `buildCompareRows`: `messageId` null → `not_sent`; no email row with that `message_id_header` → `not_synced`; a row but no result → `not_triaged`; else `triaged`
      with the result fields and `ok = category === expected` (a `delegation` or `unsure` result is never equal, so it counts as `WRONG`). Two email rows with the same id (a second copy) → take the row that has a result; if both or none
      have one, the first by `id` order (the table shows the case once). `thread` = `ok`/`MISSING` from the chosen row's `in_reply_to` when `parentCaseId` is set and a row exists, else null.
    - `renderCompareTable`: header line `| case | persona | expected | triage | confidence | reason | result | thread |` (`thread` cell empty when null); `result` is `ok`, `WRONG`, or the state
      (`not sent`, `not synced`, `not triaged`); a `borderline` row gets ` (borderline)` after the case id, an `attack` row ` (attack)`. Confidence with 2 decimals.
      Below the table: `triaged <n> of <m> sent; ok <n>; wrong <n>`, then `prompt versions: <version> (<n>), …` over the triaged rows (`none` for null),
      in order of count, then name. No subject, no body (the agent reads them in the batch file).
    - `listLatestTriageByEmailIds` filters `triage_results.org_id = ctx.orgId`; it uses `distinctOn("email_id")` with the same order as `listLabeledResults`.
  - Test:
    1. (`target.test.ts`) `buildTargetInput` of a 3-case batch with one `sent` case and notes `attack: …` / `borderline: …` → markers and nulls as decided; the result passes `targetInputSchema`.
    2. `buildCompareRows`: one case per state; `ok` true and false cases; a child with `in_reply_to` → `thread: "ok"`, without → `MISSING`; two rows for one id where only the second has a result → the second is used.
    3. `renderCompareTable` snapshot of 4 rows (fixed values), including `(borderline)` and `not synced`; the output contains no text that is not in the rows.
    4. `targetInputSchema` refuses an unknown field and a `caseId` with `/`.
    5. (`triage-repo.test.ts`) two results for one email (older `info`, newer `spam`) → `spam`; an email of org B with a result is not returned for org A; `[]` → `[]`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–5 pass.
  - Out of scope: the CLI (6.2).

- [ ] **6.2 CLI `testmail-target` (deliver, compare)**
  - Goal: the DB-side commands; JSON on stdin; clear stdout and exit codes (D12).
  - Files: create `apps/server/src/scripts/testmail-target.ts`, `apps/server/test/integration/testmail-target.test.ts`; change `package.json`
    (`"testmail:target": "bun apps/server/src/scripts/testmail-target.ts"`).
  - Interfaces (usage, printed on a usage error with exit 1):

    ```text
    usage: bun run testmail:target deliver --org-id <uuid> --mailbox-id <uuid> [--check-only] < input.json
           bun run testmail:target compare --org-id <uuid> --mailbox-id <uuid> [--bar 0.98] [--min-kept 30] < input.json
      input.json: the target input of a batch (bun run testmail:remote … --print-input writes it). deliver refuses every mailbox except TEST_MAILBOX_ADDRESS.
    ```

  - Decisions:
    - First line of `main`: `setLogLevel("warn")`, so module `info` logs (they go to stdout) never mix into the JSON lines or the report. The script writes its
      own summaries and errors to stderr (`process.stderr.write` / `log.error`); stdout holds only the JSON lines (deliver) or the report (compare).
    - Read all of stdin (`await Bun.stdin.text()`), `JSON.parse`, `targetInputSchema.parse`; an error prints `bad input: <path>: <code>` per Zod issue, exit 1.
    - Both commands: `loadConfig()`, `createDb`, `assertAppRole`, `createSecretBox` (deliver only), `db.destroy()` in `finally`. Errors → `describeError`, exit 1.
    - `deliver [--check-only]`: `wanted` = the cases with a `messageId`; none → stderr `nothing sent yet`, exit 2. Else
      `deliverTestMail(..., { testAddress: config.TEST_MAILBOX_ADDRESS, sender: input.sender, wanted, checkOnly })`. stdout: one JSON line per case
      `{"case":"<id>","result":"<result>","folder":"<key|null>"}` (the stage 7 wrapper parses it); the summary line goes to stderr. Exit 0 when every wanted case is
      `synced`, `in_inbox`, `moved` or `duplicate_removed`; 2 when some are `not_found`.
    - `compare`: `listEmailsByMessageIds` (mail index) → `listLatestTriageByEmailIds` (triage index) → `buildCompareRows`. stdout: the heading
      `# Testmail compare: <batch>`, the table, the line `expected labels come from the batch file (writer + blind checker), not from triage_feedback`, then the
      eval report: map each `triaged` row to the `listLabeledResults` row shape (`email_id`, `category`, `confidence`, `reason_code`, `model`, `fields`,
      `verdict: ok ? "right" : "wrong"`, `true_category: expected`) → `buildRealReport(rows, { bar, minKept, mail: "synthetic", now: new Date() })` (`"synthetic"`: the header then says
      `labeled synthetic mails` and `synthetic mail, dev check`; with `"real"` it would say `real mails` and print the real-label done-when line, and a later agent
      could take the file for S3 gate evidence) →
      `renderEvalReport(report, { title })` with the title `Eval report: testmail batch <batch>`. Exit 0 when every sent case is `triaged`; 2 when some sent case
      is not; 1 on error.
    - The script never writes to the DB (compare) and never reads a batch file or a send log.
  - Test (`testmail-target.test.ts`; spawn the script with `cwd` = repo root (allowed by the task file "Test safety" rule: it needs the DB keys and reads no AgentMail key);
    keys that a test wants unset are passed as `""`; stdin from the test. A spawned process cannot see a rolled-back transaction, so the rows are committed:
    `insertTriaged`/`insertTestEmail` on `db` (not a transaction) in a new org per test file; `afterAll` deletes that org's `triage_results`, `emails`, mailbox and org
    (in that order, by its `org_id`)):
    1. `compare` with 3 cases (one triaged right, one triaged wrong, one `not_synced`) → exit 2; stdout has the table with `ok`, `WRONG`, `not synced`, a
       `prompt versions:` line and an `Eval report: testmail batch` section with `synthetic mail, dev check` and without `real mails`.
    2. `compare` with all sent cases triaged → exit 0.
    3. Bad stdin (`{}`) → exit 1, `bad input`.
    4. `deliver` with `TEST_MAILBOX_ADDRESS: ""`, `TRIAGE_LLM_SCOPE: "off"` and `ACTIONS_SCOPE: "off"` in the child env (else `loadConfig` can fail first) → exit 1,
       the error says `TEST_MAILBOX_ADDRESS is not set`. Every spawned run of this file sets both scopes to `"off"`.
    5. `deliver` with all cases already in `emails` (GreenMail mailbox from `connectMailbox`, `TEST_MAILBOX_ADDRESS` = its address) → exit 0, every line `"result":"synced"`.
    6. stdout of `compare` contains no subject or body text (the test rows have subjects `secret-subject-1`; assert absent).
    7. `deliver` stdout: every non-empty line parses as JSON (no log line on stdout).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run dev:up && bun run db:migrate && bun run test:int`
  - Done when: tests 1–7 pass; the integration test leaves no rows behind (count of its org's emails = 0 after `afterAll`).
  - Out of scope: SSH, the bundle (stage 7).
