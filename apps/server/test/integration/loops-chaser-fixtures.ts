import { randomUUID } from "node:crypto";

import { sql, type Insertable, type Transaction } from "kysely";

import { runLoopChaser, type LoopChaserResult } from "../../src/modules/loops";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { insertDelegate } from "./fixtures";
import { commandLoop, type CommandOrg } from "./loops-commands-fixtures";
import { insertLoopActionPair } from "./loops-fixtures";

// Rows for the tests of the one chaser. The clock is Friday 2026-11-20 07:31 in Warsaw (06:31 UTC, CET);
// the organization time zone is Europe/Warsaw. A loop is "due yesterday" at Thursday 17:00 Warsaw.

export { DAY_MS } from "@ea/core";
export const NOW = new Date("2026-11-20T06:31:00Z");
export const BEFORE_GATE = new Date("2026-11-20T06:29:00Z");
export const DUE_YESTERDAY = new Date("2026-11-19T16:00:00Z");

type Conn = Db | Transaction<DB>;

// One run of the chaser for the mailbox of `org` at `now`. In a rolled-back transaction the run joins it.
export function chase(
  conn: Conn,
  org: { ctx: TenantContext; mailboxId: string },
  now: Date = NOW,
  opts: { force?: boolean } = {}
): Promise<LoopChaserResult> {
  return runLoopChaser({ db: conn, now: () => now }, org.ctx, org.mailboxId, { now, ...opts });
}

// A `delegated` loop: its delegate, the delegate address as the one recipient and the counterpart.
export async function delegatedLoop(
  trx: Transaction<DB>,
  org: CommandOrg,
  over: Partial<Insertable<DB["open_loops"]>> & { delegateActive?: boolean } = {}
): Promise<{ id: string; sentId: string; threadKey: string; delegateId: string; delegateEmail: string }> {
  const { delegateActive, ...rest } = over;
  const delegateEmail = `delegate-${randomUUID()}@x.test`;
  const delegateId = await insertDelegate(trx, org.ctx, { name: "Anna", email: delegateEmail, active: delegateActive });
  const made = await commandLoop(trx, org, {
    kind: "delegated",
    delegate_id: delegateId,
    to_addresses: [delegateEmail],
    cc_addresses: [],
    counterpart: delegateEmail,
    due_at: DUE_YESTERDAY,
    ...rest,
  });
  return { ...made, delegateId, delegateEmail };
}

export const dueLoop = (trx: Transaction<DB>, org: CommandOrg, over: Partial<Insertable<DB["open_loops"]>> = {}) =>
  commandLoop(trx, org, { due_at: DUE_YESTERDAY, ...over });

// The raw switch `auto_follow_up`: the core schema of the tool switches does not hold it yet, so the helper writes JSON.
export async function setAutoFollowUp(conn: Conn, org: { ctx: TenantContext; mailboxId: string }, on: boolean) {
  await sql`update mailbox_settings
    set tool_switches = tool_switches || ${JSON.stringify({ auto_follow_up: on })}::jsonb, updated_at = clock_timestamp()
    where org_id = ${org.ctx.orgId} and mailbox_id = ${org.mailboxId}`.execute(conn);
}

// A follow-up send of a loop in a given state, with the key shape of the real planner.
export async function priorFollowUp(
  trx: Transaction<DB>,
  org: CommandOrg,
  loopId: string,
  opts: { status: string; reason?: string; n?: 1 | 2; k?: number }
): Promise<{ draftId: string; sendId: string }> {
  const n = opts.n ?? 1;
  const k = opts.k ?? 1;
  return insertLoopActionPair(trx, org.ctx, loopId, {
    sendStatus: opts.status,
    draftStatus: "applied",
    draft: { idempotency_key: `${loopId}:create_draft:follow_up:${n}:${k}` },
    send: {
      idempotency_key: `${loopId}:send:follow_up:${n}:${k}`,
      ...(opts.reason === undefined ? {} : { status_reason: opts.reason }),
    },
  });
}

export const loopSends = (conn: Conn, orgId: string) =>
  conn
    .selectFrom("actions")
    .select(["id", "loop_id", "type", "status", "status_reason", "idempotency_key", "payload"])
    .where("org_id", "=", orgId)
    .where("loop_id", "is not", null)
    .where("type", "=", "send")
    .orderBy("idempotency_key")
    .execute();

export const markers = (conn: Conn, orgId: string, event: string) =>
  conn.selectFrom("audit_log").selectAll().where("org_id", "=", orgId).where("event", "=", event).execute();

// The same switch with any JSON value (the rule is "only a JSON true counts").
export async function setAutoFollowUpRaw(conn: Conn, org: { ctx: TenantContext; mailboxId: string }, value: unknown) {
  await sql`update mailbox_settings
    set tool_switches = tool_switches || jsonb_build_object('auto_follow_up', ${JSON.stringify(value)}::jsonb),
      updated_at = clock_timestamp()
    where org_id = ${org.ctx.orgId} and mailbox_id = ${org.mailboxId}`.execute(conn);
}
