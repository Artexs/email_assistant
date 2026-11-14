# F029 stage 04 — Wiring, test 8.4, docs (F064)

Part of [`../plan.md`](../plan.md). **[risky]**: job wiring next to the flag refresh of the measure ticket (review job before the land). Needs stages 01 and 03 on `master`. Read D10, D12, D14, D16 of `plan.md` and facts F4, F5, F12, F13 first, then `apps/server/src/modules/mail/flags.ts` and `apps/server/src/modules/mail/jobs.ts` (`syncOne`).

## Step 1 — `refreshFlags` returns the gone targets

**Goal.** The refresh hands the mail it could not find to the finder; what it writes stays the same.

**Files.** `apps/server/src/modules/mail/flags.ts`, `apps/server/test/integration/mail-flags.test.ts`.

**Interfaces.** `FlagsRefreshResult` gains one field:

```ts
  /** The targets counted in `notFound`, in read order: mail that left its folder (the move finder looks for it). */
  gone: FlagTarget[];
```

In `refreshFlags`: start with `gone: []`; in the `found === undefined` branch, also `result.gone.push(target)`. A `mismatch` target is not gone (its UID names another mail). Nothing else in `flags.ts` changes: not the queue, the guards, `writeEmailFlags` or `touchEmailFlags`.

**Test.** Update exactly the five `toEqual` assertions of fact F4 in `mail-flags.test.ts` (no other line of that file changes in this step):

