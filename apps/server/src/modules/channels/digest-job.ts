import { dueDigestSlot, isLateSlot, localKey, parseDigestTimes } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db } from "../../platform/db";
import { describeError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { buildDigestMessage, digestPeriodStart, insertDigest, lastDigestSlotKey } from "../reports";
import { getMembership, getOrganization } from "../tenancy";

import { queueNotice } from "./notice-queue";
import type { LinkedChat } from "./port";
import { listLinkedChats } from "./repo";

const log = createLog("channels");

export interface DigestJobDeps {
  db: Db | Transaction<DB>;
  now(): Date;
}

// One digest row and one outbox row per member and slot (P1, P2, D15).
async function scheduleForLink(db: Db | Transaction<DB>, link: LinkedChat, now: Date): Promise<void> {
  const { orgId, userId, linkedAt } = link;
  const ctx = { orgId };
  const member = await getMembership(db, ctx, userId);
  if (member === undefined) return;
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new Error("organization not found");
  const timeZone = organization.timezone;

  const times = parseDigestTimes(member.digest_times);
  const lastKey = await lastDigestSlotKey(db, ctx, userId);
  const linkKey = localKey(linkedAt, timeZone);
  const afterKey = lastKey !== null && lastKey > linkKey ? lastKey : linkKey;

  const slot = dueDigestSlot({ now, timeZone, times, afterKey });
  if (slot === null) return;

  const periodStart = await digestPeriodStart(db, ctx, { userId, linkedAt }, now);
  const periodEnd = now;
  const message = await buildDigestMessage(db, ctx, {
    kind: "scheduled",
    periodStart,
    periodEnd,
    slot: { date: slot.date, time: slot.time, late: isLateSlot(slot, now, timeZone) },
    now,
    locale: link.locale,
  });

  const queue = async (trx: Transaction<DB>): Promise<string | null> => {
    const digestId = await insertDigest(trx, ctx, { userId, slotKey: slot.key, periodStart, periodEnd });
    if (digestId === null) return null;
    const outboxId = await queueNotice(trx, ctx, {
      userId,
      locale: link.locale,
      kind: "digest",
      dedupKey: `digest:${slot.key}`,
      digestId,
      view: { text: message.text, buttons: message.buttons },
      now,
    });
    // The rollback keeps a digest row from staying without its message, also when the view does not render.
    if (outboxId === null) throw new Error("digest outbox row exists");
    return outboxId;
  };
  const outboxId = await (db.isTransaction ? queue(db as Transaction<DB>) : db.transaction().execute(queue));
  if (outboxId === null) return;
  log.info(`digest ${slot.key} queued for user ${userId}: outbox ${outboxId}`);
}

// Never throws. One member that fails does not stop the next one.
export async function scheduleDigests(deps: DigestJobDeps): Promise<void> {
  try {
    const now = deps.now();
    for (const link of await listLinkedChats(deps.db, { includeSuspended: false })) {
      try {
        await scheduleForLink(deps.db, link, now);
      } catch (error) {
        log.error(`digest for org ${link.orgId} user ${link.userId} failed: ${describeError(error)}`);
      }
    }
  } catch (error) {
    log.error(`digests failed: ${describeError(error)}`);
  }
}
