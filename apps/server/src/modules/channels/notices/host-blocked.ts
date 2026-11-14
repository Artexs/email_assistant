import { cancelPendingOutbox } from "../repo";

import { queue, warnSkipped, type Detector } from "./run";

// One notice per owner for each episode of the status `host_blocked` (the key holds `status_changed_at`).
// The view holds the mailbox address only: never a host name or a network address.
export const hostBlockedDetector: Detector = {
  name: "host-blocked",
  kinds: ["host_blocked"],
  async detect(run) {
    for (const mailbox of run.mailboxes) {
      if (mailbox.status !== "host_blocked") {
        await cancelPendingOutbox(run.db, run.ctx, { kind: "host_blocked", mailboxId: mailbox.id });
        continue;
      }
      const key = `host_blocked:${mailbox.id}:${mailbox.status_changed_at.getTime()}`;
      try {
        for (const owner of run.owners) {
          await queue(
            run.db,
            run.ctx,
            {
              userId: owner.userId,
              locale: owner.locale,
              kind: "host_blocked",
              dedupKey: key,
              mailboxId: mailbox.id,
              view: {
                address: mailbox.address,
                since: mailbox.status_changed_at,
                now: run.now,
                timeZone: run.timeZone,
              },
            },
            run.now
          );
        }
      } catch (error) {
        warnSkipped("host_blocked", mailbox.id, error);
      }
      await cancelPendingOutbox(run.db, run.ctx, { kind: "host_blocked", mailboxId: mailbox.id, exceptDedupKey: key });
    }
  },
};
