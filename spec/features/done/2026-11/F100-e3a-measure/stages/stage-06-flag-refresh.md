# F100 stage 06 — Flag refresh in the sync run

Part of [`../plan.md`](../plan.md). **[risky]**: writes about the wrong mail would poison M1 and the E4-B history check. Review job before the land. Needs stage 05 on `master` (same files).

After this stage the sync job reads the IMAP flags of the mailbox's recent mail on its own connection, at most every 10 min per mailbox, and keeps them in `email_flags` with the first time each flag was seen (D6).

## Step 1 — Repository

**Goal.** List the mail to check and write flags with a guard on the location.

**Files.** `apps/server/src/modules/mail/repo/flags.ts` (new), `mail/repo/index.ts`, `mail/index.ts`, `apps/server/test/integration/mail-flags-repo.test.ts` (new).

**Interfaces.**

```ts
export interface FlagTarget {
  emailId: string;
  folder: string; // emails.folder (the path)
  uid: number; // emails.uid
  messageId: string | null; // emails.message_id_header
  receivedAt: Date; // emails.received_at (INTERNALDATE)
}

/** Mail of the mailbox received at or after `since`, never-checked first, then the oldest `checked_at`, then `received_at`. */
export async function listFlagTargets(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date; limit: number }
): Promise<FlagTarget[]>;

export interface FlagRead extends FlagTarget {
  seen: boolean;
  answered: boolean;
  flagged: boolean;
}

/** Upserts one row per read, only while `emails.folder` and `emails.uid` still equal the read's. Returns the rows written. */
export async function writeEmailFlags(db: DbOrTrx, ctx: TenantContext, reads: FlagRead[], at: Date): Promise<number>;

export interface EmailFlagsRow {
  emailId: string;
  seen: boolean;
  answered: boolean;
  flagged: boolean;
  firstSeenAt: Date | null;
  firstAnsweredAt: Date | null;
  firstFlaggedAt: Date | null;
  checkedAt: Date;
  answeredCheck: "yes" | "no" | null;
}
export async function getEmailFlags(db: DbOrTrx, ctx: TenantContext, emailId: string): Promise<EmailFlagsRow | undefined>;
```

`writeEmailFlags`: one statement per chunk of up to 500 reads: `INSERT INTO email_flags (email_id, org_id, seen, answered, flagged, first_seen_at, first_answered_at, first_flagged_at, checked_at) SELECT e.id, e.org_id, r.seen, r.answered, r.flagged, CASE WHEN r.seen THEN $at END, CASE WHEN r.answered THEN $at END, CASE WHEN r.flagged THEN $at END, $at FROM emails e JOIN (VALUES …) r(email_id, folder, uid, seen, answered, flagged) ON e.id = r.email_id::uuid AND e.folder = r.folder AND e.uid = r.uid::bigint WHERE e.org_id = $org ON CONFLICT (email_id) DO UPDATE SET seen = excluded.seen, answered = excluded.answered, flagged = excluded.flagged, first_seen_at = COALESCE(email_flags.first_seen_at, excluded.first_seen_at), first_answered_at = COALESCE(email_flags.first_answered_at, excluded.first_answered_at), first_flagged_at = COALESCE(email_flags.first_flagged_at, excluded.first_flagged_at), checked_at = excluded.checked_at` — every value a bound parameter (Kysely `sql` with `sql.join`), never string concatenation. The `answered_check` columns are never touched here.

**Decisions.** D6.

**Test** (integration, `withRollback`, two orgs, `at` fixed):

1. 3 mails received in the window, one older → `listFlagTargets({ since, limit: 10 })` returns the 3, with `folder` and `uid`.
2. After `writeEmailFlags` of mail 1 at `t1`, `listFlagTargets` lists mails 2 and 3 first (never checked), then mail 1.
3. `writeEmailFlags` of a read with `answered: true` at `t1`, then `answered: false` at `t2`, then `true` at `t3` → `answered = true`, `first_answered_at = t1`.
4. A read whose `uid` differs from the row's `uid` (the mail moved) → 0 written, no row.
5. Org B's context with org A's reads → 0 written; `listFlagTargets` in org B's context with org A's mailbox id → `[]`.
6. A row with `answered_check = 'yes'` set by hand keeps it after a `writeEmailFlags`.

**Check.** `bun test apps/server/test/integration/mail-flags-repo.test.ts`

**Done when.** Cases 1–6 pass.

**Out of scope.** The answered check writes (stage 15).

## Step 2 — Refresh in the sync run

**Goal.** One refresh per mailbox at most every 10 min, on the sync's connection; a failure never fails the sync (D6).

