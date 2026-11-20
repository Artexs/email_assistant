import { DAY_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { detectNotices } from "../../src/modules/channels";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setDigestTimes, setOrgFeature } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";

import { insertSuggestion, type Org } from "./contacts-fixtures";
import { linkChat, randomChatId, renderedOf, isolateChannels } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { seedWeek } from "./metrics-fixtures";

// The line of the rule suggestions in the weekly report (flag `sender_suggestions`). Monday 2026-11-23, Europe/Warsaw (UTC+1).
const db = testDb();
const MONDAY_0900 = new Date("2026-11-23T08:00:00Z");
const BASE = "https://panel.example.test/";

afterAll(async () => {
  await db.destroy();
});
const spies: { mockRestore(): void }[] = [];
beforeEach(() => {
  spies.push(spyOn(console, "log").mockImplementation((): void => undefined));
  spies.push(spyOn(console, "warn").mockImplementation((): void => undefined));
});
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

type FlagName = "weekly_report" | "sender_context" | "sender_suggestions";
const turn = (trx: Transaction<DB>, ctx: TenantContext, flag: FlagName, enabled: boolean) =>
  setOrgFeature(trx, ctx, { flag, enabled, actor: "cli", now: MONDAY_0900 });

async function setup(trx: Transaction<DB>, flags: { context: boolean; suggestions: boolean }) {
  await isolateChannels(trx);
  const { orgA, orgB } = await seedWeek(trx);
  await trx.updateTable("users").set({ locale: "pl" }).where("id", "=", orgA.ownerId).execute();
  await setDigestTimes(trx, orgA.ctx, orgA.ownerId, ["09:00"]);
  await linkChat(trx, orgA.ctx, orgA.ownerId, randomChatId(), new Date("2026-11-01T10:00:00Z"));
  await turn(trx, orgA.ctx, "weekly_report", true);
  await turn(trx, orgA.ctx, "sender_context", flags.context);
  await turn(trx, orgA.ctx, "sender_suggestions", flags.suggestions);
  const org: Org = { ctx: orgA.ctx, mailboxId: orgA.mailboxId, address: "" };
  const other: Org = { ctx: orgB.ctx, mailboxId: orgB.mailboxId, address: "" };
  return { org, other, ownerId: orgA.ownerId };
}

async function weeklyRow(trx: Transaction<DB>, orgId: string, baseUrl: string | undefined) {
  await detectNotices({
    db: trx,
    now: () => MONDAY_0900,
    startedAt: new Date(MONDAY_0900.getTime() - DAY_MS),
    testMail: NO_TEST_SENDERS,
    ...(baseUrl === undefined ? {} : { webBaseUrl: baseUrl }),
  });
  const row = await trx
    .selectFrom("outbox")
    .select(["kind", "text", "buttons", "view", "locale", "channel", "detail"])
    .where("org_id", "=", orgId)
    .where("kind", "=", "weekly_report")
    .executeTakeFirstOrThrow();
  return { view: row.view as { suggestions?: unknown }, text: renderedOf(row).text };
}

describe("the suggestion line of the weekly report", () => {
  test("1 flags on and 2 open rows: the view holds the count and the Rules link; the text has one line", async () => {
    await withRollback(db, async (trx) => {
      const { org } = await setup(trx, { context: true, suggestions: true });
      await insertSuggestion(trx, org, { value: "a@acme.pl", kind: "vip" });
      await insertSuggestion(trx, org, { value: "@corp.pl", scope: "domain", kind: "whitelist" });
      await insertSuggestion(trx, org, { value: "gone@acme.pl", kind: "vip", status: "dismissed" });
      const { view, text } = await weeklyRow(trx, org.ctx.orgId, BASE);
      expect(view.suggestions).toEqual({ open: 2, panelUrl: "https://panel.example.test/rules" });
      expect(text.split("\n").filter((line) => line.startsWith("💡"))).toEqual([
        "💡 Sugestie reguł do przejrzenia: 2 · https://panel.example.test/rules",
      ]);
      expect(text).not.toMatch(/acme|corp/);
    });
  });

  test("2 no WEB_BASE_URL: the view has no link and the line has the fixed phrase", async () => {
    await withRollback(db, async (trx) => {
      const { org } = await setup(trx, { context: true, suggestions: true });
      await insertSuggestion(trx, org, { value: "a@acme.pl", kind: "vip" });
      const { view, text } = await weeklyRow(trx, org.ctx.orgId, undefined);
      expect(view.suggestions).toEqual({ open: 1 });
      expect(text).toContain("💡 Sugestie reguł do przejrzenia: 1 · sprawdź w panelu");
    });
  });

  test("3 no open row: the view has no key and the text has no line", async () => {
    await withRollback(db, async (trx) => {
      const { org } = await setup(trx, { context: true, suggestions: true });
      await insertSuggestion(trx, org, { value: "gone@acme.pl", kind: "vip", status: "dismissed" });
      const { view, text } = await weeklyRow(trx, org.ctx.orgId, BASE);
      expect(view).not.toHaveProperty("suggestions");
      expect(text).not.toContain("💡");
    });
  });

  test("4 flag sender_suggestions off, or sender_context off, with open rows: no key, no line", async () => {
    for (const flags of [
      { context: true, suggestions: false },
      { context: false, suggestions: true },
    ]) {
      await withRollback(db, async (trx) => {
        const { org } = await setup(trx, flags);
        await insertSuggestion(trx, org, { value: "a@acme.pl", kind: "vip" });
        const { view, text } = await weeklyRow(trx, org.ctx.orgId, BASE);
        expect(view).not.toHaveProperty("suggestions");
        expect(text).not.toContain("💡");
      });
    }
  });

  test("5 only rows of active mailboxes count", async () => {
    await withRollback(db, async (trx) => {
      const { org } = await setup(trx, { context: true, suggestions: true });
      await insertSuggestion(trx, org, { value: "a@acme.pl", kind: "vip" });
      await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", org.mailboxId).execute();
      const { view } = await weeklyRow(trx, org.ctx.orgId, BASE);
      expect(view).not.toHaveProperty("suggestions");
    });
  });

  test("6 the open rows of another organization do not count", async () => {
    await withRollback(db, async (trx) => {
      const { org, other } = await setup(trx, { context: true, suggestions: true });
      await insertSuggestion(trx, org, { value: "a@acme.pl", kind: "vip" });
      await insertSuggestion(trx, other, { value: "b@acme.pl", kind: "vip" });
      await insertSuggestion(trx, other, { value: "c@acme.pl", kind: "vip" });
      const { view } = await weeklyRow(trx, org.ctx.orgId, BASE);
      expect(view.suggestions).toEqual({ open: 1, panelUrl: "https://panel.example.test/rules" });
    });
  });
});
