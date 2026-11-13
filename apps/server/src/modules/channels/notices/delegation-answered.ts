import { type TenantContext } from "../../../platform/db";
import { listAnsweredUnnotified, markAnsweredNotified } from "../../delegation";
import { getEmailMeta, isSyntheticMessageId } from "../../mail";
import { type LinkedChat } from "../port";

import { APPROVAL_LIMIT, DbOrTrx, inTransaction, queue, warnSkipped, type Detector } from "./run";

// D24: every linked member hears that a delegate answered.
async function detectDelegationAnswered(
  db: DbOrTrx,
  ctx: TenantContext,
  members: LinkedChat[],
  timeZone: string,
  now: Date
): Promise<void> {
  if (members.length === 0) return;
  for (const row of await listAnsweredUnnotified(db, ctx, { limit: APPROVAL_LIMIT })) {
    try {
      const answer = row.answered_email_id === null ? undefined : await getEmailMeta(db, ctx, row.answered_email_id);
      const view = {
        delegationId: row.id,
        delegateName: row.delegate_name,
        subject: row.subject,
        receivedAt: answer?.received_at ?? row.answered_at ?? now,
        now,
        timeZone,
        synthetic: isSyntheticMessageId(answer?.message_id_header ?? null),
      };
      await inTransaction(db, async (trx) => {
        for (const member of members) {
          await queue(
            trx,
            ctx,
            {
              userId: member.userId,
              locale: member.locale,
              kind: "delegation_answered",
              dedupKey: `delegation_answered:${row.id}`,
              // The delegation's own mail: the answer mail can be gone after a retention delete.
              emailId: row.email_id,
              view,
            },
            now
          );
        }
        await markAnsweredNotified(trx, ctx, row.id, now);
      });
    } catch (error) {
      warnSkipped("delegation_answered", row.id, error);
    }
  }
}

export const delegationAnsweredDetector: Detector = {
  name: "delegation-answered",
  kinds: ["delegation_answered"],
  detect: (run) => detectDelegationAnswered(run.db, run.ctx, run.members, run.timeZone, run.now),
};
