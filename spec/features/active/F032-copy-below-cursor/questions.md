# F032 · Questions with their defaults

No blocking question. The stages do not change with any answer; each default is in `plan.md`.

## Q1 — A mail that no row knows stays unseen below a cursor `[important: scope]`

F032 stores only a copy of a mail that the system moved in the last 7 days (the hit of the existing end-of-run check). A mail that the database does not know and that lands below a cursor is still never stored or triaged. Known path: Interia sorts a COPY that arrives in a tab folder (`Oferty`) into INBOX minutes later, with the same UID; when newer INBOX mail moved the cursor meanwhile, the mail sits below it (ADR 0014 F12 and limit (h)). The system itself no longer COPYs into a tab folder (an Undo there is an APPEND), so only a user action can cause it. **Default:** out of scope; the docs name the limit (stage 02). **Option:** a new ticket for a bounded scan below the cursor, if the pilot logs show such mail.

## Q2 — A gap in the copy numbers stops the store `[minor]`

The copy key is `#(count + 1)`, as for an identical copy above the cursor (F029 D1). With rows `#1` and `#3` and no `#2`, the key `#3` exists, the insert stores nothing, and the copy is counted again at each sync while the moved row is in the 7-day window. A gap needs one deleted copy; the only delete of `emails` rows (the DSR erase) removes every row that matches the person, and a tombstone then blocks the key anyway. **Default:** keep the count rule in both paths (D3). **Option:** the highest number + 1 in both paths (one change, a new ticket).

## Q3 — A cross copy below the cursor waits one run `[minor]`

When this run already matched or stored the same mail in another synced folder, the copy is not stored in this run (the cross copy rule of the sort-folder sync); the next run stores it, as the chunk path does for a cross copy in a later run (D2, test 2.6). **Default:** keep the same rule in both paths.

## Q4 — A copy of old mail is stored but not sent to the LLM `[minor]`

The copy keeps the INTERNALDATE of the mail. When that is older than 7 days, the triage worker skips it as `too_old`, as for any stored mail (D8). **Default:** no exception.

## Q5 — On a server with per-folder UIDs, a rare copy stays unstored `[minor]`

A copy is not stored when another row of the same mail holds the same UID number in any folder (D2 `held`). With one UID counter (Interia) that row's mail is the one in the folder, so a store would duplicate it. With per-folder UIDs (RFC servers, GreenMail) an equal number can be chance; the copy then stays counted and unstored, as today. Copies below the cursor are rare on such servers, because a copy there gets a new UID above the cursor (cold review 1, M4). **Default:** accept. **Option:** a per-mailbox "one UID counter" flag from the capability check, a new ticket.

## Q6 — A copy is stored only when the moved mail is at its own UID `[minor]`

When the folder check finds the moved mail only at another UID (by search), the hit may be the user's move back while an untracked twin stays in the system folder. Such a copy stays counted and unstored, as today (D11, cold review 1, M5). **Default:** accept; the post-deploy count shows how often it happens.
