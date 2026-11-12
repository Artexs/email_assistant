# test-mail-traffic — Stage 1

Part of [`../plan.md`](../plan.md). Read that file's "Design decisions" (D5, D6, D7, D16) and "Rules for every step" first.

## Stage 1 — Core: batch and persona schemas, validation, blind view

Pure code in `packages/core`, no I/O. Later stages import it from `@ea/core`.

- [x] **1.1 Persona file and batch schemas, validation**
  - Goal: one Zod schema for the persona file and one for a batch file; one pure function that lists every rule violation of a batch (D7).
  - Files: create `packages/core/src/testmail/batch.ts`, `packages/core/src/testmail/batch.test.ts`, `packages/core/src/testmail/index.ts`;
    change `packages/core/src/index.ts` (add `export * from "./testmail";`).
  - Interfaces:

    ```ts
    // packages/core/src/testmail/batch.ts
    export const testmailCategories = ["urgent", "needs_reply", "info", "notification", "spam"] as const; // a test asserts it equals classifierCategories (triage/categories.ts)
    export type TestmailCategory = (typeof testmailCategories)[number];
    export const personaGroups = ["work", "services", "outside"] as const;

    export const personaSchema = z.object({
      key: z.string().regex(/^[a-z0-9-]{1,40}$/),
      displayName: z
        .string()
        .min(1)
        .max(60)
        .regex(/^[^<>"\r\n@]+$/), // no address characters, no line break
      group: z.enum(personaGroups),
      lang: z.enum(["pl", "en"]),
      voice: z.string().min(1).max(500), // short text for the writer: role, tone, typical topics
    });
    export const personaFileSchema = z
      .object({
        inbox: z.object({
          username: z.string().regex(/^[a-z0-9-]{1,64}$/),
          clientId: z.string().regex(/^[A-Za-z0-9._~-]{1,64}$/),
          defaultDisplayName: z
            .string()
            .min(1)
            .max(60)
            .regex(/^[^<>"\r\n@]+$/),
        }),
        personas: z.array(personaSchema).min(1),
      })
      .superRefine(/* persona keys unique */);
    export type PersonaFile = z.infer<typeof personaFileSchema>;

    export const BATCH_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,40}$/;
    export const batchCaseSchema = z
      .object({
        id: z.string().regex(/^[a-z0-9-]{1,40}$/),
        persona: z.string(),
        lang: z.enum(["pl", "en"]),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(6000),
        expected: z.object({ category: z.enum(testmailCategories) }),
        blind: z.object({ category: z.enum(testmailCategories) }).optional(),
        replyTo: z.string().optional(),
        note: z.string().max(300).optional(),
      })
      .strict();
    export const batchSchema = z
      .object({
        batch: z.string().regex(BATCH_ID_PATTERN),
        writer: z.string().min(1).max(80), // model id of the writer, e.g. "claude-sonnet-5-5"
        checker: z.string().min(1).max(80).optional(), // model id of the blind checker; set by `blind --apply`
        cases: z.array(batchCaseSchema).min(1).max(200),
      })
      .strict();
    export type Batch = z.infer<typeof batchSchema>;
    export type BatchCase = z.infer<typeof batchCaseSchema>;

    export interface BatchIssue {
      caseId: string | null;
      code: BatchIssueCode;
      detail: string;
    } // detail: no mail text, only ids, field names, counts
    export type BatchIssueCode =
      | "duplicate_id"
      | "unknown_persona"
      | "lang_mismatch"
      | "reply_unknown"
      | "reply_not_earlier"
      | "reply_persona"
      | "subject_line_break"
      | "address_not_reserved"
      | "url_not_reserved"
      | "phone_number"
      | "test_address"
      | "blind_missing"
      | "blind_disagrees"
      | "batch_id_mismatch";

    export function validateBatch(
      batch: Batch,
      personas: PersonaFile,
      opts: { fileBatchId: string; testAddress?: string; requireBlind: boolean }
    ): BatchIssue[];
    ```

  - Decisions:
    - `validateBatch` never throws; it returns all issues in case order, then batch-level issues. An empty list = valid.
    - `batch_id_mismatch`: `batch.batch !== opts.fileBatchId` (the file name without `.json`).
    - `lang_mismatch`: the case `lang` differs from its persona's `lang`.
    - `reply_unknown`: `replyTo` names no case of the batch. `reply_not_earlier`: the parent comes later in `cases` (this also rules out cycles).
      `reply_persona`: the child persona differs from the parent persona and the child persona's group is not `work` (a colleague may answer in a client thread; a
      newsletter may not).
    - `subject_line_break`: `/[\r\n]/` in the subject.
    - Reserved domains: a host is reserved when it equals or ends with `.test`, or equals or ends with `.example.com`/`.example.org`/`.example.net`, or equals
      `example.com`, `example.org`, `example.net` (case-insensitive). Addresses: every match of `/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g` in subject and body;
      the host is group 1 → `address_not_reserved`. URLs: every match of `/\bhttps?:\/\/([^\s/:?#]+)/gi`, of `/\bwww\.([^\s/:?#]+)/gi`, and of a bare domain
      `/\b((?:[a-z0-9-]+\.)+(?:com|pl|net|org|eu|io|info|biz|co|uk|de|app|online|shop|xyz|me|site))\b/gi` (not part of an e-mail address: skip a match that follows `@`)
      → the host must be reserved, else `url_not_reserved`. Strip trailing `.`, `,`, `;`, `:`, `!`, `?`, `)` and `]` from a captured host before the check.
    - `phone_number`: `/\d[\d\s-]{7,}\d/` where the match has 9 or more digits.
    - `test_address`: `opts.testAddress` is set and appears (case-insensitive) in subject or body.
    - `blind_missing`: `opts.requireBlind` and the case has no `blind`. `blind_disagrees`: `blind` is set, `blind.category !== expected.category`, and `note` does not
      start with `borderline:`. Both are checked only when `requireBlind` is true.
    - `detail` texts name the field and the rule, e.g. `body: host not reserved`; never the matched text (it can hold made-up but address-like data).
  - Test (`batch.test.ts`, fixed values):
    1. A valid batch of 3 cases (two personas, one `replyTo` to case 1 from a `work` persona) → `[]`.
    2. Two cases with id `a` → one `duplicate_id` for the second.
    3. `persona: "nobody"` → `unknown_persona`. Persona `lang: pl`, case `lang: en` → `lang_mismatch`.
    4. `replyTo: "zzz"` → `reply_unknown`; `replyTo` pointing to the next case → `reply_not_earlier`; a `services` persona answering a `work` parent → `reply_persona`.
    5. Body `write to jan@firma.pl` → `address_not_reserved`; `jan@firma.test` and `x@sub.example.com` → no issue.
    6. Body `https://bank-login.com/x` → `url_not_reserved`; `https://example.com/a`, `http://portal.test/`, `www.example.org` → no issue; `www.realshop.pl` → `url_not_reserved`;
       bare `bank-login.com/verify` → `url_not_reserved`; bare `portal.example.com` → no issue; `raport.pdf` → no issue.
    7. Body `call 600 123 456` → `phone_number`; `order 12345678` (8 digits) → no issue.
    8. `testAddress: "boss@interia.test"`, body contains `BOSS@interia.test` → `test_address`.
    9. `requireBlind: true`: a case without `blind` → `blind_missing`; `blind` `info` vs expected `spam` without note → `blind_disagrees`; the same with
       `note: "borderline: promo or info"` → no issue; `requireBlind: false` → neither code.
    10. Subject with `\n` → `subject_line_break`.
    11. File id `2026-11-08-b`, `batch: "2026-11-08-a"` → `batch_id_mismatch`.
    12. `personaFileSchema` refuses two personas with the same key and a display name with `<`.
    13. No issue `detail` contains the matched host or address (assert with the inputs of tests 5–8).
    14. `testmailCategories` has the same members in the same order as `classifierCategories`.
    15. `see https://portal.example.com.` and `(http://portal.test)` → no issue.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: tests 1–15 pass; `@ea/core` exports the schemas, types and `validateBatch`.
  - Out of scope: reading files (stage 4), the persona file content (stage 8), send logic.

