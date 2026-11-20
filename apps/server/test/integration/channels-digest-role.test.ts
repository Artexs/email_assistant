import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import { detectNotices, digestNowMessage, scheduleDigests, type CommandDeps } from "../../src/modules/channels";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { buildDigest } from "../../src/modules/reports";
import { setDigestTimes, setMemberReportChannel, setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { EIGHT, loopRow, ready, waitingLoop, type BriefOrg } from "./channels-digest-brief-fixtures";
import { linkOf } from "./channels-loop-taps-fixtures";
import { addMember, insertDelegate, insertTriaged, linkChat, randomChatId, renderedOf } from "./fixtures";
import { consentRow, CURRENT_CONSENT } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow } from "./loops-fixtures";

// Draft, Drop, Reopen and Delegate are owner only, so the digest of a
// member has no such button, and the ⌛ line (one button, Reopen) goes to owners only and is not marked by a member's digest.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const request = (role: "owner" | "assistant") => ({
  kind: "scheduled" as const,
  periodStart: new Date("2026-11-19T00:00:00Z"),
  periodEnd: new Date(EIGHT),
  slot: { date: "2026-11-20", time: "08:00", late: false },
  now: new Date(EIGHT),
  locale: "en" as const,
  role,
  testMail: NO_TEST_SENDERS,
  loops: { firstOfDay: true, loopConsent: true },
});

const prefixes = (buttons: { data?: string }[][]) => buttons.flat().map((button) => (button.data ?? "").slice(0, 3));

async function world(
  trx: Transaction<DB>
): Promise<{ org: BriefOrg; waiting: string; promised: string; stale: string }> {
  const org = await ready(trx);
  const waiting = await waitingLoop(trx, org);
  const promised = await waitingLoop(trx, org, { kind: "promised", subject: "Promised budget" });
  const stale = await insertLoopRow(trx, org.ctx, org.mailboxId, {
    status: "closed",
    close_reason: "stale",
    closed_at: new Date("2026-11-19T10:00:00Z"),
    subject: "Old offer",
  });
  return { org, waiting, promised, stale };
}

describe("the keyboard of the brief by role", () => {
  test("an owner gets Draft, Later, Done, Drop and Reopen", async () => {
    await withRollback(db, async (trx) => {
      const { org } = await world(trx);
      const built = await buildDigest(trx, org.ctx, request("owner"));
      const found = prefixes(built.message.buttons);
      for (const prefix of ["lf:", "ll:", "lc:", "lx:", "lr:"]) expect(found).toContain(prefix);
      expect(built.message.text).toContain("Old offer");
    });
  });

  test("a member gets Later and Done only: no Draft, Drop or Reopen, no ⌛ line and no mark on the stale loop", async () => {
    await withRollback(db, async (trx) => {
      const { org, stale, waiting } = await world(trx);
      const built = await buildDigest(trx, org.ctx, request("assistant"));
      const found = new Set(prefixes(built.message.buttons));
      expect([...found].sort()).toEqual(["ll:", "lc:"].sort());
      expect(built.message.text).not.toContain("Old offer");
      expect(built.shown.stale).toEqual([]);
      // The lines of the open loops stay: a member may mark them done or move them.
      expect(built.shown.surfaced).toContain(waiting);
      expect((await loopRow(trx, stale)).stale_notified_at).toBeNull();
    });
  });

  test("the promised line of a member has Done and no Drop", async () => {
    await withRollback(db, async (trx) => {
      const { org, promised } = await world(trx);
      const member = await buildDigest(trx, org.ctx, request("assistant"));
      const owner = await buildDigest(trx, org.ctx, request("owner"));
      expect(member.shown.surfaced).toContain(promised);
      expect(owner.shown.surfaced).toContain(promised);
      expect(prefixes(member.message.buttons)).not.toContain("lx:");
      expect(prefixes(owner.message.buttons)).toContain("lx:");
    });
  });
});

