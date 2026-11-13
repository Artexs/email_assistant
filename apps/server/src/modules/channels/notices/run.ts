import { type NoticeKind } from "@ea/core";
import { type Transaction } from "kysely";

import { type DB, type Db, type TenantContext } from "../../../platform/db";
import { describeError } from "../../../platform/errors";
import { createLog } from "../../../platform/log";
import { type MailboxSummary } from "../../mail";
import { queueNotice, type QueueNoticeInput } from "../notice-queue";
import { type LinkedChat } from "../port";

export const log = createLog("channels");

export const APPROVAL_LIMIT = 50;

export interface NoticeDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  // The process start time (from `main.ts`).
  startedAt: Date;
}

export type DbOrTrx = Db | Transaction<DB>;

// What one organization's detectors share: read once per tick by `detectForOrg`.
export interface OrgRun {
  deps: NoticeDeps;
  db: DbOrTrx;
  ctx: TenantContext;
  now: Date;
  timeZone: string;
  resumedAt: Date | null;
  members: LinkedChat[];
  owners: LinkedChat[];
  mailboxes: MailboxSummary[];
  pausedMailboxIds: Set<string>;
}

/** One notice source. `kinds` are the outbox kinds it may queue. */
export interface Detector {
  name: string;
  kinds: readonly NoticeKind[];
  detect(run: OrgRun): Promise<void>;
}

// A row that fails every tick warns once per process, not every 15 s.
const warnedRows = new Set<string>();

export function warnSkipped(kind: string, id: string, error: unknown): void {
  const key = `${kind}:${id}`;
  if (warnedRows.has(key)) return;
  warnedRows.add(key);
  log.warn(`notice ${kind} ${id}: skipped: ${describeError(error)}`);
}

export function inTransaction<T>(db: DbOrTrx, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : (db as Db).transaction().execute(run);
}

export async function queue<K extends NoticeKind>(
  db: DbOrTrx,
  ctx: TenantContext,
  input: Omit<QueueNoticeInput<K>, "now">,
  now: Date
): Promise<void> {
  const id = await queueNotice(db, ctx, { ...input, now });
  if (id !== null) log.info(`notice ${input.kind} queued: outbox ${id}`);
}
