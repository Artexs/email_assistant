import { defaultDue } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import type { LoopAnchor, LoopHooks } from "../actions";
import { auditEvents, recordAudit } from "../audit";

import { ownAddressesFor, ownAddressSetsOf } from "./match";
import { readReplyDecision } from "./reply-read";
import { lockLoop, SYSTEM } from "./repo";

// A follow-up never leaves the next one due before this many working days: the next Draft is not `too_soon`.
export const FOLLOW_UP_MIN_WAIT_DAYS = 3;
const MAX_REFERENCES = 20;
// `follow_ups_sent` is limited to 0–2 by the table. A third send cannot happen (stage 14 refuses it), but the mail has gone
// out when this runs: the count must never raise a CHECK error and roll the commit of a sent mail back.
const MAX_FOLLOW_UPS = 2;

// The `LoopHooks` that `actions` calls Every function runs in the caller's transaction and filters `org_id`.
export function loopHooks(): LoopHooks {
  return {
    async anchorOf(db: Db | Transaction<DB>, ctx: TenantContext, loopId: string): Promise<LoopAnchor | undefined> {
      const loop = await db
        .selectFrom("open_loops")
        .select([
          "mailbox_id",
          "message_id",
          "references_ids",
          "subject",
          "to_addresses",
          "cc_addresses",
          "language",
          "sent_email_id",
          "wait_from_at",
        ])
        .where("org_id", "=", ctx.orgId)
        .where("id", "=", loopId)
        .executeTakeFirst();
      if (loop === undefined) return undefined;
      // The quote is the own text of the opening mail while it is stored; the Sent row may be gone or cleared.
      const sent =
        loop.sent_email_id === null
          ? undefined
          : await db
              .selectFrom("sent_emails")
              .select(["body_text", "content", "sent_at"])
              .where("org_id", "=", ctx.orgId)
              .where("id", "=", loop.sent_email_id)
              .executeTakeFirst();
      return {
        mailboxId: loop.mailbox_id,
        messageId: loop.message_id,
        referencesIds: loop.references_ids,
        subject: loop.subject,
        to: loop.to_addresses,
        cc: loop.cc_addresses,
        language: loop.language === "pl" ? "pl" : "en",
        quote: sent !== undefined && sent.content === "stored" ? sent.body_text : null,
        sentAt: sent?.sent_at ?? loop.wait_from_at,
      };
    },

    async isOpen(trx: Transaction<DB>, ctx: TenantContext, loopId: string): Promise<boolean> {
      const loop = await lockLoop(trx, ctx, loopId);
      if (loop?.status !== "open") return false;
      if (loop.kind === "promised") return true;
      // A reply that came since the last run of `loops.match` also stops the follow-up. The job closes the loop later.
      const decision = await readReplyDecision(
        trx,
        ctx,
        loop,
        ownAddressesFor(await ownAddressSetsOf(trx, ctx, loop.mailbox_id), loop)
      );
      return decision.first === null;
    },

    async onFollowUpSent(trx, ctx, input) {
      const { loopId, sendId, messageId, at } = input;
      const loop = await lockLoop(trx, ctx, loopId);
      if (loop === undefined) return;
      // One more follow-up, whatever the loop state is: the mail went out.
      const counters = { follow_ups_sent: Math.min(loop.follow_ups_sent + 1, MAX_FOLLOW_UPS), last_follow_up_at: at };
      if (loop.status !== "open") {
        await trx
          .updateTable("open_loops")
          .set({ ...counters, updated_at: at })
          .where("org_id", "=", ctx.orgId)
          .where("id", "=", loopId)
          .execute();
        return;
      }
      // The wait starts again: at least 3 working days on, in the time zone of the organization.
      const [settings, organization] = await Promise.all([
        trx
          .selectFrom("mailbox_settings")
          .select("loop_wait_days")
          .where("org_id", "=", ctx.orgId)
          .where("mailbox_id", "=", loop.mailbox_id)
          .executeTakeFirst(),
        trx.selectFrom("organizations").select("timezone").where("id", "=", ctx.orgId).executeTakeFirst(),
      ]);
      const waitDays = Math.max(settings?.loop_wait_days ?? FOLLOW_UP_MIN_WAIT_DAYS, FOLLOW_UP_MIN_WAIT_DAYS);
      const dueAt = defaultDue(at, waitDays, organization?.timezone ?? "UTC");
      // The next follow-up answers this one: its Message-ID is the new In-Reply-To, the old one joins the References.
      const references = [...new Set([...loop.references_ids, ...(loop.message_id === null ? [] : [loop.message_id])])];
      await trx
        .updateTable("open_loops")
        .set({
          ...counters,
          message_id: messageId,
          references_ids: references.slice(-MAX_REFERENCES),
          wait_from_at: at,
          due_at: dueAt,
          updated_at: at,
        })
        .where("org_id", "=", ctx.orgId)
        .where("id", "=", loopId)
        .execute();
      await recordAudit(trx, ctx, {
        actionId: sendId,
        actor: SYSTEM,
        event: auditEvents.loopRestarted,
        data: { loop_id: loopId, kind: loop.kind, reason: "follow_up", follow_ups_sent: counters.follow_ups_sent },
        at,
      });
    },
  };
}
