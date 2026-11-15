import { type TenantContext } from "../../../platform/db";
import { queueCardEdits } from "../card-edits";
import { listClosedFollowUpCards } from "../card-edits-repo";

import { APPROVAL_LIMIT, DbOrTrx, inTransaction, warnSkipped, type Detector } from "./run";

// A follow-up whose loop closed ends `expired` / `loop_closed` with no approval hook (the committer, the switch-off of "Track my sent
// mail" and the close rules end a send directly), so its card would keep the Send and Reject buttons. This detector finds such sends
// and queues the card edit (`approval_edit`, outcome `expired`) once per card: the dedup key `approval_edit:<card>:expired` keeps it single.
// A card that no sender took yet is cancelled instead (`queueCardEdits`).
async function detectClosedFollowUps(db: DbOrTrx, ctx: TenantContext): Promise<void> {
  for (const { sendId, endedAt } of await listClosedFollowUpCards(db, ctx, { limit: APPROVAL_LIMIT })) {
    try {
      await inTransaction(db, async (trx) => {
        await queueCardEdits(trx, ctx, { outcome: "expired", sendId, at: endedAt });
      });
    } catch (error) {
      warnSkipped("approval_edit", sendId, error);
    }
  }
}

// `kinds` is empty on purpose: the kind `approval_edit` has one producer in `queuedBy` (`card-edits.ts`, the same `queueCardEdits`).
export const followUpClosedDetector: Detector = {
  name: "follow-up-closed",
  kinds: [],
  detect: (run) => detectClosedFollowUps(run.db, run.ctx),
};
