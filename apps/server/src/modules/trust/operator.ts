import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { getMailbox } from "../mail";
import { isOrgSuspended } from "../tenancy";

import { latestHistoryCheck, queueHistoryCheck, type HistoryCheckStatus } from "./repo";

export type OperatorQueueResult =
  | { kind: "queued"; checkId: string; status: HistoryCheckStatus }
  | { kind: "open"; checkId: string; status: HistoryCheckStatus }
  | { kind: "org_suspended" }
  | { kind: "mailbox_not_found" };

/**
 * `bun run trust:history-check`: queues a check with the reason `cli` for one mailbox. It does not read the flag `trust_ladder`: an
 * operator asks for the check by hand, and the history job decides whether it runs. A check that is open already is the answer
 * (`open`): the operator sees its id and status, and no second row exists.
 */
export async function queueHistoryCheckByOperator(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string
): Promise<OperatorQueueResult> {
  if ((await getMailbox(db, ctx, mailboxId)) === undefined) return { kind: "mailbox_not_found" };
  if (await isOrgSuspended(db, ctx)) return { kind: "org_suspended" };
  const id = await queueHistoryCheck(db, ctx, mailboxId, "cli");
  // A second caller that lost the unique index finds the check of the first. A check that ended in between is the newest one then.
  const latest = await latestHistoryCheck(db, ctx, mailboxId);
  if (latest === null) throw new Error("history check not found after queue");
  return id === null
    ? { kind: "open", checkId: latest.id, status: latest.status }
    : { kind: "queued", checkId: id, status: latest.status };
}