- [x] **1.2 Blind view and blind apply**
  - Goal: pure helpers for the blind labelling pass (D16).
  - Files: create `packages/core/src/testmail/blind.ts`, `packages/core/src/testmail/blind.test.ts`; change `packages/core/src/testmail/index.ts`.
  - Interfaces:

    ```ts
    // What the classifier sees: one bare sender address for every persona, no display name, no group.
    export interface BlindCase {
      id: string;
      from: string;
      lang: "pl" | "en";
      subject: string;
      body: string;
      thread: { from: string; subject: string; body: string }[];
    }
    export function blindView(batch: Batch, personas: PersonaFile): BlindCase[];
    export const blindLabelsSchema: z.ZodType<{ id: string; category: TestmailCategory }[]>;
    export function applyBlindLabels(
      batch: Batch,
      labels: { id: string; category: TestmailCategory }[],
      checker: string
    ): { batch: Batch; unknownIds: string[]; missingIds: string[] };
    ```

  - Decisions:
    - `blindView` leaves out `expected`, `blind`, `note`, the persona key, display name and group. `from` = `<personas.inbox.username>@agentmail.to` for every case.
      `thread` = the chain of parents (oldest first) by `replyTo`, each with `from`, subject and body, so the checker sees what the classifier sees.
    - `applyBlindLabels` returns a new batch (no mutation); it sets `blind` on each case with a label, sets `checker`, keeps every other field and the case order.
      Ids in `labels` that are not in the batch → `unknownIds`; cases without a label → `missingIds` (their old `blind` stays).
    - `blindLabelsSchema`: an array of `{ id, category }`, strict objects, ids unique (superRefine).
  - Test:
    1. A batch with a 2-level thread (c → b → a): `blindView` for `c` has `thread` `[a, b]`; no output object has `expected`, `blind`, `note`, `persona`, a display name or a
       group (check with `Object.keys` and with `JSON.stringify` not containing the display names); every `from` is the inbox address.
    2. `applyBlindLabels` with labels for 2 of 3 cases and one unknown id → `blind` set on 2, `missingIds` = the third, `unknownIds` = the unknown, `checker` set, input unchanged (deep equal to a copy).
    3. `blindLabelsSchema` refuses a duplicate id and an extra field.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: tests 1–3 pass.
  - Out of scope: the CLI that prints and applies (stage 4).
