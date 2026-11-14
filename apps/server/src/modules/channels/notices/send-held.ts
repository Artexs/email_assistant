import { sendLimitOfError } from "@ea/core";

import { listSendLimitHolds } from "../../actions";
import { cancelPendingOutbox } from "../repo";

import { log, queue, warnSkipped, type Detector } from "./run";

// F099 D11 (b): sends of an active mailbox wait on a send limit. One notice per owner, mailbox and UTC day.
// The dedup key stops a second row; no source mark. A mailbox with no hold loses its pending notice, so a notice
// that the quiet hours kept never arrives after the sends went out.
export const sendHeldDetector: Detector = {
  name: "send-held",
  kinds: ["send_held"],
  async detect(run) {
    const holds = await listSendLimitHolds(run.db, run.ctx, run.now);
    const day = run.now.toISOString().slice(0, 10);
    const held = new Set<string>();
    for (const hold of holds) {
      const mailbox = run.mailboxes.find((candidate) => candidate.id === hold.mailboxId);
      if (mailbox === undefined || mailbox.status !== "active") continue;
      const limit = sendLimitOfError(hold.lastError);
      if (limit === null) {
        log.warn(`notice send_held ${mailbox.id}: skipped: unknown send limit text`);
        continue;
      }
      held.add(mailbox.id);
      try {
        for (const owner of run.owners) {
          await queue(
            run.db,
            run.ctx,
            {
              userId: owner.userId,
              locale: owner.locale,
              kind: "send_held",
              dedupKey: `send_held:${mailbox.id}:${day}`,
              mailboxId: mailbox.id,
              view: {
                mailboxId: mailbox.id,
                address: mailbox.address,
                limit,
                waiting: hold.waiting,
                nextAt: hold.nextAt,
                now: run.now,
                timeZone: run.timeZone,
              },
            },
            run.now
          );
        }
      } catch (error) {
        warnSkipped("send_held", mailbox.id, error);
      }
    }
    for (const mailbox of run.mailboxes) {
      if (!held.has(mailbox.id))
        await cancelPendingOutbox(run.db, run.ctx, { kind: "send_held", mailboxId: mailbox.id });
    }
  },
};
