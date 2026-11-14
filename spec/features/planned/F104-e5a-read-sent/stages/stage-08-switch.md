# F104 stage 08 — Switch: setter and connect

Part of [`../plan.md`](../plan.md). **[risky]**: consent to read the user's mail and a delete of stored mail (review job before the land). Needs stage 07 on `master`. Read D2, D5, D11 first.

After this stage the owner's choice "Track my sent mail" can be changed by one service function (on starts a new first pass, off deletes the stored sent mail), and a new mailbox starts on when the organization flag is on.

## Step 1 — `setSentSync`

**Goal.** One transaction that changes the switch, deletes on off, and writes the audit row (D11).

**Files.** `apps/server/src/modules/mail/sent-switch.ts` (new), `apps/server/src/modules/mail/index.ts`, `apps/server/src/modules/audit/repo.ts` (`auditEvents`), `apps/server/test/integration/mail-sent-switch.test.ts` (new).

**Interfaces.**

```ts
// audit/repo.ts, next to mailboxSyncFolderChanged:
mailboxSentSyncChanged: "mailbox.sent_sync_changed", // data: mailbox_id, enabled, count (sent rows deleted)

// sent-switch.ts
export type SentSwitchResult = "changed" | "same" | "not_found" | "flag_off";

export async function setSentSync(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  input: { enabled: boolean; actor: string; at: Date }
): Promise<{ result: SentSwitchResult; deleted: number }>;
```

In one transaction (`db.isTransaction ? run(db) : db.transaction().execute(run)`):

1. `isFeatureOn(trx, ctx, "sent_sync")` false → `{ result: "flag_off", deleted: 0 }`.
2. `getMailbox(trx, ctx, mailboxId)` undefined → `not_found`.
3. `locked = await lockSentSyncState(trx, ctx, mailboxId)`; undefined → `insertSentSyncState(trx, ctx, mailboxId, { enabled: false })`, then lock again (an older mailbox has no row; the insert is `ON CONFLICT DO NOTHING`, so a parallel setter is safe).
4. `locked.enabled === input.enabled` → `same`.
5. `writeSentSwitch(trx, ctx, mailboxId, { enabled: input.enabled, at: input.at })`; when `enabled` is false: `deleted = await deleteSentEmails(trx, ctx, mailboxId)`.
6. `recordAudit(trx, ctx, { actor: input.actor, event: auditEvents.mailboxSentSyncChanged, data: { mailbox_id: mailboxId, enabled: input.enabled, count: deleted }, at: input.at })`.
7. `{ result: "changed", deleted }`.

The pass's guard (stage 04, D5) takes the same row lock, so a pass that runs during the change writes nothing of the old period.

**Decisions.** D2, D5, D11; Q1 (off deletes).

**Test** (integration, `withRollback`, two orgs, `AT = 2026-11-20T10:00:00Z`, flag on by `upsertOrgFeature` unless the case says off):

1. A mailbox with no state row, `enabled: true` → `changed`; the row is on with `enabled_at = AT`; one audit row `mailbox.sent_sync_changed` with `{ mailbox_id, enabled: true, count: 0 }` and `actor`.
2. The same call again → `same`, no second audit row.
3. On with a cursor, `first_pass_at` and 3 sent rows (inserted with `insertSentEmails`) → `enabled: false` → `changed`, `deleted 3`; no sent row of the mailbox; the state is off and clean; the audit row has `count: 3`. Another mailbox's sent rows stay.
4. Off → on again at `AT + 1 h` → `enabled_at = AT + 1 h`, cursor null (the next pass is a first pass: run `syncSentHeaders` on a fake with one mail and see `mode "initial"`).
5. Flag off → `flag_off`, no row change, no audit row.
6. Unknown mailbox id, and org A's mailbox in org B's context → `not_found`, nothing written in org A.
7. A pass during the switch: a stage-04 style `deps.isOwnActionId` hook that calls `setSentSync({ enabled: false })` → the pass returns `cursor_moved`, and after it no sent row exists.

**Check.** `bun test apps/server/test/integration/mail-sent-switch.test.ts`

**Done when.** Cases 1–7 pass.

**Out of scope.** The route, the view, the CLI (stage 09); the panel (stage 10).

## Step 2 — Connect sets the switch

**Goal.** A new mailbox starts on when the flag is on, off when it is off; the connect audit row records it (D11, Q3).

**Files.** `apps/server/src/modules/mail/connect.ts`, `apps/server/src/scripts/mailbox-connect.ts` (one output line), `apps/server/test/integration/mail-connect.test.ts`.

**Interfaces.**

- `connectMailbox`: before the transaction (after the SMTP check), `const sentSync = await isFeatureOn(deps.db, ctx, "sent_sync")`. Inside `run`, after `insertDefaultSettings`: `await insertSentSyncState(trx, ctx, mailboxId, { enabled: sentSync })`. The `mailbox.connected` audit data becomes `{ mailbox_id: mailboxId, via: meta.via, sent_sync: sentSync }`. The return value gains `sentSync: boolean`: `{ mailboxId, info, sentSync }`. Callers that destructure stay valid.
- `mailbox-connect.ts`: after the line `connected mailbox <id>`, when `sentSync` is true, one more line in the same form as its neighbours: `sent mail: tracked, read only (turn off: bun run mailbox:settings sent-sync --org-id <org> --mailbox-id <id> --value off)`.

**Decisions.** D11; Q3.

**Test** (`mail-connect.test.ts`, the fake provider path the file uses):

1. Flag on → a `mailbox_sent_sync` row with `enabled` true and `enabled_at` set; the audit data has `sent_sync: true`; the result has `sentSync: true`.
2. Flag off → the row with `enabled` false; `sent_sync: false`.
3. A failed IMAP login → no `mailbox_sent_sync` row (nothing is stored, as before).

**Check.** `bun test apps/server/test/integration/mail-connect.test.ts`

**Done when.** Cases 1–3 pass; the existing connect cases pass (update an expected audit `data` object where a case lists it whole).

**Out of scope.** The web dialog line (stage 10).

## Step 3 — Docs

**Files.** `docs/capabilities/sent-mail.md`, `docs/capabilities/sync.md` (rule 1, the connect transaction: "… the default settings, the Sent switch row (on when the flag `sent_sync` is on) and the audit row `mailbox.connected`"), `docs/architecture.md` §5 `audit_log` row (add `mailbox.sent_sync_changed` to the event list).

`sent-mail.md`: rules for the switch (on, off deletes, the audit row, the lock shared with the pass, flag off refuses) and for connect; Entry points row `setSentSync` → `apps/server/src/modules/mail/sent-switch.ts`.

**Check.** `bun test apps/server/src/capability-map.test.ts`

## Done when (stage)

Steps 1–3 done; the Proof command of `plan.md` passes (`/tmp/f104-s08`).
