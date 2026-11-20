import { randomUUID } from "node:crypto";

import { DAY_MS, STYLE_MAX_SOURCES } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { listStyleSources } from "../../src/modules/mail";
import { insertMailbox, insertInboxFolder } from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { addSent, fifteenDays, NOW, syntheticId } from "./style-sent-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const SINCE = new Date(NOW.getTime() - 14 * DAY_MS);
const READ = { since: SINCE, limit: STYLE_MAX_SOURCES, testOnly: null };

async function newOrg(trx: Transaction<DB>): Promise<{ ctx: TenantContext; mailboxId: string }> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  return { ctx: { orgId }, mailboxId };
}

describe("listStyleSources", () => {
  test("a row of the system, a row without text, an old row, an automatic reply, a list mail, a bulk mail, a calendar invite and a sent draft are left out", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await newOrg(trx);
      await addSent(trx, ctx, mailboxId, { origin: "system" });
      await addSent(trx, ctx, mailboxId, { content: "headers_only" });
      await addSent(trx, ctx, mailboxId, { body: null });
      await addSent(trx, ctx, mailboxId, { ageMs: fifteenDays });
      await addSent(trx, ctx, mailboxId, { autoSubmitted: "auto-replied" });
      await addSent(trx, ctx, mailboxId, { listId: "<news.client.test>" });
      await addSent(trx, ctx, mailboxId, { precedence: "bulk" });
      const invite = await addSent(trx, ctx, mailboxId, { body: "Zaproszenie" });
      await trx.updateTable("sent_emails").set({ has_calendar: true }).where("id", "=", invite).execute();
      await addSent(trx, ctx, mailboxId, { origin: "user", actionId: randomUUID(), body: "Wysłane z szkicu" });
      await addSent(trx, ctx, mailboxId, {
        body: "Dobry tekst",
        to: ["a@x.test"],
        cc: ["b@x.test"],
        autoSubmitted: "no",
      });

      expect(await listStyleSources(trx, ctx, mailboxId, READ)).toEqual([
        { bodyText: "Dobry tekst", toAddresses: ["a@x.test"], ccAddresses: ["b@x.test"] },
      ]);
    });
  });

  test("120 good rows give 100, the newest first", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await newOrg(trx);
      for (let n = 0; n < 120; n += 1) await addSent(trx, ctx, mailboxId, { body: `Mail ${n}`, order: n });

      const sources = await listStyleSources(trx, ctx, mailboxId, READ);

      expect(sources).toHaveLength(100);
      expect(sources[0]?.bodyText).toBe("Mail 0");
      expect(sources[99]?.bodyText).toBe("Mail 99");
    });
  });

  test("a row of another organization and a row of another mailbox of the same organization are absent", async () => {
    await withRollback(db, async (trx) => {
      const mine = await newOrg(trx);
      const foreign = await newOrg(trx);
      const siblingId = randomUUID();
      await insertMailbox(trx, mine.ctx, {
        id: siblingId,
        address: `sibling-${siblingId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await insertInboxFolder(trx, mine.ctx, siblingId);
      await addSent(trx, mine.ctx, mine.mailboxId, { body: "Mój" });
      await addSent(trx, mine.ctx, siblingId, { body: "Z drugiej skrzynki" });
      await addSent(trx, foreign.ctx, foreign.mailboxId, { body: "Obcy" });

      const sources = await listStyleSources(trx, mine.ctx, mine.mailboxId, READ);

      expect(sources.map((source) => source.bodyText)).toEqual(["Mój"]);
    });
  });

  test("testOnly keeps a row with a synthetic Message-ID or a test sender and drops the same row without them", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await newOrg(trx);
      await addSent(trx, ctx, mailboxId, { body: "Syntetyczny", messageId: syntheticId() });
      await addSent(trx, ctx, mailboxId, { body: "Od testowego", from: "Tester@Test.test" });
      await addSent(trx, ctx, mailboxId, { body: "Zwykły" });
      const testOnly = { senders: ["tester@test.test"] };

      const narrow = await listStyleSources(trx, ctx, mailboxId, { ...READ, testOnly });
      const all = await listStyleSources(trx, ctx, mailboxId, READ);

      expect(narrow.map((source) => source.bodyText).sort()).toEqual(["Od testowego", "Syntetyczny"]);
      expect(all).toHaveLength(3);
    });
  });
});
