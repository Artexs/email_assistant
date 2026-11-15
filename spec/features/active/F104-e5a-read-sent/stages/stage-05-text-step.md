# F104 stage 05 — Text step

Part of [`../plan.md`](../plan.md). Review before the land (mail text into a new table). Needs stage 04. Read D7, D8.

After this stage `syncSentFolder` runs the header pass, then fetches the text of at most 100 sent mails of the text window per call, with the markers E5b needs. No job calls it yet.

## Step 1 — `fetchSentTexts` and `syncSentFolder`

**Files.** `apps/server/src/modules/mail/sent-texts.ts` (new), `apps/server/src/modules/mail/sent-sync.ts`, `apps/server/src/modules/mail/index.ts`, `apps/server/test/integration/mail-sent-texts.test.ts` (new).

**Interfaces.**

```ts
// sent-texts.ts
export const SENT_BODY_TEXT_LIMIT = 100_000; // the same number as the incoming body limit
export interface SentTextResult { stored: number; gone: number; expired: number; }
fetchSentTexts(
  deps: Pick<SentSyncDeps, "db" | "provider" | "now">, ctx, mailboxId,
  input: { path: string; uidValidity: number; textWindowMs: number; limit?: number } // default SENT_TEXT_RUN_LIMIT
): Promise<SentTextResult>

// sent-sync.ts
export interface SentPassResult extends SentHeaderResult { texts: SentTextResult; }
syncSentFolder(deps: SentSyncDeps, ctx, mailboxId): Promise<SentPassResult>
```

`fetchSentTexts`, with `now = deps.now()`:

1. `expired = expireSentTexts(before: now − textWindowMs)`.
2. `listPendingSentTexts(path, uidValidity, since: now − textWindowMs, limit)`; rows of an old path never match.
3. One row at a time: `fetchContent(path, uid)`. Both fields null → write `gone`. Else write `stored` with the text cut to `SENT_BODY_TEXT_LIMIT` and `autoSubmitted`, `precedence`, `listId`, `hasCalendar` from the capture (null when absent). The guard read is `{ path, uid, uidValidity }`. A count rises only when the write changed a row. No transaction around the loop.
4. Any error from `fetchContent` ends the loop and is rethrown; earlier writes stay.

`syncSentFolder`: the header step; on `done` read the state for path and UIDVALIDITY, use the same `textWindowMs` as the header step (it may carry it in its result), and run the text step; else `texts` are all 0.

**Test** (the setup of stage 04's file):

1. Initial over A (`NOW − 1 d`, text "Offer by Friday", `Auto-Submitted: no`), B (`− 20 d`), D (system send, `− 2 d`) → `texts.stored 1`; A `stored` with the text and `auto_submitted "no"`; B and D `headers_only`, no text.
2. `List-Id: <team.x.test>`, `Precedence: bulk` → `list_id "<team.x.test>"`, `precedence "bulk"` (the capture rules of `apps/server/src/modules/mail/imap/capture.ts`).
3. A fake with `bodyLimitBytes: 1000` and a mail of `size 5000` → `stored`, text null, markers set.
4. 3 pending and `limit 2` → the 2 oldest stored; the next call stores the third.
5. A pending row whose mail the fake removed → `gone`.
6. A pending row at `NOW − 13 d`, then `now = NOW + 2 d` → `expired 1`, `headers_only`, no `fetchContent` for it.
7. A text of 150 000 characters → stored length 100 000.
8. A reader that wraps the fake and throws `SoftError("timeout")` on the 2nd of 3 `fetchContent` calls → `syncSentFolder` throws; row 1 `stored`, rows 2–3 `pending`; the next call with the plain fake stores both.
9. Header status `flag_off`, `off`, `no_folder`, `folder_missing`, `cursor_moved` → no `fetchContent`, `texts` all 0.
10. Read-only: from a `folderCalls` snapshot, `"Sent"` calls are only the five reader methods.
11. Path change with pending rows A1, A2 of `"Sent"`; `"Wysłane"` holds two mails with the same UIDs → only the `Wysłane` texts are stored; A1, A2 stay `pending` without text, and turn `headers_only` after their window.
12. Retention 3 d: a pending row at `NOW − 5 d` → `expired 1`, no `fetchContent` for it.

**Check.** `bun test` on `apps/server/test/integration/mail-sent-texts.test.ts` and `apps/server/test/integration/mail-sent-sync.test.ts`.

**Out of scope.** The job and logs (06); retention (07).

## Done when

Cases 1–12 pass; stage 04's cases still pass; the Proof passes (`/tmp/f104-s05`).
