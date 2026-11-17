import { dueDigestSlot, isLateSlot, localDateTime, localKey, localToInstant, parseDigestTimes } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { markBriefShown } from "../loops";
import type { TestMailRule } from "../mail";
import { buildDigest, digestPeriodStart, insertDigest, lastDigestSlotKey, type DigestLoops } from "../reports";
import { getMembership, getOrganization, isFeatureOn } from "../tenancy";

import { loopConsentOf } from "./consent";
import { queueNotice } from "./notice-queue";
import type { LinkedChat } from "./port";
import { listLinkedChats } from "./repo";

const log = createLog("channels");

export interface DigestJobDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  testMail: TestMailRule;
  // The base URL of the panel (`WEB_BASE_URL`): the "+n more in the panel" lines of the brief link to it.
  webBaseUrl?: string;
}

// The first digest of the member's local day gets the brief (F116 stage 18, F7). "First" = no digest outbox row of the member
// from the start of the same local day up to now that is not `failed` (a digest that never reached the chat does not count).
// It runs in the queue transaction and takes a lock per member and day first: two transactions of one member queue one after
// the other, so the second sees the outbox row of the first and gets the count line. Exported for its race test.
export async function isFirstDigestOfDay(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  input: { userId: string; timeZone: string; now: Date }
): Promise<boolean> {
  const { userId, timeZone, now } = input;
  const day = localDateTime(now, timeZone).date;
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`digest_day:${ctx.orgId}:${userId}:${day}`}, 0))`.execute(
    trx
  );
  const dayStart = localToInstant(day, "00:00", timeZone);
  const earlier = await trx
    .selectFrom("outbox")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .where("kind", "=", "digest")
    .where("status", "<>", "failed")
    .where("created_at", ">=", dayStart)
    .where("created_at", "<=", now)
    .limit(1)
    .executeTakeFirst();
  return earlier === undefined;
}

// One digest row and one outbox row per member and slot (P1, P2, D15).
async function scheduleForLink(
  db: Db | Transaction<DB>,
  link: LinkedChat,
  now: Date,
  testMail: TestMailRule,
  webBaseUrl: string | undefined
): Promise<void> {
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
  const outboxId = await queueDigest(db, link, {
    slot,
    periodStart,
    now,
    timeZone,
    testMail,
    webBaseUrl,
  });
  if (outboxId === null) return;
  log.info("digest_queued", { slot: slot.key, user_id: userId, outbox_id: outboxId });
}

// The queue transaction of one digest: the digest row (one per member and slot), the text, the outbox row and the marks of the
// loops that the text named. null = the slot has a row already. Exported for the race tests of the brief.
export async function queueDigest(
  db: Db | Transaction<DB>,
  link: LinkedChat,
  input: {
    slot: { key: string; date: string; time: string };
    periodStart: Date;
    now: Date;
    timeZone: string;
    testMail: TestMailRule;
    webBaseUrl: string | undefined;
  }
): Promise<string | null> {
  const { orgId, userId } = link;
  const ctx = { orgId };
  const { slot, periodStart, now, timeZone, testMail, webBaseUrl } = input;
  const periodEnd = now;
  const queue = async (trx: Transaction<DB>): Promise<string | null> => {
    const digestId = await insertDigest(trx, ctx, { userId, slotKey: slot.key, periodStart, periodEnd });
    if (digestId === null) return null;
    // The brief needs the flag, the first-of-day decision and the consent of the member, all read in this transaction.
    // `loopConsentOf` is the only way to the consent version (consent-gate.test.ts).
    let loops: DigestLoops | undefined;
    if (await isFeatureOn(trx, ctx, "open_loops")) {
      const firstOfDay = await isFirstDigestOfDay(trx, ctx, { userId, timeZone, now });
      const loopConsent = (await loopConsentOf(trx, ctx, [userId])).has(userId);
      loops = { firstOfDay, loopConsent, ...(webBaseUrl === undefined ? {} : { panelBase: webBaseUrl }) };
    }
    const built = await buildDigest(trx, ctx, {
      kind: "scheduled",
      periodStart,
      periodEnd,
      slot: { date: slot.date, time: slot.time, late: isLateSlot(slot, now, timeZone) },
      now,
      locale: link.locale,
      testMail,
      ...(loops === undefined ? {} : { loops }),
    });
    const { message, shown } = built;
    const loopIds = [...shown.surfaced, ...shown.stale];
    // The line of each loop (and delegation) that a brief line names: the taps on its buttons edit that line (stage 19).
    const hasLines = Object.keys(shown.lineOf).length > 0;
    const outboxId = await queueNotice(trx, ctx, {
      userId,
      locale: link.locale,
      kind: "digest",
      dedupKey: `digest:${slot.key}`,
      digestId,
      view: {
        text: message.text,
        buttons: message.buttons,
        ...(loopIds.length === 0 ? {} : { loopIds }),
        ...(hasLines ? { lineOf: shown.lineOf } : {}),
      },
      now,
    });
    // The rollback keeps a digest row from staying without its message, also when the view does not render.
    if (outboxId === null) throw new Error("digest outbox row exists");
    // What the text named is marked in the same transaction: a rollback leaves the loops unmarked, and the next digest names them.
    await markBriefShown(trx, ctx, { ...shown, at: now });
    return outboxId;
  };
  return db.isTransaction ? queue(db as Transaction<DB>) : db.transaction().execute(queue);
}

// Never throws. One member that fails does not stop the next one.
export async function scheduleDigests(deps: DigestJobDeps): Promise<void> {
  try {
    const now = deps.now();
    for (const link of await listLinkedChats(deps.db, { includeSuspended: false })) {
      try {
        await scheduleForLink(deps.db, link, now, deps.testMail, deps.webBaseUrl);
      } catch (error) {
        log.error("digest_member_failed", { org_id: link.orgId, user_id: link.userId, ...errorFields(error) });
      }
    }
  } catch (error) {
    log.error("digests_failed", { ...errorFields(error) });
  }
}
