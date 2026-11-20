// Carry-over of the review of the detail migration: /pause and /resume at the minimal level, the panel link of a card edit, and the check render of
// `queueNotice` at both levels. Every test runs in a transaction that is rolled back.
import { randomUUID } from "node:crypto";

import { noticeRenderers, MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import {
  createOutboxSender,
  pauseMailboxes,
  queueCardEdits,
  queueNotice,
  resumeMailboxes,
  type CommandDeps,
  type LinkedChat,
} from "../../src/modules/channels";
import { createFakeChannel } from "../../src/modules/channels/fake/channel";
import { insertDefaultSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { insertMailbox } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertDraftAndSend,
  insertTestEmail,
  isolateChannels,
  linkChat,
  randomChatId,
  testCapabilities,
  testNoticeView,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
afterAll(async () => {
  await db.destroy();
});

let spies: ReturnType<typeof spyOn>[] = [];
beforeEach(() => {
  spies = [
    spyOn(console, "log").mockImplementation((): void => undefined),
    spyOn(console, "error").mockImplementation((): void => undefined),
    spyOn(console, "warn").mockImplementation((): void => undefined),
  ];
});
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

// 11:00 in Europe/Warsaw (UTC+1): outside the default quiet hours.
const T = new Date("2026-11-20T10:00:00Z");
const BASE = "https://ea.example.ts.net";
const CANARY = "CANARY-SUBJECT-5e17";

type Level = "full" | "minimal";

interface World {
  ctx: TenantContext;
  orgId: string;
  mailboxId: string;
  address: string;
  userId: string;
  chatId: number;
}

async function world(trx: Transaction<DB>, member: Level): Promise<World> {
  await isolateChannels(trx);
  const address = `first-${randomUUID()}@x.test`;
  const created = await createOrgWithMailbox(trx, { address });
  const ctx = { orgId: created.orgId };
  await insertDefaultSettings(trx, ctx, created.mailboxId);
  const chatId = randomChatId();
  await linkChat(trx, ctx, created.userId, chatId, new Date(T.getTime() - 30 * DAY_MS));
  await setOrgFeature(trx, ctx, { flag: "telegram_minimal", enabled: true, actor: "cli", now: T });
  await trx
    .updateTable("memberships")
    .set({ telegram_detail: member })
    .where("org_id", "=", created.orgId)
    .where("user_id", "=", created.userId)
    .execute();
  return { ctx, orgId: created.orgId, mailboxId: created.mailboxId, address, userId: created.userId, chatId };
}

const linkOf = (w: World, locale: "en" | "pl" = "en"): LinkedChat => ({
  orgId: w.orgId,
  userId: w.userId,
  role: "owner",
  chatId: w.chatId,
  linkedAt: new Date(T.getTime() - 30 * DAY_MS),
  locale,
});

function depsAt(trx: Transaction<DB>): CommandDeps {
  return {
    db: trx,
    now: () => T,
    llmDailyCap: 300,
    triageScope: "all",
    actionsScope: { kind: "off" },
    llm: { provider: "gemini", classifierModel: "gemini-3.5-flash-lite" },
    hooks: noDelegationHooks,
    uidplus: async () => true,
    sendScope: { kind: "off" },
    testMail: NO_TEST_SENDERS,
    operatorContact: null,
    syncEveryMin: 2,
    webBaseUrl: BASE,
  };
}

async function addMailbox(trx: Transaction<DB>, w: World, address: string): Promise<string> {
  const id = randomUUID();
  await insertMailbox(trx, w.ctx, {
    id,
    address,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  return id;
}

describe("/pause and /resume name the mailboxes by their place at the minimal level", () => {
  test("1. minimal: Mailbox 1 and Mailbox 2, no address, in both languages, and the skip lines too", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, "minimal");
      const second = `second-${randomUUID()}@x.test`;
      const third = `third-${randomUUID()}@x.test`;
      await addMailbox(trx, w, second);
      const thirdId = await addMailbox(trx, w, third);
      // The third mailbox has a login error: it is skipped with its own line, which must not name the address either.
      await trx.updateTable("mailboxes").set({ status: "auth_error" }).where("id", "=", thirdId).execute();
      const addresses = [w.address, second, third];

      const paused = (await pauseMailboxes(depsAt(trx), linkOf(w))).text;
      expect(paused).toContain("Mailbox 1");
      expect(paused).toContain("Mailbox 2");
      for (const address of addresses) expect(paused).not.toContain(address);
      expect(paused).toContain("Mailbox 3");

      const again = (await pauseMailboxes(depsAt(trx), linkOf(w))).text;
      expect(again).toContain("Mailbox 1");
      for (const address of addresses) expect(again).not.toContain(address);

      const resumed = (await resumeMailboxes(depsAt(trx), linkOf(w))).text;
      expect(resumed).toContain("Mailbox 1");
      for (const address of addresses) expect(resumed).not.toContain(address);

      const pl = (await pauseMailboxes(depsAt(trx), linkOf(w, "pl"))).text;
      expect(pl).toContain("Skrzynka 1");
      for (const address of addresses) expect(pl).not.toContain(address);
    });
  });

  test("2. full, and the flag off: the addresses, as before", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, "full");
      const paused = (await pauseMailboxes(depsAt(trx), linkOf(w))).text;
      expect(paused).toContain(w.address);
      expect(paused).not.toContain("Mailbox 1");
      await resumeMailboxes(depsAt(trx), linkOf(w));

      const m = await world(trx, "minimal");
      await setOrgFeature(trx, m.ctx, { flag: "telegram_minimal", enabled: false, actor: "cli", now: T });
      expect((await pauseMailboxes(depsAt(trx), linkOf(m))).text).toContain(m.address);
    });
  });

  test("3. the numbers are the order of /status: a mailbox keeps its number when an earlier one is skipped", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, "minimal");
      const second = `second-${randomUUID()}@x.test`;
      await addMailbox(trx, w, second);
      // The list is ordered by creation time, then id: rows of one transaction share the time, so the first one is made older than the real clock.
      await trx
        .updateTable("mailboxes")
        .set({ status: "paused", created_at: new Date("2020-01-01T00:00:00Z") })
        .where("id", "=", w.mailboxId)
        .execute();
      const paused = (await pauseMailboxes(depsAt(trx), linkOf(w))).text;
      expect(paused).toContain("Mailbox 1 was paused already.");
      expect(paused).toContain("Paused: Mailbox 2");
    });
  });
});

