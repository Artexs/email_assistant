import { MINUTE_MS } from "@ea/core";
import { expect } from "bun:test";
import type { Transaction } from "kysely";

import {
  claimActions,
  createFolderResolver,
  noDelegationHooks,
  type ApplyDeps,
  type ClaimedAction,
} from "../../src/modules/actions";
import { composeMessage } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";

export const NOW = new Date("2026-11-07T12:00:00Z");

export const CREATED = new Date("2026-11-07T11:00:00Z");

export interface Setup {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
  appended: Buffer[];
  folderMap: Record<string, string>;
}

// The fake keeps no readable raw: the wrapper records every APPEND.
export async function setup(trx: Transaction<DB>, opts: { folderMap?: Record<string, string> } = {}): Promise<Setup> {
  const box = await createOrgWithMailbox(trx);
  const mailbox = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", box.mailboxId)
    .executeTakeFirstOrThrow();
  const folderMap = opts.folderMap ?? { drafts: "Drafts" };
  await trx
    .updateTable("mailboxes")
    .set({ folder_map: JSON.stringify(folderMap) })
    .where("id", "=", box.mailboxId)
    .execute();
  const fake = createFakeMailProvider();
  if (opts.folderMap === undefined) await fake.ensureFolder("Drafts");
  const appended: Buffer[] = [];
  const append = fake.appendMessage.bind(fake);
  fake.appendMessage = async (folder, raw, flags, internalDate) => {
    appended.push(raw);
    return append(folder, raw, flags, internalDate);
  };
  return {
    ctx: { orgId: box.orgId },
    userId: box.userId,
    mailboxId: box.mailboxId,
    address: mailbox.address,
    fake,
    appended,
    folderMap,
  };
}

export function depsOf(s: Setup, trx: Db | Transaction<DB>, at: Date = NOW, over: Partial<ApplyDeps> = {}): ApplyDeps {
  const folders = createFolderResolver(
    { db: trx, now: () => at, provider: s.fake, mailboxId: s.mailboxId, folderMap: s.folderMap },
    s.ctx
  );
  return {
    db: trx,
    now: () => at,
    mailboxId: s.mailboxId,
    folders,
    mailbox: { address: s.address, capabilities: { uidplus: true }, folderMap: s.folderMap },
    owner: { displayName: "Owner" },
    organization: { timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender: null,
    hooks: noDelegationHooks,
    appendFolders: new Set(),
    ...over,
  };
}

export async function claimOne(trx: Transaction<DB>, s: Setup, id: string, at: Date = NOW): Promise<ClaimedAction> {
  const claimed = await claimActions(trx, s.ctx, s.mailboxId, {
    now: at,
    limit: 20,
    staleBefore: new Date(at.getTime() - 10 * MINUTE_MS),
    filter: { mailbox: { kind: "all" }, send: { kind: "none" } },
  });
  const action = claimed.find((row) => row.id === id);
  if (action === undefined) throw new Error("the draft was not claimed");
  return action;
}

export async function actionState(trx: Db | Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export async function reverseRows(trx: Db | Transaction<DB>, s: Setup, draftId: string) {
  return trx
    .selectFrom("actions")
    .selectAll()
    .where("org_id", "=", s.ctx.orgId)
    .where("reverses_action_id", "=", draftId)
    .execute();
}

export async function auditRows(trx: Transaction<DB>, s: Setup) {
  const rows = await trx
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", s.ctx.orgId)
    .where("event", "like", "action.%")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  for (const row of rows) {
    expect(row.action_id).not.toBeNull();
    expect(row.email_id).not.toBeNull();
  }
  return rows;
}

export async function draftUids(s: Setup, folder = "Drafts"): Promise<number[]> {
  return s.fake.searchSinceIn(folder, new Date(0));
}

export const MAIL = {
  createdAt: CREATED,
  from: "boss@x.test",
  subject: "Offer",
  messageId: "<orig-1@x.test>",
  bodyText: "Please prepare the offer",
};
