import { sendLimitOfError } from "@ea/core";

import { listFollowUpLimitHolds, listSendLimitHolds, type SendLimitHold } from "../../actions";
import { isFeatureOn } from "../../tenancy";
import { cancelPendingOutbox } from "../repo";

import { panelListUrlOf } from "./approval";
import { log, queue, warnSkipped, type Detector, type OrgRun } from "./run";

// F099 D11 (b): sends of an active mailbox wait on a send limit. One notice per owner, mailbox and UTC day.
// The dedup key stops a second row; no source mark. A mailbox with no hold loses its pending notice, so a notice
// that the quiet hours kept never arrives after the sends went out.
// The holds of one kind (mail sends, or the follow-ups of open loops) become one notice per owner, mailbox and UTC day. A mailbox
// with no hold of the kind loses its pending notice of that kind. The follow-up notice names no address and no text.
async function noticeHolds(
  run: OrgRun,
  holds: SendLimitHold[],
  kind: { followUps: boolean; panelUrl: string | undefined }
): Promise<void> {
  const day = run.now.toISOString().slice(0, 10);
  const family = kind.followUps ? "send_held_follow_up" : "send_held";
  const held = new Set<string>();
  for (const hold of holds) {
    const mailbox = run.mailboxes.find((candidate) => candidate.id === hold.mailboxId);
    if (mailbox === undefined || mailbox.status !== "active") continue;
    const limit = sendLimitOfError(hold.lastError);
    if (limit === null) {
      log.warn("notice_skipped", { kind: "send_held", item_id: mailbox.id, reason: "unknown_send_limit" });
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
            dedupKey: `${family}:${mailbox.id}:${day}`,
            mailboxId: mailbox.id,
            view: {
              mailboxId: mailbox.id,
              address: mailbox.address,
              limit,
              waiting: hold.waiting,
              nextAt: hold.nextAt,
              now: run.now,
              timeZone: run.timeZone,
              ...(kind.followUps ? { followUps: true } : {}),
              ...(kind.followUps && kind.panelUrl !== undefined ? { panelUrl: kind.panelUrl } : {}),
            },
          },
          run.now
        );
      }
    } catch (error) {
      warnSkipped("send_held", mailbox.id, error, `${family}:${mailbox.id}`);
    }
  }
  for (const mailbox of run.mailboxes) {
    if (!held.has(mailbox.id)) {
      await cancelPendingOutbox(run.db, run.ctx, {
        kind: "send_held",
        mailboxId: mailbox.id,
        dedupPrefix: `${family}:${mailbox.id}:`,
      });
    }
  }
}

export const sendHeldDetector: Detector = {
  name: "send-held",
  kinds: ["send_held"],
  async detect(run) {
    await noticeHolds(run, await listSendLimitHolds(run.db, run.ctx, run.now), {
      followUps: false,
      panelUrl: undefined,
    });
    const holds = await listFollowUpLimitHolds(run.db, run.ctx, run.now);
    const panelBase =
      holds.length > 0 && run.deps.webBaseUrl !== undefined && (await isFeatureOn(run.db, run.ctx, "approvals_page"))
        ? run.deps.webBaseUrl
        : undefined;
    await noticeHolds(run, holds, {
      followUps: true,
      panelUrl: panelBase === undefined ? undefined : panelListUrlOf(panelBase),
    });
  },
};
