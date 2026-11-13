import { type TenantContext } from "../../../platform/db";
import { type MailboxSummary } from "../../mail";
import { type LinkedChat } from "../port";
import { cancelPendingOutbox, listSentStaleEpisodes } from "../repo";

import { NoticeDeps, queue, warnSkipped } from "./run";

export const SYNC_LATE_MS = 30 * 60_000;
export const STALE_GRACE_AFTER_START_MS = 10 * 60_000;

export async function detectSync(
  deps: NoticeDeps,
  ctx: TenantContext,
  members: LinkedChat[],
  owners: LinkedChat[],
  mailbox: MailboxSummary,
  timeZone: string,
  now: Date,
  resumedAt: Date | null
): Promise<void> {
  const { db } = deps;
  if (mailbox.status !== "active") {
    await cancelPendingOutbox(db, ctx, { kind: "sync_stale", mailboxId: mailbox.id });
    return;
  }
  const within = (at: Date) => now.getTime() - at.getTime() <= SYNC_LATE_MS;
  const fresh = mailbox.last_synced_at !== null && within(mailbox.last_synced_at);
  // The mailbox became active again (resume, new password) or is new: give the sync time to run.
  // After a pause (D4) the sync runs again from the resume: the same grace.
  const grace =
    within(mailbox.status_changed_at) ||
    (mailbox.last_synced_at === null && within(mailbox.created_at)) ||
    (resumedAt !== null && within(resumedAt));

  if (!fresh) {
    if (grace) {
      await cancelPendingOutbox(db, ctx, { kind: "sync_stale", mailboxId: mailbox.id });
      return;
    }
    if (now.getTime() - deps.startedAt.getTime() < STALE_GRACE_AFTER_START_MS) return;
    const key = `sync_stale:${mailbox.id}:${mailbox.last_synced_at?.getTime() ?? "never"}`;
    try {
      for (const owner of owners) {
        await queue(
          db,
          ctx,
          {
            userId: owner.userId,
            locale: owner.locale,
            kind: "sync_stale",
            dedupKey: key,
            mailboxId: mailbox.id,
            view: { address: mailbox.address, lastSyncedAt: mailbox.last_synced_at, now, timeZone },
          },
          now
        );
      }
    } catch (error) {
      warnSkipped("sync_stale", mailbox.id, error);
    }
    await cancelPendingOutbox(db, ctx, { kind: "sync_stale", mailboxId: mailbox.id, exceptDedupKey: key });
    return;
  }

  await cancelPendingOutbox(db, ctx, { kind: "sync_stale", mailboxId: mailbox.id });
  if (mailbox.last_synced_at === null) return;
  const lastSyncedAt = mailbox.last_synced_at;
  const episodes = await listSentStaleEpisodes(db, ctx, mailbox.id);
  try {
    for (const { userId, episode } of episodes) {
      const member = members.find((candidate) => candidate.userId === userId);
      if (member === undefined) continue;
      await queue(
        db,
        ctx,
        {
          userId,
          locale: member.locale,
          kind: "sync_ok",
          dedupKey: `sync_ok:${mailbox.id}:${episode}`,
          mailboxId: mailbox.id,
          view: { address: mailbox.address, lastSyncedAt, now, timeZone },
        },
        now
      );
    }
  } catch (error) {
    warnSkipped("sync_ok", mailbox.id, error);
  }
}
