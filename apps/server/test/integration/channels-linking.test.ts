import { randomBytes } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { findChatLink, listLinkedChats, listLinkedChatsOfOrg } from "../../src/modules/channels";
import {
  LINK_TOKEN_PATTERN,
  consumeLinkToken,
  createLinkToken,
  hashLinkToken,
  unlinkUser,
} from "../../src/modules/channels/linking";
import { getChatLinkForUser } from "../../src/modules/channels/repo";
import { insertMembership } from "../../src/modules/tenancy/repo";
import type { DB } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";

import { addMember, createOrgWithMailbox, linkChat, randomChatId, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-06T10:00:00Z");
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

async function linkRows(trx: Transaction<DB>, orgId: string) {
  return trx.selectFrom("chat_links").selectAll().where("org_id", "=", orgId).execute();
}

async function auditRows(trx: Transaction<DB>, orgId: string, event: string) {
  return trx.selectFrom("audit_log").selectAll().where("org_id", "=", orgId).where("event", "=", event).execute();
}

describe("chat linking", () => {
  test("createLinkToken stores only the hash and sets the expiry", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const { token, expiresAt } = await createLinkToken(trx, { orgId }, userId, now);
      expect(token).toMatch(LINK_TOKEN_PATTERN);
      expect(expiresAt).toEqual(minutes(15));
      const rows = await trx.selectFrom("chat_link_tokens").selectAll().where("org_id", "=", orgId).execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.token_hash).toBe(hashLinkToken(token));
      expect(rows[0]?.expires_at).toEqual(minutes(15));
      expect(JSON.stringify(rows[0])).not.toContain(token);
    });
  });

  test("consumeLinkToken links the chat once", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const chatId = randomChatId();
      const { token } = await createLinkToken(trx, { orgId }, userId, now);

      const result = await consumeLinkToken(trx, { token, chatId, now: minutes(14) });
      expect(result).toEqual({ kind: "linked", orgId, userId });
      const links = await linkRows(trx, orgId);
      expect(links).toHaveLength(1);
      expect(Number(links[0]?.external_chat_id)).toBe(chatId);
      expect(links[0]?.linked_at).toEqual(minutes(14));
      const tokenRow = await trx
        .selectFrom("chat_link_tokens")
        .select("used_at")
        .where("token_hash", "=", hashLinkToken(token))
        .executeTakeFirstOrThrow();
      expect(tokenRow.used_at).toEqual(minutes(14));
      const audit = await auditRows(trx, orgId, "chat.linked");
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actor).toBe(userId);

      expect(await consumeLinkToken(trx, { token, chatId, now: minutes(14) })).toEqual({ kind: "used" });
      expect(await linkRows(trx, orgId)).toHaveLength(1);
    });
  });

  test("a token at exactly 15 minutes is expired", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const { token } = await createLinkToken(trx, { orgId }, userId, now);
      expect(await consumeLinkToken(trx, { token, chatId: randomChatId(), now: minutes(15) })).toEqual({
        kind: "expired",
      });
      expect(await linkRows(trx, orgId)).toHaveLength(0);
    });
  });

  test("unknown, malformed and bad chat ids link nothing", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const { token } = await createLinkToken(trx, { orgId }, userId, now);
      const wellFormed = randomBytes(32).toString("base64url");
      expect(await consumeLinkToken(trx, { token: wellFormed, chatId: randomChatId(), now })).toEqual({
        kind: "unknown",
      });
      expect(await consumeLinkToken(trx, { token: "short", chatId: randomChatId(), now })).toEqual({
        kind: "unknown",
      });
      for (const chatId of [0, -5, 1.5]) {
        expect(await consumeLinkToken(trx, { token, chatId, now })).toEqual({ kind: "unknown" });
      }
      const row = await trx
        .selectFrom("chat_link_tokens")
        .select("used_at")
        .where("token_hash", "=", hashLinkToken(token))
        .executeTakeFirstOrThrow();
      expect(row.used_at).toBeNull();
      expect(await linkRows(trx, orgId)).toHaveLength(0);
    });
  });

  test("a new token invalidates the older unused token", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const first = await createLinkToken(trx, { orgId }, userId, now);
      const second = await createLinkToken(trx, { orgId }, userId, minutes(1));
      const chatId = randomChatId();
      expect(await consumeLinkToken(trx, { token: first.token, chatId, now: minutes(2) })).toEqual({
        kind: "unknown",
      });
      expect(await consumeLinkToken(trx, { token: second.token, chatId, now: minutes(2) })).toEqual({
        kind: "linked",
        orgId,
        userId,
      });
    });
  });

  test("a chat that belongs to another member moves to the token's member", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId: a } = await createOrgWithMailbox(trx);
      const b = await addMember(trx, orgId);
      const chatC = randomChatId();
      await linkChat(trx, { orgId }, a, chatC, now);

      const { token } = await createLinkToken(trx, { orgId }, b, now);
      expect((await consumeLinkToken(trx, { token, chatId: chatC, now })).kind).toBe("linked");
      expect((await findChatLink(trx, chatC))?.userId).toBe(b);
      expect(await getChatLinkForUser(trx, { orgId }, a)).toBeUndefined();
      const moved = await auditRows(trx, orgId, "chat.unlinked");
      expect(moved).toHaveLength(1);
      expect(moved[0]?.reason_code).toBe("chat_moved");
      expect(moved[0]?.data).toEqual({ channel: "telegram", user_id: a });

      // A links again from chat D: chat C's row (now B's) stays, A's only link is D.
      const chatD = randomChatId();
      const again = await createLinkToken(trx, { orgId }, a, now);
      expect((await consumeLinkToken(trx, { token: again.token, chatId: chatD, now })).kind).toBe("linked");
      expect((await getChatLinkForUser(trx, { orgId }, a))?.chatId).toBe(chatD);
      expect((await findChatLink(trx, chatC))?.userId).toBe(b);
    });
  });

  test("a member who links again from a new chat drops the old chat row", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const chatC = randomChatId();
      const chatD = randomChatId();
      await linkChat(trx, { orgId }, userId, chatC, now);
      const { token } = await createLinkToken(trx, { orgId }, userId, now);
      await consumeLinkToken(trx, { token, chatId: chatD, now });
      const links = await linkRows(trx, orgId);
      expect(links).toHaveLength(1);
      expect(Number(links[0]?.external_chat_id)).toBe(chatD);
      expect(await findChatLink(trx, chatC)).toBeUndefined();
    });
  });

  test("a member who links the same chat again gets no chat_moved row", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const chatC = randomChatId();
      await linkChat(trx, { orgId }, userId, chatC, now);
      const { token } = await createLinkToken(trx, { orgId }, userId, now);
      expect((await consumeLinkToken(trx, { token, chatId: chatC, now })).kind).toBe("linked");
      expect((await findChatLink(trx, chatC))?.userId).toBe(userId);
      expect(await auditRows(trx, orgId, "chat.unlinked")).toHaveLength(0);
    });
  });

  test("createLinkToken rejects a user of another organization", async () => {
    await withRollback(db, async (trx) => {
      const x = await createOrgWithMailbox(trx);
      const y = await createOrgWithMailbox(trx);
      await expect(createLinkToken(trx, { orgId: x.orgId }, y.userId, now)).rejects.toBeInstanceOf(HardError);
    });
  });

  test("findChatLink and getChatLinkForUser", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const other = await createOrgWithMailbox(trx);
      const chatId = randomChatId();
      await linkChat(trx, { orgId }, userId, chatId, now);

      const found = await findChatLink(trx, chatId);
      expect(found).toEqual({ orgId, userId, role: "owner", chatId, linkedAt: now, locale: "pl" });
      expect(typeof found?.chatId).toBe("number");
      expect(await findChatLink(trx, randomChatId())).toBeUndefined();
      expect(await getChatLinkForUser(trx, { orgId: other.orgId }, userId)).toBeUndefined();
      expect(await getChatLinkForUser(trx, { orgId }, userId)).toEqual(found);
    });
  });

  test("unlinkUser deletes the link and audits once", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const chatId = randomChatId();
      await linkChat(trx, { orgId }, userId, chatId, now);

      expect(await unlinkUser(trx, { orgId }, userId, now)).toBe(1);
      expect(await findChatLink(trx, chatId)).toBeUndefined();
      const unlinked = await auditRows(trx, orgId, "chat.unlinked");
      expect(unlinked).toHaveLength(1);
      expect(unlinked[0]?.data).toEqual({ channel: "telegram", user_id: userId, links: 1 });

      expect(await unlinkUser(trx, { orgId }, userId, now)).toBe(0);
      expect(await auditRows(trx, orgId, "chat.unlinked")).toHaveLength(1);
    });
  });

  test("unlinkUser removes only the link of the given organization", async () => {
    await withRollback(db, async (trx) => {
      const p = await createOrgWithMailbox(trx);
      const q = await createOrgWithMailbox(trx);
      await insertMembership(trx, { orgId: q.orgId }, { userId: p.userId, role: "assistant" });
      const chatP = randomChatId();
      const chatQ = randomChatId();
      await linkChat(trx, { orgId: p.orgId }, p.userId, chatP, now);
      await linkChat(trx, { orgId: q.orgId }, p.userId, chatQ, now);

      expect(await unlinkUser(trx, { orgId: q.orgId }, p.userId, now)).toBe(1);
      expect(await findChatLink(trx, chatQ)).toBeUndefined();
      expect((await findChatLink(trx, chatP))?.orgId).toBe(p.orgId);
      expect(await getChatLinkForUser(trx, { orgId: p.orgId }, p.userId)).toBeDefined();
    });
  });

  test("a chat moves between organizations", async () => {
    await withRollback(db, async (trx) => {
      const p = await createOrgWithMailbox(trx);
      const q = await createOrgWithMailbox(trx);
      const chatE = randomChatId();
      await linkChat(trx, { orgId: p.orgId }, p.userId, chatE, now);

      const { token } = await createLinkToken(trx, { orgId: q.orgId }, q.userId, now);
      expect((await consumeLinkToken(trx, { token, chatId: chatE, now })).kind).toBe("linked");
      expect((await findChatLink(trx, chatE))?.orgId).toBe(q.orgId);
      expect(await getChatLinkForUser(trx, { orgId: p.orgId }, p.userId)).toBeUndefined();
      const moved = await auditRows(trx, p.orgId, "chat.unlinked");
      expect(moved).toHaveLength(1);
      expect(moved[0]?.data).toEqual({ channel: "telegram", user_id: p.userId });
      expect(await auditRows(trx, q.orgId, "chat.unlinked")).toHaveLength(0);
    });
  });

  test("listLinkedChats contains the test links", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const second = await addMember(trx, orgId);
      const chatA = randomChatId();
      const chatB = randomChatId();
      await linkChat(trx, { orgId }, userId, chatA, now);
      await linkChat(trx, { orgId }, second, chatB, now);
      const all = await listLinkedChats(trx, { includeSuspended: true });
      expect(all).toContainEqual({ orgId, userId, role: "owner", chatId: chatA, linkedAt: now, locale: "pl" });
      expect(all).toContainEqual({
        orgId,
        userId: second,
        role: "assistant",
        chatId: chatB,
        linkedAt: now,
        locale: "pl",
      });
    });
  });

  test("a linked chat carries the locale of its member; no locale means Polish", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const english = await addMember(trx, orgId);
      const polish = await addMember(trx, orgId);
      await trx.updateTable("users").set({ locale: "en" }).where("id", "=", english).execute();
      await trx.updateTable("users").set({ locale: "pl" }).where("id", "=", polish).execute();
      const chats = { [userId]: randomChatId(), [english]: randomChatId(), [polish]: randomChatId() };
      for (const [id, chatId] of Object.entries(chats)) await linkChat(trx, { orgId }, id, chatId, now);
      const expected = new Map<string, "pl" | "en">([
        [userId, "pl"],
        [english, "en"],
        [polish, "pl"],
      ]);

      const ofOrg = await listLinkedChatsOfOrg(trx, { orgId });
      const all = await listLinkedChats(trx, { includeSuspended: true });
      for (const [id, chatId] of Object.entries(chats)) {
        const want = expected.get(id);
        expect(ofOrg.find((link) => link.userId === id)?.locale).toBe(want);
        expect(all.find((link) => link.userId === id)?.locale).toBe(want);
        expect((await getChatLinkForUser(trx, { orgId }, id))?.locale).toBe(want);
        expect((await findChatLink(trx, chatId))?.locale).toBe(want);
      }
    });
  });

  test("listLinkedChats skips a suspended organization unless asked", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await linkChat(trx, { orgId: a.orgId }, a.userId, randomChatId(), now);
      await linkChat(trx, { orgId: b.orgId }, b.userId, randomChatId(), now);
      await suspendOrg(trx, b.orgId);
      const active = (await listLinkedChats(trx, { includeSuspended: false })).map((link) => link.orgId);
      expect(active).toContain(a.orgId);
      expect(active).not.toContain(b.orgId);
      const all = (await listLinkedChats(trx, { includeSuspended: true })).map((link) => link.orgId);
      expect(all).toContain(a.orgId);
      expect(all).toContain(b.orgId);
    });
  });
});
