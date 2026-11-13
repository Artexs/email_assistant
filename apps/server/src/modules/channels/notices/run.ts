import { type NoticeKind } from "@ea/core";
import { type Transaction } from "kysely";

import { type DB, type Db, type TenantContext } from "../../../platform/db";
import { describeError } from "../../../platform/errors";
import { createLog } from "../../../platform/log";
import { queueNotice, type QueueNoticeInput } from "../notice-queue";

export const log = createLog("channels");

export const APPROVAL_LIMIT = 50;

export interface NoticeDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  // The process start time (from `main.ts`).
  startedAt: Date;
}

export type DbOrTrx = Db | Transaction<DB>;

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
