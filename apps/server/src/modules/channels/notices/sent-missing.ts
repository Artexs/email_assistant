import { DAY_MS, HOUR_MS } from "@ea/core";

import { listSentHealth } from "../../mail";
import { isFeatureOn } from "../../tenancy";
import { cancelPendingOutbox } from "../repo";

import { queue, warnSkipped, type Detector } from "./run";

// No mail of the user in the Sent folder for 7 days: one notice per owner for each quiet period.
export const SENT_MISSING_AFTER_MS = 7 * DAY_MS;
// The last Sent pass is not older than this. After a period with the flag off or the mailbox paused, a quiet period
// that nobody observed gives no notice.
export const SENT_PASS_FRESH_MS = HOUR_MS;

// The key holds the start of the quiet period: the later of the newest user mail and the first pass. A new user mail
// that goes quiet again starts a new period and a new notice. The view holds the mailbox address only.
export const sentMissingDetector: Detector = {
  name: "sent-missing",
  kinds: ["sent_missing"],
  async detect(run) {
    const flagOn = await isFeatureOn(run.db, run.ctx, "sent_sync");
    const health = flagOn
      ? new Map((await listSentHealth(run.db, run.ctx)).map((row) => [row.mailboxId, row]))
      : new Map();
    for (const mailbox of run.mailboxes) {
      const row = health.get(mailbox.id);
      const quietSince =
        row === undefined ? null : new Date(Math.max(row.newestUserAt?.getTime() ?? 0, row.firstPassAt.getTime()));
      // A pass of an older period that ends late can set `last_pass_at` in a new period. The quiet period of the new
      // period starts at its first pass, so such a write alone never makes a notice.
      const observed =
        row !== undefined &&
        row.lastPassAt !== null &&
        run.now.getTime() - row.lastPassAt.getTime() <= SENT_PASS_FRESH_MS;
      const quiet = quietSince !== null && run.now.getTime() - quietSince.getTime() >= SENT_MISSING_AFTER_MS;
      if (mailbox.status !== "active" || row === undefined || row.lastErrorCode !== null || !observed || !quiet) {
        await cancelPendingOutbox(run.db, run.ctx, { kind: "sent_missing", mailboxId: mailbox.id });
        continue;
      }
      const key = `sent_missing:${mailbox.id}:${quietSince.getTime()}`;
      try {
        for (const owner of run.owners) {
          await queue(
            run.db,
            run.ctx,
            {
              userId: owner.userId,
              locale: owner.locale,
              kind: "sent_missing",
              dedupKey: key,
              mailboxId: mailbox.id,
              // The period became quiet enough for a notice 7 days after it began.
              eventAt: new Date(quietSince.getTime() + SENT_MISSING_AFTER_MS),
              view: { address: mailbox.address, since: quietSince, now: run.now, timeZone: run.timeZone },
            },
            run.now
          );
        }
      } catch (error) {
        warnSkipped("sent_missing", mailbox.id, error);
      }
      await cancelPendingOutbox(run.db, run.ctx, { kind: "sent_missing", mailboxId: mailbox.id, exceptDedupKey: key });
    }
  },
};