async function approvalCard(trx: Transaction<DB>, w: World) {
  const { emailId, sendId } = await insertDraftAndSend(trx, w.ctx, w.mailboxId, { sendStatus: "awaiting_approval" });
  const cardId = await queueNotice(trx, w.ctx, {
    userId: w.userId,
    locale: "en",
    kind: "approval",
    dedupKey: `approval:${sendId}`,
    emailId,
    mailboxId: w.mailboxId,
    view: { ...testNoticeView("approval", { marker: CANARY, emailId, at: T }), actionId: sendId } as never,
    eventAt: T,
    now: T,
  });
  return { emailId, sendId, cardId };
}

describe("the edit of a card through the sender at the minimal level", () => {
  test("4. a card sent at full, the member at minimal: the edit has no button and the panel link of the send", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, "full");
      const { sendId } = await approvalCard(trx, w);
      const channel = createFakeChannel();
      await createOutboxSender({ db: trx, channel, now: () => T, webBaseUrl: BASE }).run();
      const card = channel.sent[0]?.message;
      expect(card?.buttons.flat().length).toBeGreaterThan(0);
      expect(card?.text).not.toContain("/approvals");

      await trx
        .updateTable("actions")
        .set({ status: "approved", approved_by: w.userId, approved_at: T })
        .where("id", "=", sendId)
        .execute();
      const later = new Date(T.getTime() + MINUTE_MS);
      await queueCardEdits(trx, w.ctx, { sendId, outcome: "approved_held", heldBy: "paused", at: later });
      await trx
        .updateTable("memberships")
        .set({ telegram_detail: "minimal" })
        .where("org_id", "=", w.orgId)
        .where("user_id", "=", w.userId)
        .execute();
      await createOutboxSender({ db: trx, channel, now: () => later, webBaseUrl: BASE }).run();

      const edit = channel.edited[0]?.message;
      expect(edit?.buttons).toEqual([]);
      expect(edit?.text.startsWith(card?.text ?? "?")).toBe(true);
      expect(edit?.text.endsWith(`\n${BASE}/approvals?id=${sendId}`)).toBe(true);
    });
  });

  test("5. a card sent at minimal has the link already: the edit holds it once", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, "minimal");
      const { sendId } = await approvalCard(trx, w);
      const channel = createFakeChannel();
      await createOutboxSender({ db: trx, channel, now: () => T, webBaseUrl: BASE }).run();
      await trx
        .updateTable("actions")
        .set({ status: "approved", approved_by: w.userId, approved_at: T })
        .where("id", "=", sendId)
        .execute();
      const later = new Date(T.getTime() + MINUTE_MS);
      await queueCardEdits(trx, w.ctx, { sendId, outcome: "approved", at: later });
      await createOutboxSender({ db: trx, channel, now: () => later, webBaseUrl: BASE }).run();
      const link = `${BASE}/approvals?id=${sendId}`;
      expect(channel.edited[0]?.message.text.split(link)).toHaveLength(2);
    });
  });

  test("6. the view of the edit holds the id of the send, and nothing else new", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, "minimal");
      const { sendId } = await approvalCard(trx, w);
      await createOutboxSender({ db: trx, channel: createFakeChannel(), now: () => T, webBaseUrl: BASE }).run();
      await queueCardEdits(trx, w.ctx, { sendId, outcome: "approved", at: new Date(T.getTime() + MINUTE_MS) });
      const row = await trx
        .selectFrom("outbox")
        .select("view")
        .where("kind", "=", "approval_edit")
        .executeTakeFirstOrThrow();
      expect(Object.keys(row.view as object).sort()).toEqual(["at", "original", "outcome", "sendId", "timeZone"]);
      expect((row.view as { sendId: string }).sendId).toBe(sendId);
    });
  });
});

