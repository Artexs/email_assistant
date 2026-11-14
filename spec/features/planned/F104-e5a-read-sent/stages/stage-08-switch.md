# F104 stage 08 — Switch: setter and connect

Part of [`../plan.md`](../plan.md). **[risky]**: consent to read mail and a delete of stored mail (review before the land). Needs stage 07. Read D2, D5, D11.

After this stage one service function changes "Track my sent mail" (on starts a new first pass, off deletes the stored sent mail), and a new mailbox starts on when the flag is on.

## Step 1 — `setSentSync`

**Files.** `mail/sent-switch.ts` (new), exported by `mail`; `audit/repo.ts`; `mail-sent-switch.test.ts` (new).

**Interfaces.**

```ts
// auditEvents
mailboxSentSyncChanged: "mailbox.sent_sync_changed", // data: mailbox_id, enabled, count (sent rows deleted)

export type SentSwitchResult = "changed" | "same" | "not_found" | "flag_off";
setSentSync(db: Db | Transaction<DB>, ctx, mailboxId, input: { enabled: boolean; actor: string; at: Date })
  : Promise<{ result: SentSwitchResult; deleted: number }>
```

One transaction:

1. `enabled: true` and the flag off → `flag_off`. Off never checks the flag (review 1, M3).
2. No mailbox → `not_found`.
3. Lock the state row; none → `insertSentSyncState(off)` and lock again (an older mailbox has no row).
4. Same value → `same`.
5. `writeSentSwitch`; when off, `deleted = deleteSentEmails`.
6. `recordAudit` `mailbox.sent_sync_changed` `{ mailbox_id, enabled, count: deleted }` with the actor and `at`.
7. `changed`.

The event is not added to the security log registry (`packages/core/src/security-log.ts`; Q12). The pass's guard takes the same row lock (D5).

**Test** (`AT = 2026-11-20T10:00:00Z`, flag on unless said):

1. No state row, on → `changed`; on with `enabled_at AT`; one audit row `{ mailbox_id, enabled: true, count: 0 }` with the actor.
2. Again → `same`, no second audit row.
3. On with a cursor, a first pass and 3 sent rows; off → `changed`, `deleted 3`; no sent row left; state clean; audit `count: 3`; another mailbox's rows stay.
4. Off → on at `AT + 1 h` → `enabled_at AT + 1 h`, cursor null; `syncSentHeaders` on a fake with one mail → `initial`.
5. Flag off: on → `flag_off`, nothing written; off over an enabled row with 2 sent rows → `changed`, `deleted 2`, audit row.
6. Unknown id, and org A's mailbox in org B's context → `not_found`; org A unchanged.
7. A pass whose `sentOriginOf` hook calls `setSentSync(off)` → the pass returns `cursor_moved`; no sent row afterwards.

## Step 2 — Connect sets the switch

**Files.** `mail/connect.ts`, `scripts/mailbox-connect.ts`, `mail-connect.test.ts`.

**Interfaces.**
- `connectMailbox` reads `isFeatureOn(…, "sent_sync")` before its transaction and inserts the state row in it with that value. The `mailbox.connected` audit data gains `sent_sync: <boolean>`. The return value gains `sentSync: boolean`.
- `mailbox-connect.ts`: when `sentSync`, one more line after `connected mailbox <id>`: `sent mail: tracked, read only`. Stage 09 adds the off command to it.

**Test.**

1. Flag on → state row on, audit `sent_sync: true`, result `sentSync: true`.
2. Flag off → state row off, `sent_sync: false`.
3. A failed IMAP login → no state row.

Existing connect cases pass (update an expected audit `data` object).

## Step 3 — Docs

- `docs/capabilities/sent-mail.md`: rules for the switch and connect; entry point `setSentSync`.
- `docs/capabilities/sync.md` rule 1: the connect transaction also inserts the Sent switch row.
- `docs/architecture.md` §5 `audit_log` row: the new event.

**Test.** `capability-map.test.ts` passes.

## Done when

Steps 1–3 done; the Proof passes (`/tmp/f104-s08`).
