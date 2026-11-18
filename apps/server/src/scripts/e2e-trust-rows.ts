import type { TenantContext } from "../platform/db";
import type { Db } from "../platform/db";

import { inTransaction } from "./e2e-activity-rows";

// F110 stage 13: the trust rows of the autonomy card spec. A `done` history check that finished an hour ago: `info` and `notification`
// pass, `spam` fails (6 of 60 acted-on mails would have moved), and an active trip on `info` (two corrections). Together with the gate
// fixture folder (`apps/web/e2e/gate-fixture/`, all three categories `go`), the card shows: `notification` eligible, `spam` blocked by
// the history, `info` paused. The rows hold counts only; no mail is seeded.
const HOUR_MS = 3_600_000;

const entry = { acted: 60, total: 200, wouldMove: 40 };

export async function seedTrustRows(db: Db, ctx: TenantContext, mailboxId: string, now: Date): Promise<void> {
  const finishedAt = new Date(now.getTime() - HOUR_MS);
  const result = {
    info: { ...entry, outcome: "pass", moved: 0, upper: 0.0602 },
    notification: { ...entry, outcome: "pass", moved: 0, upper: 0.0602 },
    spam: { ...entry, outcome: "fail", moved: 6, upper: 0.2 },
  };
  await inTransaction(db, async (trx) => {
    await trx
      .insertInto("history_checks")
      .values({
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        reason: "connect",
        status: "done",
        result: JSON.stringify(result),
        created_at: new Date(finishedAt.getTime() - HOUR_MS),
        finished_at: finishedAt,
      })
      .execute();
    await trx
      .insertInto("autonomy_trips")
      .values({
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        category: "info",
        granted_at: new Date(now.getTime() - 5 * 24 * HOUR_MS),
        reason: "corrections",
        counts: JSON.stringify({ corrections: 2 }),
      })
      .execute();
  });
}
