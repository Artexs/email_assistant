import { randomUUID } from "node:crypto";

import type { OutMessage } from "@ea/core";
import type { Insertable, Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import { createOutboxSender, type CallbackDeps, type LinkedChat } from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import type { DB } from "../../src/platform/db";

import { EIGHT, LINKED, runDigests, type BriefOrg } from "./channels-digest-brief-fixtures";
import { commandLoop } from "./loops-commands-fixtures";

// Helpers of the tests of the Telegram taps (F116 stage 19). The digest is queued by the real job and sent by the real sender
// through the fake channel, so the stored text, buttons and view are the ones of a delivered message.

export const MESSAGE_AT = new Date(EIGHT);

export const tapDeps = (trx: Transaction<DB>, now: Date = MESSAGE_AT, webBaseUrl?: string): CallbackDeps => ({
  db: trx,
  now: () => now,
  actionsScope: { kind: "all" },
  hooks: noDelegationHooks,
  uidplus: async () => true,
  sendScope: { kind: "all" },
  ...(webBaseUrl === undefined ? {} : { webBaseUrl }),
});

export const linkOf = (org: BriefOrg, over: Partial<LinkedChat> = {}): LinkedChat => ({
  orgId: org.ctx.orgId,
  userId: org.userId,
  role: "owner",
  chatId: org.chatId,
  linkedAt: LINKED,
  locale: "en",
  ...over,
});

// The first digest of the day, queued and delivered. `messageId` is the id that Telegram gave to the message.
export async function deliverDigest(
  trx: Transaction<DB>,
  iso: string = EIGHT
): Promise<{ messageId: number; message: OutMessage }> {
  await runDigests(trx, iso);
  const channel = createFakeChannel();
  await createOutboxSender({ db: trx, channel, now: () => new Date(iso) }).run();
  const sent = channel.sent[0];
  if (sent === undefined) throw new Error("no digest was delivered");
  return { messageId: sent.messageId, message: sent.message };
}

// An open `waiting` loop of the organization that is overdue and shows in the brief of Friday 2026-11-20.
export function briefLoop(
  trx: Transaction<DB>,
  org: BriefOrg,
  over: Partial<Insertable<DB["open_loops"]>> = {}
): Promise<{ id: string; sentId: string; threadKey: string }> {
  return commandLoop(trx, org, {
    text: "send the offer",
    due_at: new Date("2026-11-19T09:00:00Z"),
    wait_from_at: new Date("2026-11-10T09:00:00Z"),
    ...over,
  });
}

export const dataOf = (message: OutMessage): string[] => message.buttons.flat().map((button) => button.data);

export const uniqueEmail = (): string => `member-${randomUUID()}@x.test`;
