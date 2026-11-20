import { AI_FOLDER_NAMES, MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { claimActions, createFolderResolver, type ApplyDeps, type ClaimedAction } from "../../src/modules/actions";
import { INBOX } from "../../src/modules/mail";
import {
  createFakeMailProvider,
  type FakeMailProvider,
  type FakeMailProviderOptions,
} from "../../src/modules/mail/fake";
import { contentHash } from "../../src/modules/mail/sync-rules";
import type { DB, TenantContext } from "../../src/platform/db";

import { applyDepsDefaults, createOrgWithMailbox, insertAction, insertTriagedWithActions } from "./fixtures";

export const NOW = new Date("2026-11-07T12:00:00Z");

export const RECEIVED = new Date(NOW.getTime() - HOUR_MS);

export const SINCE = new Date(RECEIVED.getTime() - DAY_MS);

// Interia: a protocol COPY gives a new UID (no MOVE, UIDPLUS); a webmail move keeps it.
export const INTERIA: FakeMailProviderOptions = {
  capabilities: { move: false, uidplus: true },
  keepUidOnCopy: false,
  keepUidOnUserMove: true,
};

export interface Setup {
  ctx: TenantContext;
  mailboxId: string;
  fake: FakeMailProvider;
}

export async function setup(trx: Transaction<DB>, options: FakeMailProviderOptions = INTERIA): Promise<Setup> {
  const box = await createOrgWithMailbox(trx);
  return { ctx: { orgId: box.orgId }, mailboxId: box.mailboxId, fake: createFakeMailProvider(options) };
}

export function depsOf(
  s: Setup,
  trx: Transaction<DB>,
  extra: { folderMap?: Record<string, string>; beforeCommit?: () => void; appendFolders?: string[] } = {}
): ApplyDeps {
  const folders = createFolderResolver(
    {
      db: trx,
      now: () => NOW,
      provider: s.fake,
      mailboxId: s.mailboxId,
      folderMap: extra.folderMap ?? { ...AI_FOLDER_NAMES },
    },
    s.ctx
  );
  return {
    db: trx,
    now: () => NOW,
    mailboxId: s.mailboxId,
    folders,
    ...applyDepsDefaults(),
    appendFolders: new Set(extra.appendFolders ?? []),
    beforeCommit: extra.beforeCommit,
  };
}

export function message(id: string) {
  return { messageId: id, from: "sender@x.test", to: ["owner@x.test"], subject: "s", date: RECEIVED };
}

export const MESSAGE_ID = "<move-1@x.test>";

export function deliver(s: Setup, folder: string, id: string = MESSAGE_ID): number {
  return s.fake.deliver(folder, message(id), { internalDate: RECEIVED });
}

// Inserts a row for the fake message at `folder`/`uid`, with one move action.
export async function insertMail(
  trx: Transaction<DB>,
  s: Setup,
  opts: {
    folder?: string;
    sourceFolder?: string;
    uid: number;
    messageId?: string;
    payload?: Record<string, string>;
    status?: string;
  }
): Promise<{ emailId: string; actionIds: string[] }> {
  const folder = opts.folder ?? INBOX;
  const meta = await s.fake.fetchMetaIn(folder, opts.uid);
  return insertTriagedWithActions(trx, s.ctx, s.mailboxId, {
    category: "info",
    createdAt: RECEIVED,
    receivedAt: RECEIVED,
    from: "sender@x.test",
    messageId: opts.messageId ?? MESSAGE_ID,
    folder,
    sourceFolder: opts.sourceFolder,
    uid: opts.uid,
    contentHash: contentHash(meta as NonNullable<typeof meta>),
    movedAt: folder === (opts.sourceFolder ?? INBOX) ? null : RECEIVED,
    actions: [{ type: "move", status: opts.status ?? "ready", payload: opts.payload ?? { folder: "ai_info" } }],
  });
}

export async function claim(trx: Transaction<DB>, s: Setup, at: Date = NOW): Promise<ClaimedAction[]> {
  return claimActions(trx, s.ctx, s.mailboxId, {
    now: at,
    limit: 20,
    staleBefore: new Date(at.getTime() - 10 * MINUTE_MS),
    filter: { mailbox: { kind: "all" }, send: { kind: "none" } },
  });
}

export async function actionState(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export async function emailState(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("emails").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export async function auditEvents(trx: Transaction<DB>, s: Setup) {
  return trx
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", s.ctx.orgId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

export const uidsIn = (s: Setup, folder: string): Promise<number[]> => s.fake.searchSinceIn(folder, SINCE);

export const callCount = (s: Setup, method: string): number => s.fake.calls.filter((call) => call === method).length;

export const REVERSE_AT = new Date(RECEIVED.getTime() + MINUTE_MS);

// A mail the system moved to `folder` (original `applied`) with a `ready` reverse. The mail sits in `folder` on the fake.
export async function insertMoved(
  trx: Transaction<DB>,
  s: Setup,
  opts: { folder: string; sourceFolder?: string; key: string; uid: number; uidInInbox: number; messageId?: string }
): Promise<{ emailId: string; originalId: string; reverseId: string }> {
  const meta = await s.fake.fetchMetaIn(opts.folder, opts.uid);
  const mail = await insertTriagedWithActions(trx, s.ctx, s.mailboxId, {
    category: "info",
    createdAt: RECEIVED,
    receivedAt: RECEIVED,
    from: "sender@x.test",
    messageId: opts.messageId ?? MESSAGE_ID,
    folder: opts.folder,
    sourceFolder: opts.sourceFolder,
    uid: opts.uid,
    sourceUid: opts.uidInInbox,
    contentHash: contentHash(meta as NonNullable<typeof meta>),
    movedAt: RECEIVED,
    actions: [{ type: "move", status: "applied", payload: { folder: opts.key } }],
  });
  const originalId = mail.actionIds[0] as string;
  const reverseId = await insertAction(trx, s.ctx, mail.emailId, {
    type: "move",
    status: "ready",
    payload: { folder: opts.key },
    reversesActionId: originalId,
    createdAt: REVERSE_AT,
  });
  return { emailId: mail.emailId, originalId, reverseId };
}
