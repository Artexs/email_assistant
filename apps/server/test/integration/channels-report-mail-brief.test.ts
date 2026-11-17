// F110 stage 19 with F116 stages 18 and 19: the brief and its marks belong to the Telegram digest row only. A mail row never
// marks a loop and never counts as the first digest of the day.
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { setMemberReportChannel, setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import {
  EIGHT,
  loopRow,
  ready,
  runDigests,
  SIXTEEN,
  waitingLoop,
  type BriefOrg,
} from "./channels-digest-brief-fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow } from "./loops-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const staleLoop = (trx: Transaction<DB>, org: BriefOrg) =>
  insertLoopRow(trx, org.ctx, org.mailboxId, {
    status: "closed",
    close_reason: "stale",
    closed_at: new Date("2026-11-19T10:00:00Z"),
    subject: "STALE-SUBJECT",
    due_at: new Date("2026-10-01T10:00:00Z"),
  });

async function setup(trx: Transaction<DB>, channel: "mail" | "both" | "telegram") {
  const org = await ready(trx);
  await setOrgFeature(trx, org.ctx, { flag: "report_mail", enabled: true, actor: "cli", now: new Date(EIGHT) });
  await setMemberReportChannel(trx, org.ctx, org.userId, { channel, mailboxId: org.mailboxId });
  return { org, open: await waitingLoop(trx, org), stale: await staleLoop(trx, org) };
}

// The stored view holds the text (a mail row has no renderer before stage 20).
const textOf = (row: { view: unknown } | undefined): string => (row?.view as { text: string }).text;

const rows = (trx: Transaction<DB>, orgId: string) =>
  trx
    .selectFrom("outbox")
    .select(["channel", "view", "dedup_key"])
    .where("org_id", "=", orgId)
    .where("kind", "=", "digest")
    .orderBy("dedup_key")
    .execute();

describe("a mail digest row and the brief", () => {
  test("a mail-only digest has no brief and marks no loop (stale_notified_at and surfaced_at stay null)", async () => {
    await withRollback(db, async (trx) => {
      const { org, open, stale } = await setup(trx, "mail");
      await runDigests(trx, EIGHT);
      const found = await rows(trx, org.ctx.orgId);
      expect(found.map((row) => row.channel)).toEqual(["mail"]);
      expect(textOf(found[0])).not.toContain("NEEDS YOU TODAY");
      expect(found[0]?.view).not.toHaveProperty("loopIds");
      expect((await loopRow(trx, stale)).stale_notified_at).toBeNull();
      expect((await loopRow(trx, open)).surfaced_at).toBeNull();
    });
  });

  test("with `both` the Telegram row has the brief and the marks; the mail row has neither", async () => {
    await withRollback(db, async (trx) => {
      const { org, open, stale } = await setup(trx, "both");
      await runDigests(trx, EIGHT);
      const found = await rows(trx, org.ctx.orgId);
      expect(found.map((row) => row.channel)).toEqual(["telegram", "mail"]);
      const [telegram, mail] = found;
      expect(telegram?.view).toHaveProperty("loopIds");
      expect(mail?.view).not.toHaveProperty("loopIds");
      expect(mail?.view).not.toHaveProperty("lineOf");
      expect(textOf(telegram)).toContain("NEEDS YOU TODAY");
      expect(textOf(mail)).not.toContain("NEEDS YOU TODAY");
      expect((await loopRow(trx, stale)).stale_notified_at).toEqual(new Date(EIGHT));
      expect((await loopRow(trx, open)).surfaced_at).toEqual(new Date(EIGHT));
    });
  });

  test("a mail row is not the first digest of the day: the next Telegram digest of the day has the brief", async () => {
    await withRollback(db, async (trx) => {
      const { org, stale } = await setup(trx, "mail");
      await runDigests(trx, EIGHT);
      await setMemberReportChannel(trx, org.ctx, org.userId, { channel: "telegram", mailboxId: null });
      await runDigests(trx, SIXTEEN);
      const found = await rows(trx, org.ctx.orgId);
      expect(found.map((row) => row.channel)).toEqual(["mail", "telegram"]);
      expect(found[1]?.view).toHaveProperty("loopIds");
      expect((await loopRow(trx, stale)).stale_notified_at).toEqual(new Date(SIXTEEN));
    });
  });
});
