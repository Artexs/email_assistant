// Committed rows and real connections for the tests of a loop that closes while the committer sends.
import { randomUUID } from "node:crypto";

import { sendPayloadFor, type DraftPayload, MINUTE_MS, HOUR_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { claimActions, createFolderResolver, noDelegationHooks, type ApplyDeps } from "../../src/modules/actions";
import { loopHooks } from "../../src/modules/loops";
import { composeMessage } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import type { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { insertLoopActionPair, insertLoopRow, insertSentRow } from "./loops-fixtures";

export { MINUTE_MS as MINUTE } from "@ea/core";
export const NOW = new Date();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = randomUUID();

export interface Box {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
}

// A committed organization with a mailbox. The caller deletes `orgs` and `users` at the end.
export async function box(db: Db, orgs: string[], users: string[]): Promise<Box> {
  const b = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
  orgs.push(b.orgId);
  users.push(b.userId);
  const mb = await db.selectFrom("mailboxes").select("address").where("id", "=", b.mailboxId).executeTakeFirstOrThrow();
  await db
    .updateTable("mailboxes")
    .set({ folder_map: JSON.stringify({ drafts: "Drafts", sent: "Sent" }) })
    .where("id", "=", b.mailboxId)
    .execute();
  const fake = createFakeMailProvider();
  await fake.ensureFolder("Drafts");
  await fake.ensureFolder("Sent");
  return { ctx: { orgId: b.orgId }, userId: b.userId, mailboxId: b.mailboxId, address: mb.address, fake };
}

export async function pair(db: Db, b: Box, i: number): Promise<{ loopId: string; draftId: string; sendId: string }> {
  return db.transaction().execute(async (trx: Transaction<DB>) => {
    const to = [`c-anna-${i}-${run}@x.test`];
    const cc = [`c-jan-${i}-${run}@x.test`];
    const sent = await insertSentRow(trx, b.ctx, b.mailboxId, { toAddresses: to, ccAddresses: cc, subject: "S" });
    const loopId = await insertLoopRow(trx, b.ctx, b.mailboxId, {
      sent_email_id: sent,
      to_addresses: to,
      cc_addresses: cc,
      counterpart: to[0] ?? null,
      language: "en",
    });
    const draft: DraftPayload = {
      kind: "follow_up",
      loop_id: loopId,
      to,
      cc,
      language: "en",
      sent_at: "2026-11-10T09:30:00.000Z",
      subject: "S",
      quote: "Q",
      n: 1,
    };
    const ids = await insertLoopActionPair(trx, b.ctx, loopId, {
      draftStatus: "applied",
      sendStatus: "approved",
      createdAt: new Date(NOW.getTime() - HOUR_MS),
      payloads: { draft, send: sendPayloadFor(draft) },
      draft: { provider_result: JSON.stringify({ folder: "Drafts", uid: 1 }) },
      send: { approved_at: new Date(NOW.getTime() - MINUTE_MS), approved_by: b.userId, approved_via: "telegram" },
    });
    return { loopId, ...ids };
  });
}

export function committerDeps(
  db: Db,
  b: Box,
  sender: ReturnType<typeof createFakeMailSender>,
  over: Partial<ApplyDeps> = {}
): ApplyDeps {
  const slow = {
    send: async (input: Parameters<typeof sender.send>[0]) => {
      await sleep(Math.floor(Math.random() * 4));
      return sender.send(input);
    },
    close: () => sender.close(),
  } as unknown as ApplyDeps["sender"];
  return {
    db: db as Db,
    now: () => new Date(),
    mailboxId: b.mailboxId,
    folders: createFolderResolver(
      {
        db,
        now: () => new Date(),
        provider: b.fake,
        mailboxId: b.mailboxId,
        folderMap: { drafts: "Drafts", sent: "Sent" },
      },
      b.ctx
    ),
    mailbox: { address: b.address, capabilities: { uidplus: true }, folderMap: { drafts: "Drafts", sent: "Sent" } },
    owner: { displayName: "Owner" },
    organization: { timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender: slow,
    hooks: noDelegationHooks,
    loopHooks: loopHooks(),
    appendFolders: new Set(),
    ...over,
  };
}

export const claimAll = (db: Db, b: Box) =>
  claimActions(db, b.ctx, b.mailboxId, {
    now: new Date(),
    limit: 50,
    staleBefore: new Date(Date.now() - 10 * MINUTE_MS),
    filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
  });

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout (deadlock?)")), ms))]);
}