**Files.** `apps/server/src/modules/mail/flags.ts` (new: `refreshFlags`), `apps/server/src/modules/mail/jobs.ts` (`syncOne`, `createMailSyncJob`), `apps/server/src/platform/log-fields.ts` (only if a field is new), `apps/server/test/integration/mail-flags.test.ts` (new), `apps/server/test/integration/mail-jobs.test.ts` (one case), `docs/capabilities/sync.md` (rule 6 "The `mail.sync` job" gains the flag refresh: on the same connection after a good run, at most every 10 min per mailbox and process, mail of the last 30 days, at most 3,000 per run, the guarded write by folder, UID and identity, a failure is one `flags_refresh_failed` line and never fails the sync; the first rule "Sync only reads the mailbox" stays true: the refresh only reads FLAGS; Entry points: a `function` row `refreshFlags` → `apps/server/src/modules/mail/flags.ts` and `listFlagTargets`, `writeEmailFlags`, `getEmailFlags` → `apps/server/src/modules/mail/repo/flags.ts`; Data: `email_flags`; refresh the "Checked against" line).

**Interfaces.**

```ts
export const FLAGS_REFRESH_EVERY_MS = 10 * 60_000;
export const FLAGS_WINDOW_MS = 30 * 24 * 3_600_000;
export const FLAGS_RUN_LIMIT = 3_000;
export const FLAGS_CHUNK = 500;

export async function refreshFlags(
  deps: { db: Db | Transaction<DB>; provider: MailProvider; now(): Date },
  ctx: TenantContext,
  mailboxId: string
): Promise<{ checked: number; written: number; notFound: number; mismatch: number }>;
```

- `refreshFlags`: `listFlagTargets(since = now − 30 days, limit = 3,000)`; group by `folder`; per folder, chunks of 500 UIDs: `provider.fetchFlagsIn(folder, uids)`; map each returned uid back to its target (a uid returned for no target is ignored; a target with no returned uid counts in `notFound`). Identity check before a write (cold review N3: after a UIDVALIDITY change the rescan updates only the last 7 days, so an older row can hold a UID that now names another mail): when both the target's `messageId` and the returned `messageId` are set, `normalizeMessageId` of both must be equal; else the returned `internalDate` must equal `receivedAt` to the second; a mismatch counts in `mismatch` and writes nothing; `writeEmailFlags(reads, now)` per chunk (no transaction around chunks: each chunk is consistent on its own). Flags by exact name: `\Seen`, `\Answered`, `\Flagged` (case-insensitive compare).
- `createMailSyncJob` keeps `const lastFlagsAt = new Map<string, number>()` next to `failures`. In `syncOne`, after `syncMailbox` and `markSynced` and before `provider.close()`: when `now − (lastFlagsAt.get(mailboxId) ?? 0) ≥ FLAGS_REFRESH_EVERY_MS`, set `lastFlagsAt` to now first, then `try { const r = await refreshFlags(…); log.info("flags_refreshed", { mailbox_id, count: r.written }) } catch (error) { log.warn("flags_refresh_failed", { mailbox_id, ...errorFields(error) }) }`. A `MailAuthError` here is also only logged (the next sync run finds it).

**Decisions.** D6, D30.

**Test** (integration, fake provider through the job's `openProvider`, `now` controlled):

1. First run of the job with 2 stored INBOX mails (fake flags: mail 1 `\Seen \Answered`) → 2 `email_flags` rows; mail 1 `answered = true`, `first_answered_at = now`.
2. A second run 2 min later → no refresh (the `checked_at` values are unchanged); a run 10 min after the first → refresh (`checked_at` moves).
3. A mail moved by the user to another folder in the fake (`userMove` helper), its row still on the old folder and UID → `notFound = 1`, its row unchanged.
4. A provider whose `fetchFlagsIn` throws `SoftError` → the sync result is stored and `markSynced` ran; a `flags_refresh_failed` line (assert with the log capture helper the tests use, by event code only).
5. 2 mailboxes of 2 orgs in one run → each gets its own rows; no row of org A in org B.
6. A stored row whose `uid` is set (in the test) to the UID of another fake mail with a different Message-ID → `mismatch = 1`, no `email_flags` row for it.

**Check.** `bun test apps/server/test/integration/mail-flags.test.ts apps/server/test/integration/mail-jobs.test.ts apps/server/src/capability-map.test.ts`

**Done when.** Cases 1–6 pass; the existing job tests pass unchanged.

**Out of scope.** Flags in `fetchAbove`; CONDSTORE (Interia has none, plan F2).

## Done when (stage)

Steps 1–2 done; the Proof command of `plan.md` passes (`/tmp/f100-s06`).
