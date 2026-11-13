import { draftPayloadSchema, type DraftPayload } from "@ea/core";

import { type TenantContext } from "../../../platform/db";
import { getDraft, listSetsToNotify, markNotified } from "../../actions";
import { getDelegation } from "../../delegation";
import { type LinkedChat } from "../port";

import { APPROVAL_LIMIT, DbOrTrx, inTransaction, queue, warnSkipped, type Detector } from "./run";

// D21: one request per owner for a whole reminder set.
async function detectApprovalSets(
  db: DbOrTrx,
  ctx: TenantContext,
  owners: LinkedChat[],
  timeZone: string,
  now: Date
): Promise<void> {
  if (owners.length === 0) return;
  for (const [setId, sends] of await listSetsToNotify(db, ctx, { limit: APPROVAL_LIMIT })) {
    try {
      const first = sends[0];
      if (first === undefined) continue;
      const items = [];
      for (const [index, send] of sends.entries()) {
        const draftRow =
          send.depends_on_action_id === null ? undefined : await getDraft(db, ctx, send.depends_on_action_id);
        if (draftRow === undefined) throw new Error("draft not found");
        const draft: DraftPayload = draftPayloadSchema.parse(draftRow.payload);
        if (draft.kind !== "reminder") throw new Error("set draft is not a reminder");
        const delegation = await getDelegation(db, ctx, draft.delegation_id);
        items.push({
          n: index + 1,
          delegateName: draft.delegate_name,
          address: draft.to[0] ?? "",
          subject: send.email.subject,
          dueAt: delegation?.due_at ?? null,
          reminder: draft.reminder,
          task: draft.task,
        });
      }
      const noticeView = { setId, items, timeZone };
      await inTransaction(db, async (trx) => {
        for (const owner of owners) {
          await queue(
            trx,
            ctx,
            {
              userId: owner.userId,
              locale: owner.locale,
              kind: "approval_set",
              dedupKey: `approval_set:${setId}`,
              emailId: first.email_id,
              view: noticeView,
            },
            now
          );
        }
        for (const send of sends) await markNotified(trx, ctx, send.id, now);
      });
    } catch (error) {
      warnSkipped("approval_set", setId, error);
    }
  }
}

export const approvalSetDetector: Detector = {
  name: "approval-set",
  kinds: ["approval_set"],
  detect: (run) => detectApprovalSets(run.db, run.ctx, run.owners, run.timeZone, run.now),
};
