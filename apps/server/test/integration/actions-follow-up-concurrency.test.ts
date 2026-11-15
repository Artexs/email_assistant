// F116 stage 10: the lock order of a follow-up (the loop first, then the send). A reply closes the loop while the committer
// sends the approved follow-up. Committed rows on several connections; the organizations and users are deleted at the end.
import { randomUUID } from "node:crypto";

import { sendPayloadFor, type DraftPayload } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  applySend,
  claimActions,
  createFolderResolver,
  noDelegationHooks,
  type ApplyDeps,
} from "../../src/modules/actions";
import { closeLoop, loopHooks } from "../../src/modules/loops";
import { composeMessage } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";
import { insertLoopActionPair, insertLoopRow, insertSentRow } from "./loops-fixtures";

const db = testDb();
const orgs: string[] = [];
const users: string[] = [];
afterAll(async () => {
  for (const id of orgs) await db.deleteFrom("organizations").where("id", "=", id).execute();
  for (const id of users) await db.deleteFrom("users").where("id", "=", id).execute();
  await db.destroy();
});

const MINUTE = 60_000;
const NOW = new Date();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = randomUUID();

interface Box {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
}

async function box(): Promise<Box> {
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

async function pair(b: Box, i: number): Promise<{ loopId: string; draftId: string; sendId: string }> {
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
      createdAt: new Date(NOW.getTime() - 60 * MINUTE),
      payloads: { draft, send: sendPayloadFor(draft) },
      draft: { provider_result: JSON.stringify({ folder: "Drafts", uid: 1 }) },
      send: { approved_at: new Date(NOW.getTime() - MINUTE), approved_by: b.userId, approved_via: "telegram" },
    });
    return { loopId, ...ids };
  });
}

function deps(b: Box, sender: ReturnType<typeof createFakeMailSender>, over: Partial<ApplyDeps> = {}): ApplyDeps {
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
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender: slow,
    hooks: noDelegationHooks,
    loopHooks: loopHooks(),
    appendFolders: new Set(),
    ...over,
  };
}

const claimAll = (b: Box) =>
  claimActions(db, b.ctx, b.mailboxId, {
    now: new Date(),
    limit: 50,
    staleBefore: new Date(Date.now() - 10 * MINUTE),
    filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
  });

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout (deadlock?)")), ms))]);
}

describe("a loop closes (a reply) while the committer sends: 20 loops", () => {
  test("each send ends applied with one mail, or expired / loop_closed with none; no deadlock", async () => {
    const b = await box();
    const sender = createFakeMailSender();
    const pairs: Awaited<ReturnType<typeof pair>>[] = [];
    for (let i = 0; i < 20; i += 1) pairs.push(await pair(b, i));
    const claimed = await claimAll(b);
    expect(claimed.length).toBe(20);
    const d = deps(b, sender);
    const results = await withTimeout(
      Promise.all(
        claimed.map(async (action, i) => {
          const p = pairs.find((x) => x.sendId === action.id);
          if (p === undefined) throw new Error("pair");
          const closer = (async () => {
            await sleep(Math.floor(Math.random() * 40));
            await db.transaction().execute(async (trx) => {
              await closeLoop(trx, b.ctx, { loopId: p.loopId, reason: "replied", at: new Date() });
              await sleep(i % 3);
            });
          })();
          const [out] = await Promise.all([applySend(d, b.ctx, action, b.fake), closer]);
          return { out, p };
        })
      ),
      8_000
    );
    let applied = 0;
    for (const { out, p } of results) {
      const r = await db.selectFrom("actions").selectAll().where("id", "=", p.sendId).executeTakeFirstOrThrow();
      const l = await db.selectFrom("open_loops").selectAll().where("id", "=", p.loopId).executeTakeFirstOrThrow();
      expect(l.status).toBe("closed");
      if (r.status === "applied") {
        applied += 1;
        expect(out).toEqual({ kind: "applied" });
        expect(l.follow_ups_sent).toBe(1);
      } else {
        expect(out).toEqual({ kind: "expired", reason: "loop_closed" });
        expect(r).toMatchObject({ status: "expired", status_reason: "loop_closed" });
        expect(l.follow_ups_sent).toBe(0);
      }
    }
    // One mail per applied send, none for an expired one.
    expect(sender.sent.length).toBe(applied);
  }, 10_000);
});
