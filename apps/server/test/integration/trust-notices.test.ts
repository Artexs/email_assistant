import { randomUUID } from "node:crypto";

import { NoticeViewError, renderNotice } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { type Transaction } from "kysely";

import { queueTrustNotice, trustReportUrlOf, trustSettingsUrlOf } from "../../src/modules/channels";
import type { DB } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, linkChat, randomChatId } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// `queueTrustNotice` queues one Telegram row per linked owner. The history check, the tripwire and the re-gate call it in their
// own transaction.
const db = testDb();
const now = new Date("2026-11-15T10:00:00Z");

afterAll(async () => {
  await db.destroy();
});

const readyView = (mailboxId: string, reportUrl: string | null = null) => ({
  mailboxId,
  recommended: ["info" as const],
  blocked: 2,
  checked: 120,
  reportUrl,
});
const pausedView = (mailboxId: string, settingsUrl: string | null = null) => ({
  mailboxId,
  category: "info" as const,
  reason: "corrections" as const,
  corrections: 2,
  settingsUrl,
});

// An org with two linked owners (one reads Polish), one linked non-owner member and one unlinked owner.
async function setup(trx: Transaction<DB>) {
  const { orgId, userId: owner1, mailboxId } = await createOrgWithMailbox(trx);
  const ctx = { orgId };
  const owner2 = await addMember(trx, orgId, "owner");
  await trx.updateTable("users").set({ locale: "pl" }).where("id", "=", owner2).execute();
  const member = await addMember(trx, orgId, "assistant");
  await addMember(trx, orgId, "owner"); // an owner without a chat link: no row
  for (const userId of [owner1, owner2, member]) await linkChat(trx, ctx, userId, randomChatId(), now);
  return { ctx, owner1, owner2, member, mailboxId };
}

const rowsOf = (trx: Transaction<DB>, orgId: string) =>
  trx
    .selectFrom("outbox")
    .select(["user_id", "kind", "dedup_key", "mailbox_id", "locale", "channel", "status", "view"])
    .where("org_id", "=", orgId)
    .orderBy("user_id")
    .execute();

