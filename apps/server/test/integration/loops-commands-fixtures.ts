import { randomUUID } from "node:crypto";

import type { Insertable, Transaction } from "kysely";

import { updateMailboxSettings } from "../../src/modules/config";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import type { DB } from "../../src/platform/db";

import { insertDelegate } from "./fixtures";
import { insertLoopRow, insertSentRow } from "./loops-fixtures";
import { loopsOrg } from "./loops-match-fixtures";
import type { Org } from "./mail-sent-fixtures";

// Rows for the tests of the loop commands (F116 stage 14). The clock is Friday 2026-11-20 09:00 in Warsaw (08:00 UTC);
// the organization time zone is Europe/Warsaw.

export const FRIDAY = new Date("2026-11-20T08:00:00Z");
export const ANNA = "anna@example.test";
export const JAN = "jan@example.test";
const SWITCHES = { move: false, mark_read: false, flag: false, create_draft: true, move_unsure: false };

export interface CommandOrg extends Org {
  // A member that is not an owner.
  memberId: string;
}

// An organization with the flag `open_loops`, the Sent tracking on, an `assist` mailbox with drafts on, and one assistant.
export async function commandOrg(
  trx: Transaction<DB>,
  opts: { mode?: "assist" | "shadow"; createDraft?: boolean; loopsFlag?: boolean } = {}
): Promise<CommandOrg> {
  const org = await loopsOrg(trx, { loopsFlag: opts.loopsFlag });
  await updateMailboxSettings(trx, org.ctx, org.mailboxId, {
    mode: opts.mode ?? "assist",
    toolSwitches: { ...SWITCHES, create_draft: opts.createDraft ?? true },
  });
  const user = await insertUser(trx, { email: `member-${randomUUID()}@x.test`, displayName: "Member", locale: "en" });
  await insertMembership(trx, org.ctx, { userId: user.id, role: "assistant" });
  return { ...org, memberId: user.id };
}

// An open loop with its opening Sent mail (the text stays stored). To anna, Cc jan; the last wait began on Wednesday.
export async function commandLoop(
  trx: Transaction<DB>,
  org: Org,
  over: Partial<Insertable<DB["open_loops"]>> = {}
): Promise<{ id: string; sentId: string; threadKey: string }> {
  const sentId = await insertSentRow(trx, org.ctx, org.mailboxId, {
    toAddresses: [ANNA],
    ccAddresses: [JAN],
    subject: "Offer Q1",
  });
  const threadKey = `<root-${randomUUID()}@own.test>`;
  // A delegated loop names its delegate (a table check).
  const delegateId =
    over.kind === "delegated" && over.delegate_id === undefined
      ? await insertDelegate(trx, org.ctx, { name: "Anna", email: `delegate-${randomUUID()}@x.test` })
      : over.delegate_id;
  const id = await insertLoopRow(trx, org.ctx, org.mailboxId, {
    sent_email_id: sentId,
    thread_key: threadKey,
    message_id: `<own-${randomUUID()}@own.test>`,
    subject: "Offer Q1",
    to_addresses: [ANNA],
    cc_addresses: [JAN],
    counterpart: ANNA,
    wait_from_at: new Date("2026-11-18T08:00:00Z"),
    due_at: new Date("2026-11-23T16:00:00Z"),
    ...over,
    ...(delegateId === undefined ? {} : { delegate_id: delegateId }),
  });
  return { id, sentId, threadKey };
}

export const loopOf = (conn: Pick<Transaction<DB>, "selectFrom">, id: string) =>
  conn.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

export const actionsOfLoop = (conn: Pick<Transaction<DB>, "selectFrom">, loopId: string) =>
  conn
    .selectFrom("actions")
    .select(["id", "type", "status", "email_id", "loop_id", "idempotency_key", "payload", "status_reason"])
    .where("loop_id", "=", loopId)
    .orderBy("type")
    .execute();

export const auditOf = (conn: Pick<Transaction<DB>, "selectFrom">, orgId: string, event: string) =>
  conn.selectFrom("audit_log").selectAll().where("org_id", "=", orgId).where("event", "=", event).execute();