describe("queueNotice checks the render at full always and at the level of the member", () => {
  async function queueUrgent(trx: Transaction<DB>, w: World): Promise<string | null> {
    const emailId = await insertTestEmail(trx, w.ctx, w.mailboxId);
    return queueNotice(trx, w.ctx, {
      userId: w.userId,
      locale: "en",
      kind: "urgent",
      dedupKey: `urgent:${randomUUID()}`,
      emailId,
      mailboxId: w.mailboxId,
      view: testNoticeView("urgent", { marker: CANARY, emailId, at: T }) as never,
      eventAt: T,
      now: T,
    });
  }

  test("7. a full render that throws stops the row for a minimal member too; a minimal render that throws stops it at minimal only", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, "minimal");
      const renderer = noticeRenderers.urgent.telegram;
      const { full, minimal } = renderer;
      try {
        renderer.full = () => {
          throw new Error("full render broke");
        };
        await expect(queueUrgent(trx, w)).rejects.toThrow();
        renderer.full = full;
        renderer.minimal = () => {
          throw new Error("minimal render broke");
        };
        await expect(queueUrgent(trx, w)).rejects.toThrow();
        // A full member does not need the minimal render.
        await trx
          .updateTable("memberships")
          .set({ telegram_detail: "full" })
          .where("org_id", "=", w.orgId)
          .where("user_id", "=", w.userId)
          .execute();
        expect(await queueUrgent(trx, w)).toBeString();
      } finally {
        renderer.full = full;
        renderer.minimal = minimal;
      }
      const rows = await trx.selectFrom("outbox").select("id").where("org_id", "=", w.orgId).execute();
      expect(rows).toHaveLength(1);
    });
  });
});
