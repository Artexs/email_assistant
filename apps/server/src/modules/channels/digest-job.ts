import { dueDigestSlot, isLateSlot, localKey, parseDigestTimes } from "@ea/core";
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
import { listReviewableReplies, REVIEW_SCAN_MAX } from "./reply-review";
import {
  listReportMembers,
  mailDedupKey,
  reportRoutesOf,
  type ReportMember,
  type ReportRoutes,
} from "./report-members";

const log = createLog("channels");

export interface DigestJobDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  testMail: TestMailRule;
  // The base URL of the panel (`WEB_BASE_URL`): the "+n more in the panel" lines of the brief link to it.
  webBaseUrl?: string;
}

// The first digest of the member's day gets the brief. The day is the date of the SLOT
// (`slotDate`, the local date of the slot key), not the time at which the job runs: a 20:00 slot that runs at 01:00 is still a slot of its
// own day, and a day with a missing midnight or 25 hours needs no clock arithmetic. "First" = no digest outbox row of the member for a slot
// of the same date that is not `failed` (a digest that never reached the chat does not count; its marks went back, `releaseBriefMarks`).
// It runs in the queue transaction and takes a lock per member and day first: two transactions of one member queue one after the other,
// so the second sees the outbox row of the first and gets the count line. Exported for its race test.
export async function isFirstDigestOfDay(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  input: { userId: string; slotDate: string }
): Promise<boolean> {
  const { userId, slotDate } = input;
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`digest_day:${ctx.orgId}:${userId}:${slotDate}`}, 0))`.execute(
    trx
  );
  const earlier = await trx
    .selectFrom("outbox")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .where("kind", "=", "digest")
    // Only Telegram rows: the brief goes to the Telegram digest, so a mail row is no earlier digest of the day.
    .where("channel", "=", "telegram")
    .where("status", "<>", "failed")
    .where(sql<boolean>`starts_with(dedup_key, ${`digest:${slotDate}T`})`)
    .limit(1)
    .executeTakeFirst();
  return earlier === undefined;
}

// One digest row per member and slot, with one Telegram outbox row for a member with a chat and, with the flag `report_mail`,
// one mail row for a member whose report channel is `mail` or `both`. A member with no chat visits
// the job for the mail row; the slot rules stay, and the "last slot" is the one of the member's `digests` rows.
async function scheduleForMember(
  db: Db | Transaction<DB>,
  member: ReportMember,
  routes: ReportRoutes,
  now: Date,
  testMail: TestMailRule,
  webBaseUrl: string | undefined
): Promise<void> {
  const { orgId, userId } = member;
  const ctx = { orgId };
  // A member with a chat counts from the link, a member with no chat from the start of the membership; the first digest of
  // a member with no chat looks back 24 h from now, never to the membership start.
  const linkedAt = member.chat?.linkedAt ?? member.since;
  const membership = await getMembership(db, ctx, userId);
  if (membership === undefined) return;
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new Error("organization not found");
  const timeZone = organization.timezone;

  const times = parseDigestTimes(membership.digest_times);
  const lastKey = await lastDigestSlotKey(db, ctx, userId);
  const linkKey = localKey(linkedAt, timeZone);
  const afterKey = lastKey !== null && lastKey > linkKey ? lastKey : linkKey;

  const slot = dueDigestSlot({ now, timeZone, times, afterKey });
  if (slot === null) return;

  const periodStart = await digestPeriodStart(db, ctx, { userId, linkedAt: member.chat?.linkedAt ?? now }, now);
  const outboxId = await queueDigest(
    db,
    { ...member, role: membership.role },
    {
      slot,
      periodStart,
      now,
      timeZone,
      testMail,
      webBaseUrl,
      telegram: routes.telegram,
      mailboxId: routes.mailboxId,
    }
  );
  if (outboxId === null) return;
  log.info("digest_queued", { slot: slot.key, user_id: userId, outbox_id: outboxId });
}

// The queue transaction of one digest: the digest row (one per member and slot), the text, the outbox row and the marks of the
// loops that the text named. null = the slot has a row already. Exported for the race tests of the brief.
export async function queueDigest(
  db: Db | Transaction<DB>,
  // `role` is the role of the member the digest is for (the membership row), for the Telegram row and the mail row alike.
  link: Pick<LinkedChat, "orgId" | "userId" | "locale" | "role">,
  input: {
    slot: { key: string; date: string; time: string };
    periodStart: Date;
    now: Date;
    timeZone: string;
    testMail: TestMailRule;
    webBaseUrl: string | undefined;
    // Which rows to queue. Absent = one Telegram row, as before the report mail existed. `mailboxId` set = a mail row into that mailbox.
    telegram?: boolean;
    mailboxId?: string | null;
  }
): Promise<string | null> {
  const { orgId, userId } = link;
  const ctx = { orgId };
  const { slot, periodStart, now, timeZone, testMail, webBaseUrl } = input;
  const telegram = input.telegram ?? true;
  const mailboxId = input.mailboxId ?? null;
  const periodEnd = now;
  const queue = async (trx: Transaction<DB>): Promise<string | null> => {
    const digestId = await insertDigest(trx, ctx, { userId, slotKey: slot.key, periodStart, periodEnd });
    if (digestId === null) return null;
    // The brief belongs to the Telegram digest row only: it needs the flag, the first-of-day decision and the consent of the
    // member, all read in this transaction, and it marks loops. A member with no Telegram row (mail only) gets a digest with no
    // brief and no marks; a mail row of a member with a Telegram row is built without the brief too.
    // `loopConsentOf` is the only way to the consent version (consent-gate.test.ts).
    let loops: DigestLoops | undefined;
    if (telegram && (await isFeatureOn(trx, ctx, "open_loops"))) {
      const firstOfDay = await isFirstDigestOfDay(trx, ctx, { userId, slotDate: slot.date });
      const loopConsent = (await loopConsentOf(trx, ctx, [userId])).has(userId);
      loops = { firstOfDay, loopConsent, ...(webBaseUrl === undefined ? {} : { panelBase: webBaseUrl }) };
    }
    // The reply drafts that wait for a review: a count for an owner while the flag is on. No text, no button.
    const repliesReady =
      link.role === "owner" && (await isFeatureOn(trx, ctx, "reply_drafts"))
        ? (await listReviewableReplies(trx, ctx, { max: REVIEW_SCAN_MAX })).length
        : 0;
    const request = {
      kind: "scheduled" as const,
      periodStart,
      periodEnd,
      slot: { date: slot.date, time: slot.time, late: isLateSlot(slot, now, timeZone) },
      now,
      locale: link.locale,
      role: link.role,
      testMail,
      ...(repliesReady > 0 ? { repliesReady } : {}),
      // The spam review line is part of the text: it needs the panel link, and both rows carry it.
      ...(webBaseUrl === undefined ? {} : { panelBase: webBaseUrl }),
    };
    const built = await buildDigest(trx, ctx, { ...request, ...(loops === undefined ? {} : { loops }) });
    const { message, shown } = built;
    const loopIds = [...shown.surfaced, ...shown.stale];
    // The line of each loop (and delegation) that a brief line names: the taps on its buttons edit that line.
    const hasLines = Object.keys(shown.lineOf).length > 0;
    const viewOf = (text: string, buttons: typeof message.buttons, withBrief: boolean) => ({
      text,
      buttons,
      ...(withBrief && loopIds.length > 0 ? { loopIds } : {}),
      ...(withBrief && hasLines ? { lineOf: shown.lineOf } : {}),
    });
    const row = { userId, locale: link.locale, kind: "digest", digestId, now } as const;
    let outboxId: string | null = null;
    if (telegram) {
      outboxId = await queueNotice(trx, ctx, {
        ...row,
        dedupKey: `digest:${slot.key}`,
        view: viewOf(message.text, message.buttons, true),
      });
    }
    if (mailboxId !== null) {
      // Without the brief: a second build when the Telegram text holds one.
      const plain = loops === undefined ? built : await buildDigest(trx, ctx, request);
      const mailId = await queueNotice(trx, ctx, {
        ...row,
        dedupKey: mailDedupKey(`digest:${slot.key}`),
        view: viewOf(plain.message.text, plain.message.buttons, false),
        channel: "mail",
        mailboxId,
      });
      outboxId ??= mailId;
    }
    // The rollback keeps a digest row from staying without its message, also when the view does not render.
    if (outboxId === null) throw new Error("digest outbox row exists");
    // What the text named is marked in the same transaction: a rollback leaves the loops unmarked, and the next digest names them.
    // `shown` is empty without a brief, so a mail-only digest marks nothing.
    await markBriefShown(trx, ctx, { ...shown, at: now });
    return outboxId;
  };
  return db.isTransaction ? queue(db as Transaction<DB>) : db.transaction().execute(queue);
}

// Never throws. One member that fails does not stop the next one. The flag `report_mail` is read once per organization.
export async function scheduleDigests(deps: DigestJobDeps): Promise<void> {
  try {
    const now = deps.now();
    const mailOn = new Map<string, boolean>();
    for (const member of await listReportMembers(deps.db, { includeSuspended: false })) {
      try {
        let flagOn = mailOn.get(member.orgId);
        if (flagOn === undefined) {
          flagOn = await isFeatureOn(deps.db, { orgId: member.orgId }, "report_mail");
          mailOn.set(member.orgId, flagOn);
        }
        const routes = reportRoutesOf(member, flagOn);
        if (!routes.telegram && routes.mailboxId === null) continue;
        await scheduleForMember(deps.db, member, routes, now, deps.testMail, deps.webBaseUrl);
      } catch (error) {
        log.error("digest_member_failed", { org_id: member.orgId, user_id: member.userId, ...errorFields(error) });
      }
    }
  } catch (error) {
    log.error("digests_failed", { ...errorFields(error) });
  }
}
