import { type TenantContext } from "../../../platform/db";
import { type MailboxSummary } from "../../mail";
import { type LinkedChat } from "../port";
import { cancelPendingOutbox } from "../repo";

import { DbOrTrx, queue, warnSkipped, type Detector } from "./run";

async function detectAuthError(
  db: DbOrTrx,
  ctx: TenantContext,
  owners: LinkedChat[],
  mailbox: MailboxSummary,
  timeZone: string,
  now: Date
): Promise<void> {
  if (mailbox.status !== "auth_error") {
    await cancelPendingOutbox(db, ctx, { kind: "auth_error", mailboxId: mailbox.id });
    return;
  }
  const key = `auth_error:${mailbox.id}:${mailbox.status_changed_at.getTime()}`;
  try {
    for (const owner of owners) {
      await queue(
        db,
        ctx,
        {
          userId: owner.userId,
          locale: owner.locale,
          kind: "auth_error",
          dedupKey: key,
          mailboxId: mailbox.id,
          view: { address: mailbox.address, mailboxId: mailbox.id, since: mailbox.status_changed_at, now, timeZone },
        },
        now
      );
    }
  } catch (error) {
    warnSkipped("auth_error", mailbox.id, error);
  }
  await cancelPendingOutbox(db, ctx, { kind: "auth_error", mailboxId: mailbox.id, exceptDedupKey: key });
}

export const authErrorDetector: Detector = {
  name: "auth-error",
  kinds: ["auth_error"],
  async detect(run) {
    for (const mailbox of run.mailboxes)
      await detectAuthError(run.db, run.ctx, run.owners, mailbox, run.timeZone, run.now);
  },
};
