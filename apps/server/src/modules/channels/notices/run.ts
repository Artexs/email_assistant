import { type NoticeKind } from "@ea/core";
import { type Transaction } from "kysely";

import { type DB, type Db, type TenantContext } from "../../../platform/db";
import { errorFields } from "../../../platform/errors";
import { createLog } from "../../../platform/log";
import { type MailboxSummary, type TestMailRule } from "../../mail";
import { type LlmPause, type TriageScope } from "../../triage";
import { queueNotice, type QueueNoticeInput } from "../notice-queue";
import { type LinkedChat } from "../port";

export const log = createLog("channels");

export const APPROVAL_LIMIT = 50;

export interface NoticeDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  // The process start time (from `main.ts`).
  startedAt: Date;
  // The LLM pause and the scope of the triage worker of this process (F109 stage 15). Absent: the worker is off, so no
  // `not_triaged` notice.
  degraded?: { pause: Pick<LlmPause, "isPaused" | "pausedSince">; scope: TriageScope };
  testMail: TestMailRule;
  // `WEB_BASE_URL`: the panel link on the approval card needs it (F102 D5). Unset: no link.
  webBaseUrl?: string;
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

// `id` is the row id (a UUID, logged as `item_id`). `dedup` is the once-per-process key when one id has several rows.
export function warnSkipped(kind: string, id: string, error: unknown, dedup: string = id): void {
  const key = `${kind}:${dedup}`;
  if (warnedRows.has(key)) return;
  warnedRows.add(key);
  log.warn("notice_skipped", { kind, item_id: id, ...errorFields(error) });
}

export function inTransaction<T>(db: DbOrTrx, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : (db as Db).transaction().execute(run);
}

export async function queue<K extends NoticeKind>(
  db: DbOrTrx,
  ctx: TenantContext,
  input: Omit<QueueNoticeInput<K>, "now">,
  now: Date
): Promise<boolean> {
  const id = await queueNotice(db, ctx, { ...input, now });
  if (id !== null) log.info("notice_queued", { kind: input.kind, outbox_id: id });
  return id !== null;
}