describe("queueTrustNotice", () => {
  test("T3: two linked owners and one linked member give two rows; a second call adds none", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, owner1, owner2, member, mailboxId } = await setup(trx);
      const input = { kind: "trust_report_ready" as const, view: readyView(mailboxId), mailboxId, now };
      expect(await queueTrustNotice(trx, ctx, input)).toBe(2);
      expect(await queueTrustNotice(trx, ctx, input)).toBe(0);
      const rows = await rowsOf(trx, ctx.orgId);
      expect(rows.map((row) => row.user_id).sort()).toEqual([owner1, owner2].sort());
      expect(rows.some((row) => row.user_id === member)).toBe(false);
      for (const row of rows) {
        expect(row).toMatchObject({
          kind: "trust_report_ready",
          dedup_key: `trust_report:${mailboxId}`,
          mailbox_id: mailboxId,
          channel: "telegram",
          status: "pending",
        });
      }
      // The locale of each row is the locale of its user.
      expect(rows.find((row) => row.user_id === owner1)?.locale).toBe("en");
      expect(rows.find((row) => row.user_id === owner2)?.locale).toBe("pl");
    });
  });

  test("the stored view renders in the locale of the row", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, owner2, mailboxId } = await setup(trx);
      const view = readyView(mailboxId, `https://app.example.test/report?mailbox=${mailboxId}`);
      await queueTrustNotice(trx, ctx, { kind: "trust_report_ready", view, mailboxId, now });
      const row = (await rowsOf(trx, ctx.orgId)).find((r) => r.user_id === owner2);
      const rendered = renderNotice("trust_report_ready", row?.view, {
        channel: "telegram",
        detail: "full",
        locale: "pl",
      });
      expect(rendered.ok && rendered.message.text).toContain(
        `Raport: https://app.example.test/report?mailbox=${mailboxId}`
      );
    });
  });

  test("a pause is deduped per trip: the same trip adds none, another trip adds rows", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await setup(trx);
      const tripA = randomUUID();
      const tripB = randomUUID();
      const pause = (tripId: string) => ({
        kind: "autonomy_paused" as const,
        view: pausedView(mailboxId),
        mailboxId,
        tripId,
        now,
      });
      expect(await queueTrustNotice(trx, ctx, pause(tripA))).toBe(2);
      expect(await queueTrustNotice(trx, ctx, pause(tripA))).toBe(0);
      expect(await queueTrustNotice(trx, ctx, pause(tripB))).toBe(2);
      const keys = (await rowsOf(trx, ctx.orgId)).map((row) => row.dedup_key);
      expect([...new Set(keys)].sort()).toEqual([`autonomy_paused:${tripA}`, `autonomy_paused:${tripB}`].sort());
    });
  });

  test("a report notice and a pause of one mailbox do not share a dedup key", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await setup(trx);
      await queueTrustNotice(trx, ctx, { kind: "trust_report_ready", view: readyView(mailboxId), mailboxId, now });
      const added = await queueTrustNotice(trx, ctx, {
        kind: "autonomy_paused",
        view: pausedView(mailboxId),
        mailboxId,
        tripId: randomUUID(),
        now,
      });
      expect(added).toBe(2);
    });
  });

  test("an organization with no linked owner queues nothing", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      const member = await addMember(trx, orgId, "assistant");
      await linkChat(trx, ctx, member, randomChatId(), now);
      const added = await queueTrustNotice(trx, ctx, {
        kind: "trust_report_ready",
        view: readyView(mailboxId),
        mailboxId,
        now,
      });
      expect(added).toBe(0);
      expect(await rowsOf(trx, orgId)).toEqual([]);
    });
  });

  test("a view that does not match the strict schema queues nothing and throws NoticeViewError", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await setup(trx);
      const bad = { ...readyView(mailboxId), sender: "boss@corp.test" } as never;
      await expect(
        queueTrustNotice(trx, ctx, { kind: "trust_report_ready", view: bad, mailboxId, now })
      ).rejects.toBeInstanceOf(NoticeViewError);
      expect(await rowsOf(trx, ctx.orgId)).toEqual([]);
    });
  });

  test("a view of another mailbox than the row is refused", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await setup(trx);
      await expect(
        queueTrustNotice(trx, ctx, {
          kind: "trust_report_ready",
          view: readyView(randomUUID()),
          mailboxId,
          now,
        })
      ).rejects.toThrow("different mailboxes");
      expect(await rowsOf(trx, ctx.orgId)).toEqual([]);
    });
  });

  test("another organization gets no row (tenant scope)", async () => {
    await withRollback(db, async (trx) => {
      const a = await setup(trx);
      const b = await setup(trx);
      await queueTrustNotice(trx, a.ctx, {
        kind: "trust_report_ready",
        view: readyView(a.mailboxId),
        mailboxId: a.mailboxId,
        now,
      });
      expect(await rowsOf(trx, b.ctx.orgId)).toEqual([]);
      expect((await rowsOf(trx, a.ctx.orgId)).length).toBe(2);
    });
  });
});

describe("the link helpers (T4)", () => {
  const id = "22222222-2222-4222-8222-222222222222";

  test("no base URL gives null", () => {
    expect(trustReportUrlOf(undefined, id)).toBeNull();
    expect(trustSettingsUrlOf(undefined)).toBeNull();
  });

  test("a base URL gives the page link, with no double slash after a trailing slash", () => {
    expect(trustReportUrlOf("https://app.example.test/", id)).toBe(`https://app.example.test/report?mailbox=${id}`);
    expect(trustSettingsUrlOf("https://app.example.test")).toBe("https://app.example.test/settings");
    expect(trustSettingsUrlOf("https://app.example.test//")).toBe("https://app.example.test/settings");
  });

  test("a base URL that the view schema refuses gives null", () => {
    expect(trustReportUrlOf("not a url", id)).toBeNull();
    expect(trustSettingsUrlOf("ftp://app.example.test")).toBeNull();
  });
});