describe("the Delegate button by role", () => {
  test("a triaged mail shows 👥 to an owner and not to a member", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await setOrgFeature(trx, org.ctx, { flag: "delegate_button", enabled: true, actor: "cli", now: new Date(EIGHT) });
      await insertDelegate(trx, org.ctx, { name: "Anna" });
      await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "needs_reply",
        createdAt: new Date("2026-11-20T06:00:00Z"),
        subject: "Budget question",
        from: "boss@y.test",
        fields: { language: "en" },
      });
      const owner = await buildDigest(trx, org.ctx, request("owner"));
      const member = await buildDigest(trx, org.ctx, request("assistant"));
      expect(prefixes(owner.message.buttons)).toContain("dg:");
      expect(prefixes(member.message.buttons)).not.toContain("dg:");
      // The on-demand digest follows the same rule.
      const onDemand = { ...request("assistant"), kind: "on_demand" as const, slot: null };
      expect(prefixes((await buildDigest(trx, org.ctx, onDemand)).message.buttons)).not.toContain("dg:");
      expect(prefixes((await buildDigest(trx, org.ctx, { ...onDemand, role: "owner" })).message.buttons)).toContain(
        "dg:"
      );
    });
  });
});

describe("the Delegate button of the urgent notice by role", () => {
  test("the owner's notice has it, the notice of a member of the same organization has not", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const now = new Date(EIGHT);
      await setOrgFeature(trx, org.ctx, { flag: "delegate_button", enabled: true, actor: "cli", now });
      await insertDelegate(trx, org.ctx, { name: "Anna" });
      const memberId = await addMember(trx, org.ctx.orgId);
      await linkChat(trx, org.ctx, memberId, randomChatId(), new Date("2026-11-05T20:00:00Z"));
      await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "urgent",
        createdAt: new Date(now.getTime() - 600_000),
        subject: "Offer for the autumn campaign",
        fields: { language: "en" },
      });
      await detectNotices({
        db: trx,
        now: () => now,
        startedAt: new Date(now.getTime() - HOUR_MS),
        testMail: NO_TEST_SENDERS,
      });
      const rows = await trx
        .selectFrom("outbox")
        .select(["user_id", "kind", "view", "channel", "detail", "locale", "text", "buttons"])
        .where("org_id", "=", org.ctx.orgId)
        .where("kind", "=", "urgent")
        .execute();
      expect(rows.map((row) => row.user_id).sort()).toEqual([org.userId, memberId].sort());
      const rowOf = (userId: string) =>
        rows.find((row) => row.user_id === userId) as NonNullable<(typeof rows)[number]>;
      expect(prefixes(renderedOf(rowOf(org.userId)).buttons)).toContain("dg:");
      expect(prefixes(renderedOf(rowOf(memberId)).buttons)).not.toContain("dg:");
    });
  });
});

describe("the role reaches the digest through the job and the /digest command", () => {
  test("the scheduled digest of a member has no owner button and no ⌛ line; the owner's has both", async () => {
    await withRollback(db, async (trx) => {
      const { org, stale } = await world(trx);
      const memberId = await addMember(trx, org.ctx.orgId);
      await linkChat(trx, org.ctx, memberId, randomChatId(), new Date("2026-11-05T20:00:00Z"));
      await setDigestTimes(trx, org.ctx, memberId, ["08:00"]);
      // The member has the consent too: only the role keeps the owner buttons away.
      await consentRow(trx, org.ctx.orgId, memberId, CURRENT_CONSENT, new Date("2026-11-05T21:00:00Z"));
      await scheduleDigests({ db: trx, now: () => new Date(EIGHT), testMail: NO_TEST_SENDERS });
      const rows = await trx
        .selectFrom("outbox")
        .select(["user_id", "kind", "view", "channel", "detail", "locale", "text", "buttons"])
        .where("org_id", "=", org.ctx.orgId)
        .where("kind", "=", "digest")
        .execute();
      expect(rows.map((row) => row.user_id).sort()).toEqual([org.userId, memberId].sort());
      const rowOf = (userId: string) => renderedOf(rows.find((row) => row.user_id === userId) as (typeof rows)[number]);
      expect(prefixes(rowOf(org.userId).buttons)).toEqual(expect.arrayContaining(["lf:", "lx:"]));
      expect(prefixes(rowOf(memberId).buttons)).toEqual(expect.arrayContaining(["ll:", "lc:"]));
      expect(prefixes(rowOf(memberId).buttons)).not.toContain("lf:");
      expect(prefixes(rowOf(memberId).buttons)).not.toContain("lx:");
      expect(rowOf(memberId).text).not.toContain("Old offer");
      expect(rowOf(org.userId).text).toContain("Old offer");
      expect((await loopRow(trx, stale)).stale_notified_at).not.toBeNull();
    });
  });

  test("/digest of a member has no 👥, /digest of an owner has it", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const now = new Date(EIGHT);
      await setOrgFeature(trx, org.ctx, { flag: "delegate_button", enabled: true, actor: "cli", now });
      await insertDelegate(trx, org.ctx, { name: "Anna" });
      await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "needs_reply",
        createdAt: new Date(now.getTime() - HOUR_MS),
        subject: "Budget question",
        from: "boss@y.test",
        fields: { language: "en" },
      });
      const deps: CommandDeps = {
        db: trx,
        now: () => now,
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
      };
      const owner = await digestNowMessage(deps, linkOf(org));
      const member = await digestNowMessage(deps, linkOf(org, { role: "assistant" }));
      expect(prefixes(owner.buttons)).toContain("dg:");
      expect(prefixes(member.buttons)).not.toContain("dg:");
    });
  });
});

