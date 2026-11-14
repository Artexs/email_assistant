import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import { createUpdateHandlers, reviewMessage, type CommandDeps, type LinkedChat } from "../../src/modules/channels";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTriaged, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// The /review command (F097 stage 04): the flag, the page, the suspended wrapper, the taps and the tenant filter.
const T = new Date("2026-11-20T12:00:00Z");
const HOUR = 3_600_000;
const TEST_SENDER = "agent@test-sender.test";
const OFF_TEXT = "This command is not on for your account.";
const EMPTY_TEXT = "Nothing to review: every recent mail has a label.";

function depsAt(trx: Transaction<DB>): CommandDeps {
  return {
    db: trx,
    now: () => T,
    llmDailyCap: 300,
    triageScope: "all",
    actionsScope: { kind: "all" },
    llm: { provider: "gemini", classifierModel: "gemini-3.5-flash-lite" },
    hooks: noDelegationHooks,
    uidplus: async () => true,
    sendScope: { kind: "all" },
    testMail: { senders: [TEST_SENDER] },
    operatorContact: null,
    syncEveryMin: 2,
  };
}

async function setup(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const link: LinkedChat = {
    orgId: a.orgId,
    userId: a.userId,
    role: "owner",
    chatId: 7,
    linkedAt: new Date(T.getTime() - 30 * 24 * HOUR),
    locale: "en",
  };
  return { a, ctx: { orgId: a.orgId }, link };
}

async function flagOn(trx: Transaction<DB>, orgId: string): Promise<void> {
  await setOrgFeature(trx, { orgId }, { flag: "review_command", enabled: true, actor: "cli", now: T });
}

const triaged = (trx: Transaction<DB>, orgId: string, mailboxId: string, subject: string, from = "ann@firma.test") =>
  insertTriaged(trx, { orgId }, mailboxId, {
    category: "info",
    createdAt: new Date(T.getTime() - HOUR),
    subject,
    from,
  });

const feedback = (trx: Transaction<DB>, orgId: string) =>
  trx.selectFrom("triage_feedback").selectAll().where("org_id", "=", orgId).execute();

describe("/review", () => {
  test("1. flag off: the off text, no buttons, no feedback row", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link } = await setup(trx);
      await triaged(trx, a.orgId, a.mailboxId, "MARKER-ONE");
      expect(await reviewMessage(depsAt(trx), link)).toEqual({ text: OFF_TEXT, buttons: [] });
      expect(await feedback(trx, ctx.orgId)).toEqual([]);
    });
  });

  test("2. flag on: 3 unlabelled real mails; a labelled mail and a test-sender mail are not on the page", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await flagOn(trx, a.orgId);
      for (const subject of ["MARKER-A", "MARKER-B", "MARKER-C"]) await triaged(trx, a.orgId, a.mailboxId, subject);
      const labelled = await triaged(trx, a.orgId, a.mailboxId, "MARKER-LABELLED");
      await triaged(trx, a.orgId, a.mailboxId, "MARKER-TEST", TEST_SENDER);
      await trx
        .insertInto("triage_feedback")
        .values({
          org_id: a.orgId,
          user_id: a.userId,
          email_id: labelled,
          verdict: "right",
          true_category: "info",
          source: "telegram",
        })
        .execute();

      const message = await reviewMessage(depsAt(trx), link);

      expect(message.text).toStartWith("Review: 3 mails without a label");
      for (const subject of ["MARKER-A", "MARKER-B", "MARKER-C"]) expect(message.text).toContain(subject);
      expect(message.text).not.toContain("MARKER-LABELLED");
      expect(message.text).not.toContain("MARKER-TEST");
      expect(message.buttons).toHaveLength(3);
      expect(message.buttons.flat().every((button) => /^v[re]:/.test(button.data))).toBe(true);
    });
  });

  test("3. flag on, every mail labelled: the empty text", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await flagOn(trx, a.orgId);
      const labelled = await triaged(trx, a.orgId, a.mailboxId, "MARKER-LABELLED");
      await trx
        .insertInto("triage_feedback")
        .values({
          org_id: a.orgId,
          user_id: a.userId,
          email_id: labelled,
          verdict: "right",
          true_category: "info",
          source: "telegram",
        })
        .execute();
      expect(await reviewMessage(depsAt(trx), link)).toEqual({ text: EMPTY_TEXT, buttons: [] });
    });
  });

  test("4. a suspended organization gets the paused text", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await flagOn(trx, a.orgId);
      await suspendOrg(trx, a.orgId);
      const handlers = createUpdateHandlers({ ...depsAt(trx), operatorContact: "ops@example.test" });
      const answer = await handlers.command(link, "review");
      expect(answer.text).toStartWith("⏸ This account is paused.");
      expect(answer.buttons).toEqual([]);
    });
  });

  test("5. a tap on the page records source review once; the same tap again adds no row", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await flagOn(trx, a.orgId);
      const emailId = await triaged(trx, a.orgId, a.mailboxId, "MARKER-TAP");
      const page = await reviewMessage(depsAt(trx), link);
      const data = page.buttons[0]?.[0]?.data;
      expect(data).toBe(`vr:i:${emailId}`);

      const handlers = createUpdateHandlers(depsAt(trx));
      await handlers.callback(link, data ?? "");
      expect(await feedback(trx, a.orgId)).toMatchObject([
        { email_id: emailId, verdict: "right", true_category: "info", source: "review", user_id: a.userId },
      ]);
      await handlers.callback(link, data ?? "");
      expect(await feedback(trx, a.orgId)).toHaveLength(1);
    });
  });

  test("6. a chat of organization B with the flag on sees none of the mail of organization A", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await setup(trx);
      const b = await setup(trx);
      await flagOn(trx, a.orgId);
      await flagOn(trx, b.a.orgId);
      await triaged(trx, a.orgId, a.mailboxId, "MARKER-ORG-A");

      expect(await reviewMessage(depsAt(trx), b.link)).toEqual({ text: EMPTY_TEXT, buttons: [] });
    });
  });

  test("a mail older than 30 days is not on the page", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await flagOn(trx, a.orgId);
      await insertTriaged(trx, { orgId: a.orgId }, a.mailboxId, {
        category: "info",
        createdAt: new Date(T.getTime() - 31 * 24 * HOUR),
        subject: `MARKER-OLD-${randomUUID()}`,
      });
      expect(await reviewMessage(depsAt(trx), link)).toEqual({ text: EMPTY_TEXT, buttons: [] });
    });
  });
});
