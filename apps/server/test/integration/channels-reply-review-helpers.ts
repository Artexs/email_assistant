import { REPLY_CONSENT_SINCE, HOUR_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import { auditEvents, recordAudit } from "../../src/modules/audit";
import { type CallbackDeps, type LinkedChat } from "../../src/modules/channels";
import type { DB } from "../../src/platform/db";

import { addMember, isolateChannels, linkChat, randomChatId } from "./fixtures";
import { sweepOrg, sweepReply, type SweepOrg } from "./reply-answered-fixtures";
export const T = new Date("2026-11-20T10:00:00Z");
export const at = (offsetMs: number): Date => new Date(T.getTime() + offsetMs);

export interface Team extends SweepOrg {
  memberId: string;
  owner: LinkedChat;
  member: LinkedChat;
  deps: CallbackDeps;
}

export async function consent(trx: Transaction<DB>, o: SweepOrg, userId: string, version: string): Promise<void> {
  await recordAudit(trx, o.ctx, {
    event: auditEvents.webTelegramConsent,
    actor: userId,
    data: { via: "web", version },
    at: at(-2 * HOUR_MS),
  });
}

// The owner has the reply consent (unless `consented` is false); a member is linked too.
export async function team(
  trx: Transaction<DB>,
  opts: { consented?: boolean; webBaseUrl?: string } = {}
): Promise<Team> {
  await isolateChannels(trx);
  const o = await sweepOrg(trx);
  const memberId = await addMember(trx, o.ctx.orgId);
  await linkChat(trx, o.ctx, o.userId, randomChatId(), at(-HOUR_MS));
  await linkChat(trx, o.ctx, memberId, randomChatId(), at(-HOUR_MS));
  if (opts.consented !== false) await consent(trx, o, o.userId, REPLY_CONSENT_SINCE);
  let tick = 0;
  const link = (userId: string, role: "owner" | "assistant"): LinkedChat => ({
    orgId: o.ctx.orgId,
    userId,
    role,
    chatId: 1,
    linkedAt: at(-HOUR_MS),
    locale: "en",
  });
  const deps: CallbackDeps = {
    db: trx,
    // Each tap is one second later: the cards of one test have different `created_at`, so their order is the order of the taps.
    now: () => new Date(T.getTime() + 1000 * tick++),
    actionsScope: { kind: "all" },
    hooks: noDelegationHooks,
    uidplus: async () => true,
    sendScope: { kind: "all" },
    ...(opts.webBaseUrl === undefined ? {} : { webBaseUrl: opts.webBaseUrl }),
  };
  return { ...o, memberId, owner: link(o.userId, "owner"), member: link(memberId, "assistant"), deps };
}

// Three open replies, oldest first. The `bodyText` of the draft is the text of the card.
export async function threeReplies(trx: Transaction<DB>, o: SweepOrg) {
  const first = await sweepReply(trx, o, { createdAt: at(-3 * HOUR_MS) });
  const second = await sweepReply(trx, o, { createdAt: at(-2 * HOUR_MS) });
  const third = await sweepReply(trx, o, { createdAt: at(-HOUR_MS) });
  return [first, second, third];
}

export async function cards(trx: Transaction<DB>, o: SweepOrg, userId?: string) {
  let query = trx
    .selectFrom("outbox")
    .selectAll()
    .where("org_id", "=", o.ctx.orgId)
    .where("kind", "=", "approval")
    .orderBy("created_at")
    .orderBy("id");
  if (userId !== undefined) query = query.where("user_id", "=", userId);
  return query.execute();
}

export const keysOf = async (trx: Transaction<DB>, o: SweepOrg) => (await cards(trx, o)).map((row) => row.dedup_key);