describe("the mail digest row takes the role of its member", () => {
  test("a mail-only member gets no 👥 and no ⌛ line; a mail-only owner gets the 👥; no loop is marked", async () => {
    await withRollback(db, async (trx) => {
      const { org, stale, waiting } = await world(trx);
      const now = new Date(EIGHT);
      await setOrgFeature(trx, org.ctx, { flag: "delegate_button", enabled: true, actor: "cli", now });
      await setOrgFeature(trx, org.ctx, { flag: "report_mail", enabled: true, actor: "cli", now });
      await insertDelegate(trx, org.ctx, { name: "Anna" });
      await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "needs_reply",
        createdAt: new Date("2026-11-20T06:00:00Z"),
        subject: "Budget question",
        from: "boss@y.test",
        fields: { language: "en" },
      });
      // Two mail-only members (no chat): the owner of the fixture and a member; the owner's chat link is removed.
      await trx.deleteFrom("chat_links").where("org_id", "=", org.ctx.orgId).execute();
      const memberId = await addMember(trx, org.ctx.orgId);
      for (const userId of [org.userId, memberId]) {
        await trx
          .updateTable("memberships")
          .set({ created_at: new Date("2026-11-05T20:00:00Z") })
          .where("org_id", "=", org.ctx.orgId)
          .where("user_id", "=", userId)
          .execute();
        await setDigestTimes(trx, org.ctx, userId, ["08:00"]);
        await setMemberReportChannel(trx, org.ctx, userId, { channel: "mail", mailboxId: org.mailboxId });
      }
      await scheduleDigests({ db: trx, now: () => now, testMail: NO_TEST_SENDERS });
      const rows = await trx
        .selectFrom("outbox")
        .select(["user_id", "channel", "view"])
        .where("org_id", "=", org.ctx.orgId)
        .where("kind", "=", "digest")
        .execute();
      expect(rows.map((row) => [row.channel, row.user_id]).sort()).toEqual(
        [
          ["mail", org.userId],
          ["mail", memberId],
        ].sort()
      );
      const viewOf = (userId: string) =>
        rows.find((row) => row.user_id === userId)?.view as { text: string; buttons: { data?: string }[][] };
      expect(prefixes(viewOf(org.userId).buttons)).toContain("dg:");
      expect(prefixes(viewOf(memberId).buttons)).not.toContain("dg:");
      for (const userId of [org.userId, memberId]) {
        expect(prefixes(viewOf(userId).buttons)).not.toEqual(expect.arrayContaining(["lf:"]));
        expect(viewOf(userId).text).not.toContain("Old offer");
      }
      expect((await loopRow(trx, stale)).stale_notified_at).toBeNull();
      expect((await loopRow(trx, waiting)).surfaced_at).toBeNull();
    });
  });
});
