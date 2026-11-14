# F104 stage 05 — Text step

Part of [`../plan.md`](../plan.md). Review job before the land (mail text into a new table). Needs stage 04 on `master`. Read D7 and D8 first.

After this stage `syncSentFolder` runs the header pass and then fetches the text of at most 100 sent mails of the last 14 days per call, with the markers E5b needs. No job calls it yet (stage 06).

## Step 1 — `fetchSentTexts` and `syncSentFolder`

**Goal.** The text step of D7 and the one entry point of D8.

**Files.** `apps/server/src/modules/mail/sent-texts.ts` (new), `apps/server/src/modules/mail/sent-sync.ts` (`syncSentFolder`), `apps/server/src/modules/mail/index.ts`, `apps/server/test/integration/mail-sent-texts.test.ts` (new).

**Interfaces.**

```ts
// sent-texts.ts
export interface SentTextResult { stored: number; gone: number; expired: number; }

/** Assumes the header step of this call ended `done` (the state has a path and a cursor). */
export async function fetchSentTexts(
  deps: Pick<SentSyncDeps, "db" | "provider" | "now">,
  ctx: TenantContext,
  mailboxId: string,
  input: { path: string; uidValidity: number; limit?: number } // limit default SENT_TEXT_RUN_LIMIT
): Promise<SentTextResult>;

// sent-sync.ts
export interface SentPassResult extends SentHeaderResult { texts: SentTextResult; }

/** The header step, then the text step when the header step returned `done`; else texts are all 0. */
export async function syncSentFolder(deps: SentSyncDeps, ctx: TenantContext, mailboxId: string): Promise<SentPassResult>;
```

`fetchSentTexts`, with `now = deps.now()`:

1. `expired = await expireSentTexts(db, ctx, mailboxId, { before: now − SENT_TEXT_WINDOW_MS })`.
2. `rows = await listPendingSentTexts(db, ctx, mailboxId, { uidValidity, since: now − SENT_TEXT_WINDOW_MS, limit })`.
3. For each row, one at a time: `content = await deps.provider.fetchContent(path, row.uid)`; `content.text === null && content.capture === null` → `writeSentText(…, { kind: "gone" })` (`gone += 1` when it wrote); else `writeSentText(…, { kind: "stored", bodyText: content.text === null ? null : content.text.slice(0, 100_000), autoSubmitted: capture?.autoSubmitted ?? null, precedence: capture?.precedence ?? null, listId: capture?.listId ?? null, hasCalendar: capture?.hasCalendar ?? null })` (`stored += 1` when it wrote). The read for the guard is `{ uid: row.uid, uidValidity }`. No transaction around the loop: each write stands alone.
4. `MailFolderMissingError` from `fetchContent` ends the loop and is rethrown (the next call's header step reports `folder_missing`). Any other error is rethrown too; the rows written before it stay written.

Put the 100 000 limit in one exported constant `SENT_BODY_TEXT_LIMIT` (the same number as `BODY_TEXT_LIMIT` in `sync.ts`; do not import from `sync.ts`, which keeps that constant private).

`syncSentFolder`: `const headers = await syncSentHeaders(deps, ctx, mailboxId)`; when `headers.status === "done"`, read the state (`getSentSyncState`) for `path` and `uidValidity` and call `fetchSentTexts`; return `{ ...headers, texts }`.

**Decisions.** D7, D8.

**Test** (integration, `withRollback`, the setup of stage 04's test file; `NOW = 2026-11-20T10:00:00Z`):

1. Initial pass over A (`NOW − 1 d`, text "Offer by Friday", header `Auto-Submitted: no`), B (`NOW − 20 d`), D (system send, `NOW − 2 d`) → `texts.stored 1`; A is `stored` with `body_text "Offer by Friday"` and `auto_submitted "no"`; B and D stay `headers_only` with `body_text` null.
2. A mail with `List-Id: <team.x.test>` and `Precedence: bulk` → `list_id "<team.x.test>"` and `precedence "bulk"` (the capture rules of `mail/imap/capture.ts`: `precedence` is a lower-case token, `list_id` the header value cut to 300 characters).
3. A mail whose fake `size` is over the fake's `bodyLimitBytes` (`createFakeMailProvider({ bodyLimitBytes: 1000 })`, `deliver(…, { size: 5000 })`) → `stored`, `body_text` null, markers from the header block.
4. Limit: 3 pending mails and `limit 2` → `texts.stored 2`; the oldest two by `internal_date` are `stored`; the next call stores the third.
5. A pending row whose mail was removed from the fake (`fake.remove("Sent", uid)`) before the text step → `gone`.
6. A pending row with `internal_date NOW − 13 d`, then `now = NOW + 2 d` → `texts.expired 1`, the row is `headers_only`, no `fetchContent` call for it.
7. A text of 150 000 characters → `body_text` length 100 000.
8. `fetchContent` fails once with `new SoftError("timeout")` (`fake.failOn("fetchContent", …, 1)`) on the 2nd of 3 pending rows → `syncSentFolder` throws; row 1 is `stored`, rows 2 and 3 `pending`; the next call stores both.
9. Header step `flag_off`, `off`, `no_folder`, `folder_missing` or `cursor_moved` → no `fetchContent` call, `texts` all 0.
10. Read-only: after cases 1–8, the `"Sent"` entries of `fake.folderCalls` hold only the five reader methods.

**Check.** `bun test apps/server/test/integration/mail-sent-texts.test.ts apps/server/test/integration/mail-sent-sync.test.ts`

**Done when.** Cases 1–10 pass; stage 04's cases still pass.

**Out of scope.** The job call and the logs (stage 06); retention (stage 07).

## Done when (stage)

Step 1 done; the Proof command of `plan.md` passes (`/tmp/f104-s05`).
