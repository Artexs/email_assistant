import { randomBytes } from "node:crypto";

import { MINUTE_MS } from "@ea/core";
import type { Transaction } from "kysely";

import {
  applySend,
  claimActions,
  createFolderResolver,
  noDelegationHooks,
  releaseActions,
  type ApplyDeps,
  type ClaimedAction,
  type DelegationHooks,
} from "../../src/modules/actions";
import { buildDraftMessage } from "../../src/modules/actions/drafts";
import { composeMessage, SmtpSendError } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender, type FakeMailSender } from "../../src/modules/mail/fake/sender";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend } from "./fixtures";

export const NOW = new Date("2026-11-07T12:00:00Z");
export const CREATED = new Date("2026-11-07T11:00:00Z");
export const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * MINUTE_MS);
export const DELEGATION_ID = "11111111-1111-4111-8111-111111111111";
export const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

export interface Setup {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
  sender: FakeMailSender;
  folderMap: Record<string, string>;
}

export async function setup(trx: Transaction<DB>): Promise<Setup> {
  const box = await createOrgWithMailbox(trx);
  const mailbox = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", box.mailboxId)
    .executeTakeFirstOrThrow();
  const folderMap = { drafts: "Drafts", sent: "Sent" };
  await trx
    .updateTable("mailboxes")
    .set({ folder_map: JSON.stringify(folderMap) })
    .where("id", "=", box.mailboxId)
    .execute();
  const fake = createFakeMailProvider();
  await fake.ensureFolder("Drafts");
  await fake.ensureFolder("Sent");
  return {
    ctx: { orgId: box.orgId },
    userId: box.userId,
    mailboxId: box.mailboxId,
    address: mailbox.address,
    fake,
    sender: createFakeMailSender(),
    folderMap,
  };
}

export interface Recorded {
  sent: { delegationId: string; sentMessageId: string; sentAt: Date; dueAtWhenNull: Date }[];
  reminders: { delegationId: string; at: Date }[];
  cancelled: { delegationId: string; reason: string; at: Date }[];
}

export function recordingHooks(): { hooks: DelegationHooks; calls: Recorded } {
  const calls: Recorded = { sent: [], reminders: [], cancelled: [] };
  const hooks: DelegationHooks = {
    ...noDelegationHooks,
    onSent: async (_trx, _ctx, input) => {
      calls.sent.push(input);
      return true;
    },
    onReminderSent: async (_trx, _ctx, input) => {
      calls.reminders.push(input);
      return true;
    },
    onCancelled: async (_trx, _ctx, input) => {
      calls.cancelled.push(input);
      return true;
    },
  };
  return { hooks, calls };
}

export function depsOf(
  s: Setup,
  trx: Db | Transaction<DB>,
  time: Date = NOW,
  over: Partial<ApplyDeps> = {}
): ApplyDeps {
  const folders = createFolderResolver(
    { db: trx, now: () => time, provider: s.fake, mailboxId: s.mailboxId, folderMap: s.folderMap },
    s.ctx
  );
  return {
    db: trx,
    now: () => time,
    mailboxId: s.mailboxId,
    folders,
    mailbox: { address: s.address, capabilities: { uidplus: true }, folderMap: s.folderMap },
    owner: { displayName: "Owner" },
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender: s.sender,
    hooks: noDelegationHooks,
    appendFolders: new Set(),
    ...over,
  };
}

export const claimWhere = (trx: Transaction<DB>, s: Setup, time: Date) =>
  claimActions(trx, s.ctx, s.mailboxId, {
    now: time,
    limit: 20,
    staleBefore: new Date(time.getTime() - 10 * MINUTE_MS),
    filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
  });

export async function claimOne(trx: Transaction<DB>, s: Setup, id: string, time: Date = NOW): Promise<ClaimedAction> {
  const action = (await claimWhere(trx, s, time)).find((row) => row.id === id);
  if (action === undefined) throw new Error("the action was not claimed");
  return action;
}

export type PairOpts = Parameters<typeof insertDraftAndSend>[3];

// An approved send with an applied draft; the fake `Drafts` holds the draft message (the bytes of the draft APPEND).
export async function pair(trx: Transaction<DB>, s: Setup, { sendStatus, ...opts }: NonNullable<PairOpts> = {}) {
  const ids = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
    createdAt: CREATED,
    draftStatus: "applied",
    draftProviderResult: { uid: 1, folder: "Drafts" },
    sendStatus: "approved",
    approved: { userId: s.userId, at: at(-1) },
    delegationId: DELEGATION_ID,
    ...opts,
  });
  const claimed = await claimOne(trx, s, ids.sendId);
  const draft = await trx.selectFrom("actions").selectAll().where("id", "=", ids.draftId).executeTakeFirstOrThrow();
  const draftRaw = await composeMessage(
    buildDraftMessage(depsOf(s, trx), {
      ...claimed,
      id: draft.id,
      created_at: draft.created_at,
      payload: draft.payload as Record<string, unknown>,
    })
  );
  await s.fake.appendMessage("Drafts", draftRaw, ["\\Draft"], CREATED);
  await releaseActions(trx, s.ctx, [ids.sendId], NOW, NOW);
  // The draft message needs a claimable send: the wanted status comes after.
  if (sendStatus !== undefined) {
    const unapproved = sendStatus === "awaiting_approval" || sendStatus === "rejected";
    await trx
      .updateTable("actions")
      .set({ status: sendStatus, ...(unapproved ? { approved_at: null, approved_by: null, approved_via: null } : {}) })
      .where("id", "=", ids.sendId)
      .execute();
  }
  return { ...ids, draftRaw };
}

export async function row(trx: Db | Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export async function reverses(trx: Db | Transaction<DB>, draftId: string) {
  return trx.selectFrom("actions").selectAll().where("reverses_action_id", "=", draftId).execute();
}

export async function applyOnce(
  trx: Transaction<DB>,
  s: Setup,
  id: string,
  time: Date = NOW,
  over: Partial<ApplyDeps> = {}
) {
  const action = await claimOne(trx, s, id, time);
  return applySend(depsOf(s, trx, time, over), s.ctx, action, s.fake);
}

export const smtp = (
  stage: SmtpSendError["stage"],
  code: string,
  responseCode: number | null,
  permanent: boolean,
  soft: boolean
) => new SmtpSendError(stage, code, responseCode, permanent, soft);
