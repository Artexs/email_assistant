import { HOUR_MS } from "@ea/core";
import type { Insertable, Transaction } from "kysely";

import { upsertOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { insertDelegate } from "./fixtures";
import { insertLoopActionPair, insertLoopRow } from "./loops-fixtures";
import type { SeededWeek } from "./metrics-fixtures";

// Loops for the seeded week of the metric tests. The week is 2026-11-16 (Warsaw, UTC+1); the loops are
// due on Wednesday 11-18 at 10:00 local (09:00Z), so the deadline is Thursday 11-19 at 10:00 local (09:00Z).

export const DUE = new Date("2026-11-18T09:00:00Z");

type Org = SeededWeek["orgA"];

export const flagLoops = (conn: Parameters<typeof upsertOrgFeature>[0], org: Pick<Org, "ctx">, enabled: boolean) =>
  upsertOrgFeature(conn, org.ctx, {
    flag: "open_loops",
    enabled,
    setBy: "test",
    setAt: new Date("2026-11-24T10:00:00Z"),
  });

const closed = (reason: string, at: Date): Partial<Insertable<DB["open_loops"]>> => ({
  status: "closed",
  close_reason: reason,
  closed_at: at,
});

// Counted rows: a waiting loop closed on time (replied), a promised loop surfaced but not closed, a delegated loop with
// an applied follow-up before the deadline. Not counted: a dropped loop, a loop with a synthetic Message-ID, a loop whose
// counterpart is a test sender is left to the caller. One late reply makes a due loop that is neither closed nor surfaced.
// `due` (default `DUE`) must be a Wednesday 10:00 local, so that the deadline is Thursday 10:00 local, 24 hours later.
export async function seedLoops(trx: Transaction<DB>, org: Org, due: Date = DUE): Promise<{ delegated: string }> {
  const BEFORE_DEADLINE = new Date(due.getTime() + 23 * HOUR_MS);
  const AFTER_DEADLINE = new Date(due.getTime() + 27 * HOUR_MS);
  const { ctx, mailboxId } = org;
  const row = (over: Partial<Insertable<DB["open_loops"]>>) =>
    insertLoopRow(trx, ctx, mailboxId, { due_at: due, ...over });
  await row({ kind: "waiting", ...closed("replied", BEFORE_DEADLINE) });
  await row({ kind: "promised", surfaced_at: new Date(due.getTime() - 2 * HOUR_MS) });
  await row({ kind: "waiting", ...closed("replied", AFTER_DEADLINE) });
  await row({ kind: "waiting", ...closed("dropped", BEFORE_DEADLINE) });
  await row({ kind: "waiting", message_id: "<seed-1@ea-seed.test>" });
  const delegateId = await insertDelegate(trx, ctx, { email: `delegate-m2@x.test` });
  const delegated = await row({
    kind: "delegated",
    delegate_id: delegateId,
    counterpart: "delegate-m2@x.test",
    to_addresses: ["delegate-m2@x.test"],
  });
  await insertLoopActionPair(trx, ctx, delegated, {
    draftStatus: "applied",
    sendStatus: "applied",
    createdAt: BEFORE_DEADLINE,
    send: { approved_at: BEFORE_DEADLINE, approved_by: org.ownerId, approved_via: "telegram" },
  });
  return { delegated };
}
