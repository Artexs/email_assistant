import { randomUUID } from "node:crypto";

import { noticeViewSchemas, renderNotice, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import {
  queueDigest,
  createUpdateHandlers,
  digestNowMessage,
  reviewMessage,
  statusMessage,
  telegramDetailOf,
  type CommandDeps,
  type LinkedChat,
} from "../../src/modules/channels";
import { insertDefaultSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { insertMailbox, markSynced } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend, insertTriaged, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// The direct answers of the bot follow the detail level of the chat. The level is a fake here: `telegramDetailOf` reads
// `deps.detailOf`, and the effective level of the member without it (`channels-detail-send.test.ts` covers the real reader).
const T = new Date("2026-11-06T10:00:00Z");
const BASE = "https://ea.example.ts.net";
const SUBJECT = "MARKER-SUBJECT-4f2a";
const SENDER = "marker-sender-4f2a@mail.test";

const minimal = async (): Promise<"minimal"> => "minimal";
const full = async (): Promise<"full"> => "full";

function depsAt(trx: Transaction<DB>, extra: Partial<CommandDeps> = {}): CommandDeps {
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
    ...extra,
  };
}

async function setup(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const ctx = { orgId: a.orgId };
  await insertDefaultSettings(trx, ctx, a.mailboxId);
  await markSynced(trx, ctx, a.mailboxId, new Date("2026-11-06T09:55:00Z"));
  const link: LinkedChat = {
    orgId: a.orgId,
    userId: a.userId,
    role: "owner",
    chatId: 1,
    linkedAt: new Date(T.getTime() - 30 * DAY_MS),
    locale: "en",
  };
  return { a, ctx, link };
}

async function addMailbox(trx: Transaction<DB>, orgId: string): Promise<string> {
  const id = randomUUID();
  await insertMailbox(
    trx,
    { orgId },
    {
      id,
      address: `second-${id}@x.test`,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: {},
    }
  );
  return id;
}

describe("telegramDetailOf", () => {
  test("reads full while the flag is off, and the fake level when a test passes one", async () => {
    await withRollback(db, async (trx) => {
      const { link } = await setup(trx);
      expect(await telegramDetailOf(depsAt(trx), link)).toBe("full");
      expect(await telegramDetailOf(depsAt(trx, { detailOf: minimal }), link)).toBe("minimal");
    });
  });
});

describe("/digest at the minimal level", () => {
  test("1. no subject, no sender and no keyboard; counts and the link to the panel", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link } = await setup(trx);
      for (const [category, from] of [
        ["urgent", SENDER],
        ["urgent", SENDER],
        ["info", SENDER],
      ] as const) {
        await insertTriaged(trx, ctx, a.mailboxId, {
          category,
          createdAt: new Date(T.getTime() - HOUR_MS),
          subject: SUBJECT,
          from,
        });
      }

      const message = await digestNowMessage(depsAt(trx, { detailOf: minimal }), link);

      expect(message.buttons).toEqual([]);
      expect(message.text).not.toContain(SUBJECT);
      expect(message.text).not.toContain(SENDER);
      expect(message.text).not.toContain("@");
      expect(message.text.split("\n")).toEqual([
        "📬 Digest now · Fri 6 Nov 11:00",
        "NEEDS ACTION · 2: 2 urgent",
        "OTHER MAIL · 1: 1 info",
        `${BASE}/activity`,
      ]);
      // The same mail at the full level keeps its subject and its keyboard.
      const fullMessage = await digestNowMessage(depsAt(trx, { detailOf: full }), link);
      expect(fullMessage.text).toContain(SUBJECT);
      expect(fullMessage.buttons.length).toBeGreaterThan(0);
    });
  });

  test("the command handler gives the same answer, and the Polish text has no address either", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link } = await setup(trx);
      await insertTriaged(trx, ctx, a.mailboxId, {
        category: "urgent",
        createdAt: new Date(T.getTime() - HOUR_MS),
        subject: SUBJECT,
        from: SENDER,
      });
      const handlers = createUpdateHandlers(depsAt(trx, { detailOf: minimal }));
      const message = await handlers.command({ ...link, locale: "pl" }, "digest");
      expect(message.buttons).toEqual([]);
      expect(message.text).toContain("Podsumowanie teraz");
      expect(message.text).not.toContain(SUBJECT);
      expect(message.text).not.toContain("@");
    });
  });
});

describe("/review at the minimal level", () => {
  test("2. the panel line with the link, no mail and no keyboard; the full level lists the mail", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link } = await setup(trx);
      await setOrgFeature(trx, ctx, { flag: "review_command", enabled: true, actor: "cli", now: T });
      await insertTriaged(trx, ctx, a.mailboxId, {
        category: "info",
        createdAt: new Date(T.getTime() - HOUR_MS),
        subject: SUBJECT,
        from: SENDER,
      });

      const message = await reviewMessage(depsAt(trx, { detailOf: minimal }), link);
      expect(message).toEqual({ text: `🔎 The review is in the panel: ${BASE}/review`, buttons: [] });
      const pl = await reviewMessage(depsAt(trx, { detailOf: minimal, webBaseUrl: undefined }), {
        ...link,
        locale: "pl",
      });
      expect(pl).toEqual({ text: "🔎 Przegląd jest w panelu.", buttons: [] });

      const fullMessage = await reviewMessage(depsAt(trx, { detailOf: full }), link);
      expect(fullMessage.text).toContain(SUBJECT);
      expect(fullMessage.buttons.length).toBeGreaterThan(0);
    });
  });

  test("with the flag off the answer is the off text at both levels", async () => {
    await withRollback(db, async (trx) => {
      const { link } = await setup(trx);
      const off = await reviewMessage(depsAt(trx, { detailOf: full }), link);
      expect(await reviewMessage(depsAt(trx, { detailOf: minimal }), link)).toEqual(off);
    });
  });
});