- line 228 (case 3, first refresh) → add `gone: []`;
- line 238 (case 3, after the user move) → add `gone: [expect.objectContaining({ emailId: m1, folder: "INBOX", uid: uid1 })]`;
- line 259 (case 6, mismatch) → add `gone: []`;
- line 341 (N1, run 0) → add `gone: [expect.objectContaining({ emailId: gone, uid: 999 })]` (`gone` is the test's id variable);
- line 350 (N1, run 1) → add `gone: []`.

**Check.** `bun test apps/server/test/integration/mail-flags.test.ts`

**Done when.** The whole file passes with only those five lines changed.

**Out of scope.** The refresh cadence, window and limit.

## Step 2 — The finder in the sync job

**Goal.** After a refresh with gone mail, the job runs the finder on the same connection; an error there never fails the sync.

**Files.** `apps/server/src/modules/mail/jobs.ts`, `apps/server/test/integration/mail-flags.test.ts` (describe `flag refresh in the sync job`).

**Interfaces.** In `syncOne`, inside the existing flag block, after `log.info("flags_refreshed", …)` and still inside the refresh `try`:

```ts
if (refreshed.gone.length > 0) {
  try {
    await findUserMoves({ db: deps.db, provider, now: deps.now }, ctx, mailboxId, refreshed.gone, {
      skipFolders: [...result.failed, ...result.skipped],
    });
  } catch (error) {
    log.warn("user_moves_failed", { mailbox_id: mailboxId, ...errorFields(error) });
  }
}
```

The inner `try` makes a finder error a `user_moves_failed` line, never a `flags_refresh_failed` line. A refresh that throws reaches its own `catch` before this code, so it starts no finder. Import `findUserMoves` from `./moves`. Add one comment line above the block: "Mail that the refresh did not find in its folder may sit at the same UID in a synced folder below its cursor (a webmail move keeps the UID)."

**Decisions.** D10, D12.

**Test** (describe `flag refresh in the sync job`; use `pauseOtherMailboxes`, `addBox`, `jobWith`, `seed`; the Interia fake `createFakeMailProvider({ uidValidity: 7, globalUids: true, keepUidOnUserMove: true, uidNextValue: 1, capabilities: { move: false } })`; mail with `internalDate` one hour before `NOW`):

- 4.1 The job finds a user move below the cursor: deliver mail 1 into `INBOX` (`u1`) and mail 2 into `Oferty` (`u2`, so the fake lists `Oferty`); run 1 at `NOW` (discovery adds the `offers` row; both folders store their mail; the `offers` cursor is `u2`); `fake.userMove("INBOX", u1, "Oferty")` (keeps `u1`, below the cursor); run 2 at `NOW + 11 min` → the row of mail 1 has `folder` = `source_folder` = `Oferty`, `uid` = `u1`, `returned_at` null; one info line holds `user_moves_found` and `count=1` (spy on `console.log`, restore after).
- 4.2 A refresh that throws starts no finder: extend case 4 (line 144) with one assertion: no line of `console.log` or `console.error` holds `user_moves`.
- 4.3 A finder error is one warning: as 4.1, but before run 2 call `fake.failOn("fetchByUidsIn", new SoftError("lost connection"))` (run 2 makes no other `fetchByUidsIn` call before the finder: INBOX and `Oferty` are incremental and no row is system-moved) → one `console.error` line holds `user_moves_failed` and `mailbox_id=<id>`; no line holds `flags_refresh_failed`; `flags_refreshed` is logged; `last_synced_at` is `NOW + 11 min`; the row of mail 1 stays in `INBOX`.
- 4.4 A run that does not refresh does not search: as 4.1, but run 2 at `NOW + 2 min` → the row stays in `INBOX` and the fake has no `fetchByUidsIn` call for `Oferty` after run 1 (note `fake.folderCalls.length` after run 1).

**Check.** `bun test apps/server/test/integration/mail-flags.test.ts apps/server/test/integration/mail-jobs.test.ts`

**Done when.** Cases 4.1–4.4 and every old case of both files pass.

**Out of scope.** The cron interval (F100 stage 07); the log conversion of the old lines of `jobs.ts` (F103 stage 10).

## Step 3 — Test 8.4 shows the new result

**Goal.** The F064 done-when: the test that pinned the known limit now pins the fix.

**Files.** `apps/server/test/integration/mail-sync.test.ts` (test 8.4, lines 2006–2027 at the plan base).

**Test.** Keep the setup and the first part of 8.4 (a sync pass alone does not see the move: `returnedBelowCursor` 0 in both folders, rows unchanged). Rename it to `"8.4 a mail of source INBOX that the user files into Oferty below its cursor: the pass does not see it, the move finder after the flag refresh returns it"`. Then add:

```ts
const refreshed = await refreshFlags({ db: trx, provider: s.fake, now: () => FOLDER_NOW }, s.ctx, s.mailboxId);
expect(refreshed.gone.map((target) => target.emailId)).toEqual([rowId]);
const moves = await findUserMoves({ db: trx, provider: s.fake, now: () => FOLDER_NOW }, s.ctx, s.mailboxId, refreshed.gone);
expect(moves).toEqual({ checked: 1, returned: 1, relocated: 0, retry: 0 });
```

and assert the row: `folder` = `source_folder` = `Oferty`, `uid` = `uid`, `inbox_uid` = `uid`, `returned_at` = `FOLDER_NOW` (use `rowById`). Import `refreshFlags` and `findUserMoves` from `../../src/modules/mail`.

**Check.** `bun test apps/server/test/integration/mail-sync.test.ts`

**Done when.** 8.4 and every other test of the file pass.

**Out of scope.** Tests 8.1, 8.2 (F032 changes them).

## Step 4 — Docs

**Goal.** The capability page, the architecture, the ADR, the module table and the alert list say what the code does now (D16).

**Files.** `docs/capabilities/sync.md`, `docs/architecture.md`, `docs/decisions/0014-sync-provider-sort-folders.md`, `docs/modules.md`, `docs/known-alerts.md`.

- `sync.md` rule 6: after the sentence that ends "both write no flags." add: "The mail that the refresh does not find in its folder goes to the move finder (`findUserMoves`, `moves.ts`): a webmail move keeps the UID at Interia, so it fetches that UID in each enabled synced folder whose cursor is at or above it (not the mail's own folder, not a folder that failed or was skipped in this run; at most 500 UIDs per fetch). A hit with the stored identity that no other identical row holds there is the mail: a row that the system had moved is `returned` (rule 11), any other row is moved to that folder with no feedback. The write runs under the folder lock and only while the row still has the folder and UID that the refresh read; a fresh move marker skips the row. A failure is one `user_moves_failed` warning and never fails the sync."
- `sync.md` rule 11: add at the end: "A return or a move below a synced folder's cursor that the end-of-run check does not cover (another folder than the source, or a mail the system did not move) is found by the move finder of rule 6."
- `sync.md` Limits: remove the line that starts with `` `F064-sync-return-to-other-folder` ``. Add: "A user move of mail received more than 30 days ago into a synced folder below that folder's cursor is not seen (the flag refresh window); a found move shows at the next refresh, at most 10 minutes later."
- `sync.md` Entry points: add rows `function` · `findUserMoves` · `apps/server/src/modules/mail/moves.ts`, and `function` · `listMoveCandidates` · `apps/server/src/modules/mail/repo/copies.ts`. Tests: add `apps/server/test/integration/mail-moves.test.ts`. Data, `emails` line: no change. Update the "Checked against" line to your base commit.
- `architecture.md` §6.1, bullet "Returned below the cursor (D4)": add one line: "Mail that the flag refresh does not find in its folder is looked for at the same UID in the other synced folders below their cursors (the move finder, `mail/moves.ts`; `docs/capabilities/sync.md` rule 6)." Line ~381 ("so S3 has the below-cursor "returned" check (above)"): add "and the move finder".
- ADR 0014 § Known limits, items (a), (f) and (g): append to each "Fixed for mail received in the last 30 days by the move finder (`apps/server/src/modules/mail/moves.ts`)." and remove the "Follow-up: …F064…" sentence of (g). Do not renumber.
- `docs/modules.md` §3, the mail table: a row `moves.ts` | "`findUserMoves`: the flag refresh's gone mail at the same UID in the synced folders below their cursors; writes `returned` or a move between folders under the folder lock". Extend the `sync-rules.ts` row with "`matchMoved`".
- `docs/known-alerts.md`: a new entry `### user_moves_failed` with First seen (the land date, not live), Source (`apps/server/src/modules/mail/jobs.ts`, `[mail]`, level `warn`), Cause (the move finder failed after a good flag refresh: a lost connection, a DB error), Fix (none needed for one line: the next refresh tries again; many lines in a row → read `error_code`, check the IMAP connection of the mailbox), Status `not seen live`.

**Check.** `bun test apps/server/src/capability-map.test.ts` and `bunx prettier --check` on the five files.

**Done when.** The capability-map test passes and the five files are formatted; then the Proof command of `plan.md` (`/tmp/f029-s04`) prints `PROOF_OK`.

**Out of scope.** The F032 lines (Limits line of F032, `architecture.md` line ~344, the "returned below cursor" alert); `docs/roadmap.md`.
