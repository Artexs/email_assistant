import { REPLY_CONSENT_SINCE, HOUR_MS, MINUTE_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import { auditEvents, recordAudit } from "../../src/modules/audit";
import {
  createOutboxSender,
  detectNotices,
  handleCallback,
  type CallbackDeps,
  type LinkedChat,
} from "../../src/modules/channels";
import { createFakeChannel, type FakeChannel } from "../../src/modules/channels/fake/channel";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import type { DB } from "../../src/platform/db";

import { addMember, isolateChannels, linkChat, randomChatId } from "./fixtures";
import {
  CLEAN_ANSWER,
  fakeLlm,
  jobDeps,
  NOW,
  pairRows,
  runJob,
  setupBox,
  type Clock,
  type FakeAnswer,
  type JobBox,
} from "./reply-job-fixtures";

// Shared by the tests of the reply drafts in Telegram: an organization with an owner and a member who are linked to a fake
// channel, one clock that moves a minute after each step, and the sender, the notice detectors and the drafter job on one
// transaction that is rolled back.

export interface Rig {
  box: JobBox;
  owner: LinkedChat;
  member: LinkedChat;
  memberId: string;
  deps: CallbackDeps;
  clock: Clock;
  channel: FakeChannel;
  // One sender run, one notice detection and one job run, each a minute after the step before.
  sendOut(): Promise<void>;
  detect(): Promise<void>;
  job(answer?: FakeAnswer): Promise<void>;
}

export async function rig(trx: Transaction<DB>, opts: { consented?: boolean } = {}): Promise<Rig> {
  await isolateChannels(trx);
  const box = await setupBox(trx);
  const memberId = await addMember(trx, box.ctx.orgId);
  await linkChat(trx, box.ctx, box.userId, randomChatId(), new Date(NOW.getTime() - HOUR_MS));
  await linkChat(trx, box.ctx, memberId, randomChatId(), new Date(NOW.getTime() - HOUR_MS));
  if (opts.consented !== false) {
    await recordAudit(trx, box.ctx, {
      event: auditEvents.webTelegramConsent,
      actor: box.userId,
      data: { via: "web", version: REPLY_CONSENT_SINCE },
      at: new Date(NOW.getTime() - 2 * HOUR_MS),
    });
  }
  const clock: Clock = { now: NOW };
  const link = (userId: string, role: "owner" | "assistant"): LinkedChat => ({
    orgId: box.ctx.orgId,
    userId,
    role,
    chatId: 1,
    linkedAt: new Date(NOW.getTime() - HOUR_MS),
    locale: "en",
  });
  const deps: CallbackDeps = {
    db: trx,
    now: () => clock.now,
    actionsScope: { kind: "all" },
    hooks: noDelegationHooks,
    uidplus: async () => true,
    sendScope: { kind: "all" },
  };
  const channel = createFakeChannel();
  const tick = () => {
    clock.now = new Date(clock.now.getTime() + MINUTE_MS);
  };
  return {
    box,
    owner: link(box.userId, "owner"),
    member: link(memberId, "assistant"),
    memberId,
    deps,
    clock,
    channel,
    async sendOut() {
      tick();
      await createOutboxSender({ db: trx, channel, now: () => clock.now }).run();
    },
    async detect() {
      tick();
      await detectNotices({
        db: trx,
        now: () => clock.now,
        startedAt: new Date(NOW.getTime() - HOUR_MS),
        testMail: NO_TEST_SENDERS,
      });
    },
    async job(answer: FakeAnswer = CLEAN_ANSWER) {
      tick();
      const { llm } = fakeLlm(() => answer);
      await runJob(jobDeps(trx, llm, clock), box);
    },
  };
}

export async function outboxOf(trx: Transaction<DB>, r: Rig, kind: string) {
  return trx
    .selectFrom("outbox")
    .selectAll()
    .where("org_id", "=", r.box.ctx.orgId)
    .where("kind", "=", kind as never)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

export const openSend = async (trx: Transaction<DB>, r: Rig) =>
  (await pairRows(trx, r.box)).find((row) => row.type === "send" && row.status === "awaiting_approval");

// A reply card that went out: the review of the draft, sent by the fake channel. Returns the message id of the card.
export async function cardOut(trx: Transaction<DB>, r: Rig): Promise<number> {
  // The committer has put the draft in Drafts: the review lists only such replies.
  await trx
    .updateTable("actions")
    .set({ status: "applied", applied_at: NOW })
    .where("org_id", "=", r.box.ctx.orgId)
    .where("type", "=", "create_draft")
    .where("status", "=", "ready")
    .execute();
  await handleCallback(r.deps, r.owner, "rv");
  await r.sendOut();
  const sent = r.channel.sent.at(-1);
  if (sent === undefined) throw new Error("no card went out");
  return sent.messageId;
}