describe("/status at the minimal level", () => {
  test("3. two mailboxes are Mailbox 1 and Mailbox 2, also in the approvals lines, and no address shows", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link } = await setup(trx);
      const second = await addMailbox(trx, a.orgId);
      await insertDraftAndSend(trx, ctx, a.mailboxId, {
        notifiedAt: new Date(T.getTime() - 2 * HOUR_MS),
        createdAt: new Date(T.getTime() - 3 * HOUR_MS),
      });
      const addresses = await trx
        .selectFrom("mailboxes")
        .select(["id", "address"])
        .where("org_id", "=", a.orgId)
        .execute();

      const fullText = (await statusMessage(depsAt(trx, { detailOf: full }), link)).text;
      // The order of the full text is the order of the minimal names.
      const order = addresses
        .map((row) => ({ ...row, at: fullText.indexOf(`📮 ${row.address}`) }))
        .sort((x, y) => x.at - y.at);
      expect(order.every((row) => row.at >= 0)).toBe(true);
      expect(fullText).toContain(`Approvals ${order[0]?.address}`);

      const text = (await statusMessage(depsAt(trx, { detailOf: minimal }), link)).text;
      expect(text).not.toContain("@");
      for (const row of addresses) expect(text).not.toContain(row.address);
      expect(text).toContain("📮 Mailbox 1");
      expect(text).toContain("📮 Mailbox 2");
      expect(text.indexOf("📮 Mailbox 1")).toBeLessThan(text.indexOf("📮 Mailbox 2"));
      const lines = text.split("\n").filter((line) => line.startsWith("Approvals"));
      expect(lines.map((line) => line.split(" · ")[0])).toEqual([
        expect.stringMatching(/^Approvals Mailbox [12]: /),
        expect.stringMatching(/^Approvals Mailbox [12]: /),
      ]);
      // The mailbox that holds the waiting send keeps its count under its new name.
      const first = order[0]?.id === a.mailboxId ? "Mailbox 1" : "Mailbox 2";
      expect(lines.find((line) => line.includes("1 waiting for your tap"))).toStartWith(`Approvals ${first}`);
      expect(second).not.toBe(a.mailboxId);

      const pl = (await statusMessage(depsAt(trx, { detailOf: minimal }), { ...link, locale: "pl" })).text;
      expect(pl).toContain("📮 Skrzynka 1");
      expect(pl).not.toContain("@");
    });
  });

  test("the full level and the default keep the addresses, byte for byte the same", async () => {
    await withRollback(db, async (trx) => {
      const { link } = await setup(trx);
      await addMailbox(trx, link.orgId);
      const base = (await statusMessage(depsAt(trx), link)).text;
      expect((await statusMessage(depsAt(trx, { detailOf: full }), link)).text).toBe(base);
      // Today's lines, exactly: the address after the mailbox mark and in the approvals line.
      const lines = base.split("\n");
      const addresses = await trx.selectFrom("mailboxes").select("address").where("org_id", "=", link.orgId).execute();
      expect(addresses).toHaveLength(2);
      for (const { address } of addresses) {
        expect(lines).toContain(`📮 ${address}`);
        expect(lines.filter((line) => line.startsWith(`Approvals ${address}: `))).toHaveLength(1);
      }
    });
  });
});

describe("the queued digest", () => {
  test("4. the Telegram row stores the counts; the minimal render of its view holds no mail text", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link } = await setup(trx);
      await insertTriaged(trx, ctx, a.mailboxId, {
        category: "urgent",
        createdAt: new Date(T.getTime() - HOUR_MS),
        subject: SUBJECT,
        from: SENDER,
      });
      const outboxId = await queueDigest(trx, link, {
        slot: { key: "2026-11-06T08:00", date: "2026-11-06", time: "08:00" },
        periodStart: new Date(T.getTime() - DAY_MS),
        now: T,
        timeZone: "Europe/Warsaw",
        testMail: NO_TEST_SENDERS,
        webBaseUrl: BASE,
      });
      const row = await trx
        .selectFrom("outbox")
        .select(["view", "text"])
        .where("id", "=", outboxId as string)
        .executeTakeFirstOrThrow();
      const parsed = noticeViewSchemas.digest.parse(row.view);
      expect(parsed.minimal?.action.urgent).toBe(1);
      expect(JSON.stringify(parsed.minimal)).not.toContain(SUBJECT);
      expect(JSON.stringify(parsed.minimal)).not.toContain(SENDER);
      const rendered = renderNotice("digest", row.view, {
        channel: "telegram",
        detail: "minimal",
        locale: "en",
        webBaseUrl: BASE,
      });
      expect(rendered.ok && rendered.message.text).toContain("NEEDS ACTION · 1: 1 urgent");
      expect(rendered.ok && rendered.message.text).not.toContain(SUBJECT);
      expect(rendered.ok && rendered.message.buttons).toEqual([]);
      // The full render of the same row keeps the subject (the level is chosen at send time).
      const fullRendered = renderNotice("digest", row.view, { channel: "telegram", detail: "full", locale: "en" });
      expect(fullRendered.ok && fullRendered.message.text).toContain(SUBJECT);
    });
  });
});
