import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { sentOriginOf } from "../../src/modules/actions";
import { insertMailbox } from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

interface Tenant {
  ctx: TenantContext;
  mailboxId: string;
  // A send that applies or applied needs an approval (check actions_send_approved_check).
  approved: { userId: string; at: Date };
}

async function tenant(trx: Transaction<DB>): Promise<Tenant> {
  const created = await createOrgWithMailbox(trx);
  return {
    ctx: { orgId: created.orgId },
    mailboxId: created.mailboxId,
    approved: { userId: created.userId, at: new Date("2026-11-20T09:00:00Z") },
  };
}

describe("sentOriginOf", () => {
  test("a draft with a send that went out, and that send, are system mail", async () => {
    await withRollback(db, async (trx) => {
      const a = await tenant(trx);
      const { draftId, sendId } = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applied",
        approved: a.approved,
      });
      expect(await sentOriginOf(trx, a.ctx, a.mailboxId, draftId)).toBe("system");
      expect(await sentOriginOf(trx, a.ctx, a.mailboxId, sendId)).toBe("system");
    });
  });

  test("a send that waits or was rejected leaves the draft a user draft", async () => {
    await withRollback(db, async (trx) => {
      const a = await tenant(trx);
      for (const sendStatus of ["awaiting_approval", "rejected"]) {
        const { draftId, sendId } = await insertDraftAndSend(trx, a.ctx, a.mailboxId, { sendStatus });
        expect(await sentOriginOf(trx, a.ctx, a.mailboxId, draftId)).toBe("draft");
        expect(await sentOriginOf(trx, a.ctx, a.mailboxId, sendId)).toBe("draft");
      }
    });
  });

  test("a send that started (send_started_at set) is system mail while it applies", async () => {
    await withRollback(db, async (trx) => {
      const a = await tenant(trx);
      const { draftId, sendId } = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applying",
        approved: a.approved,
      });
      expect(await sentOriginOf(trx, a.ctx, a.mailboxId, sendId)).toBe("draft");
      await trx
        .updateTable("actions")
        .set({ send_started_at: new Date("2026-11-20T10:00:00Z") })
        .where("id", "=", sendId)
        .execute();
      expect(await sentOriginOf(trx, a.ctx, a.mailboxId, sendId)).toBe("system");
      expect(await sentOriginOf(trx, a.ctx, a.mailboxId, draftId)).toBe("system");
    });
  });

  test("a value that is not an action of this mailbox and org is null", async () => {
    await withRollback(db, async (trx) => {
      const a = await tenant(trx);
      const { draftId } = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applied",
        approved: a.approved,
      });
      const otherMailboxId = crypto.randomUUID();
      await insertMailbox(trx, a.ctx, {
        id: otherMailboxId,
        address: `other-${otherMailboxId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: { idle: true, move: true, uidplus: true, condstore: false, specialUse: true, keywords: true },
        folderMap: { drafts: "Drafts" },
      });
      expect(await sentOriginOf(trx, a.ctx, a.mailboxId, "not-a-uuid")).toBeNull();
      expect(await sentOriginOf(trx, a.ctx, a.mailboxId, crypto.randomUUID())).toBeNull();
      expect(await sentOriginOf(trx, a.ctx, otherMailboxId, draftId)).toBeNull();
    });
  });

  test("an action id of a move, or a send id in another mailbox of the org, is null", async () => {
    await withRollback(db, async (trx) => {
      const a = await tenant(trx);
      const { emailId, sendId } = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applied",
        approved: a.approved,
      });
      const moveId = await insertAction(trx, a.ctx, emailId, { type: "move", status: "applied" });
      const otherMailboxId = crypto.randomUUID();
      await insertMailbox(trx, a.ctx, {
        id: otherMailboxId,
        address: `other-${otherMailboxId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: { idle: true, move: true, uidplus: true, condstore: false, specialUse: true, keywords: true },
        folderMap: { drafts: "Drafts" },
      });
      expect(await sentOriginOf(trx, a.ctx, a.mailboxId, moveId)).toBeNull();
      expect(await sentOriginOf(trx, a.ctx, otherMailboxId, sendId)).toBeNull();
    });
  });

  test("an erased email leaves no own action: null for the draft and the send", async () => {
    await withRollback(db, async (trx) => {
      const a = await tenant(trx);
      const { emailId, draftId, sendId } = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applied",
        approved: a.approved,
      });
      expect(await sentOriginOf(trx, a.ctx, a.mailboxId, sendId)).toBe("system");
      await trx.deleteFrom("emails").where("id", "=", emailId).where("org_id", "=", a.ctx.orgId).execute();
      expect(await sentOriginOf(trx, a.ctx, a.mailboxId, draftId)).toBeNull();
      expect(await sentOriginOf(trx, a.ctx, a.mailboxId, sendId)).toBeNull();
    });
  });

  test("another organization never sees the action", async () => {
    await withRollback(db, async (trx) => {
      const a = await tenant(trx);
      const b = await tenant(trx);
      const { draftId } = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applied",
        approved: a.approved,
      });
      expect(await sentOriginOf(trx, b.ctx, a.mailboxId, draftId)).toBeNull();
      expect(await sentOriginOf(trx, b.ctx, b.mailboxId, draftId)).toBeNull();
    });
  });

  test("a value that is not a uuid sends no query", async () => {
    const queries: string[] = [];
    const fake = new Proxy({}, { get: () => () => queries.push("query") }) as never;
    expect(await sentOriginOf(fake, { orgId: crypto.randomUUID() }, crypto.randomUUID(), "not-a-uuid")).toBeNull();
    expect(queries).toEqual([]);
  });
});
