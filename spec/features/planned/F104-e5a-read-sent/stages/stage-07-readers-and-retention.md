# F104 stage 07 — Answered reader, summaries, retention

Part of [`../plan.md`](../plan.md). Review before the land (retention of mail text). Needs stage 06. Read D10, D12, D14, D15.

After this stage other code can ask "did the user answer this mail, and when", the settings and the notice can read a summary per mailbox, and the daily retention job clears sent text and headers.

## Step 1 — Readers

**Files.** `apps/server/src/modules/mail/repo/sent-readers.ts` (new), exported by `mail`; `apps/server/test/integration/mail-sent-readers.test.ts` (new).

**Interfaces** (later stages and tickets use them):

```ts
export interface UserAnswer { answeredAt: Date; sentEmailId: string; }
listUserAnswers(db, ctx, emailIds: readonly string[]): Promise<Map<string, UserAnswer>>
export interface SentSummary { userCount: number; newestUserAt: Date | null; }
getSentSummary(db, ctx, mailboxId, { since }): Promise<SentSummary>
export interface SentHealthRow { mailboxId: string; firstPassAt: Date; lastPassAt: Date | null; newestUserAt: Date | null; lastErrorCode: SentErrorCode | null; }
listSentHealth(db, ctx): Promise<SentHealthRow[]>
```

Rules:
- `listUserAnswers`: per incoming id, the earliest (`sent_at`, then id) user row (`origin = 'user'`) of the same mailbox whose `parent_message_id` equals `emails.message_id_header`, any path. Ids without an answer are absent. `[]` → empty map, no query. Chunks of 500 ids.
- `getSentSummary`: user rows of the state's current path; `userCount` with `internal_date >= since`; `newestUserAt` of any age. No state path → `{ 0, null }`.
- `listSentHealth`: mailboxes of the org with the switch on and `first_pass_at` set, with the newest user `internal_date` of the current path.

**Test** (incoming mail by `insertTestEmail` with `message_id_header`; sent rows by `insertSentEmails`):

1. Incoming X `"<x@a.test>"`; user replies S1 (`NOW − 2 h`), S2 (`NOW − 1 h`) → `{ X: { NOW − 2 h, S1 } }`.
2. Only a system reply → X absent; a user row with `action_id` set → an answer.
3. A reply in another mailbox of the org → X absent.
4. Y without a reply, Z without `message_id_header` → absent; `[]` → empty map.
5. 600 ids, one answered at position 550 → in the map.
6. Summary since `NOW − 30 d`, path `"Sent"`: user rows at `− 1 d`, `− 40 d`, a system row at `− 1 h`, a user row of `"Old"` at `− 1 h` → `{ 1, NOW − 1 d }`; no rows or no state → `{ 0, null }`.
7. Health: M1 on with a first pass, M2 on without, M3 off → only M1, with `lastPassAt`, `newestUserAt` and `lastErrorCode` (`"folder_missing"` shows).
8. Org B's context with org A's ids → empty results.

## Step 2 — Retention

**Files.** `apps/server/src/modules/mail/repo/retention.ts`, `apps/server/src/retention.ts`, `apps/server/test/integration/retention-clear.test.ts`, `apps/server/test/integration/retention-job.test.ts`.

**Interfaces.**

```ts
clearSentBodies(db, ctx, { before, batch? }): Promise<number>   // body_text → null where internal_date < before
clearSentHeaders(db, ctx, { before, batch? }): Promise<number>  // subject, from_address → null; to, cc, references → '{}'
```

Both batch by id with `FOR UPDATE SKIP LOCKED`, as `clearMailBodies`. `clearSentHeaders` keeps `message_id`, `parent_message_id`, `thread_key`, `dedup_key` and the times, and counts only rows that still hold a value. `RetentionCounts` and `Clearers` gain `sentBody` and `sentHeaders`; `runOrg` calls `clearSentBodies` with the body cutoff and `clearSentHeaders` with the 90-day cutoff; the per-org log line lists both counts in its form at your base.

**Test.**

1. Bodies before `NOW − 30 d`: a `stored` row at `− 31 d` loses its text (content stays `stored`); `− 29 d` keeps it; a repeat → 0.
2. Headers before `NOW − 90 d`: a row at `− 91 d` loses subject, from, to, cc, references, keeps parent, thread, Message-ID; `− 89 d` unchanged; a repeat → 0.
3. `batch: 1` with 3 old rows → 3.
4. Org B's run never touches org A.
5. `apps/server/test/integration/retention-job.test.ts`: the expected count objects gain both keys; one filled case gives 1 and 1.
6. `listUserAnswers` still answers after `clearSentHeaders`.

## Step 3 — Docs

- `docs/architecture.md` §7 Retention: rows "Sent mail text" (`data_retention_days` from the Sent INTERNALDATE) and "Sent mail subject, addresses" (90 days, the row stays). §7 Delete: a mailbox removal deletes its sent mail and Sent state.
- `docs/capabilities/retention.md`: rows for both clear functions, counted from `internal_date`.
- `docs/capabilities/sent-mail.md`: rules for the readers and retention; entry points.

**Test.** `apps/server/src/capability-map.test.ts` passes.

## Done when

Steps 1–3 done; the Proof passes (`/tmp/f104-s07`).
