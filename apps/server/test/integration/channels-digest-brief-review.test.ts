// The tests that the review found missing, and the delegation footer rule.
//   G2 r05: an erase deletes a `sending` digest that names the erased loop;
//   G2 r11: `view.loopIds` holds the ids of ⌛ lines, so a digest with only a ⌛ line is found by the Sent switch and by the erase;
//   G2 r08: the count line of a later digest counts delegations;
//   The delegation footer stays in the first digest when no ⏳ line names a delegation, and for a member without consent.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { sentSwitchHooks } from "../../src/composition";
import { setSentSync } from "../../src/modules/mail";
import { eraseSubjectData } from "../../src/modules/privacy";
import type { DB } from "../../src/platform/db";

import {
  briefOrg,
  digestTexts,
  EIGHT,
  ready,
  runDigests,
  SIXTEEN,
  waitingLoop,
  type BriefOrg,
} from "./channels-digest-brief-fixtures";
import { insertDelegate, insertDelegation, insertDraftAndSend, isolateChannels } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { FRIDAY } from "./loops-commands-fixtures";
import { insertLoopRow } from "./loops-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const FOOTER = "👥 Delegations: 1 waiting for a reply, 0 overdue";

async function delegation(trx: Transaction<DB>, org: BriefOrg, dueAt: Date | null): Promise<void> {
  const delegate = await insertDelegate(trx, org.ctx, { name: "Marta" });
  const row = await insertDraftAndSend(trx, org.ctx, org.mailboxId, {
    delegateId: delegate,
    subject: "DELEGATION-SUBJECT",
  });
  await insertDelegation(trx, org.ctx, {
    mailboxId: org.mailboxId,
    emailId: row.emailId,
    delegateId: delegate,
    draftActionId: row.draftId,
    sendActionId: row.sendId,
    status: "sent",
    dueAt,
  });
}

const staleLoop = (trx: Transaction<DB>, org: BriefOrg, subject: string) =>
  insertLoopRow(trx, org.ctx, org.mailboxId, {
    status: "closed",
    close_reason: "stale",
    closed_at: new Date("2026-11-19T10:00:00Z"),
    subject,
    counterpart: null,
    to_addresses: [],
    text: null,
    due_at: new Date("2026-10-01T10:00:00Z"),
  });

describe("N3: the delegation footer", () => {
  test("a delegation due later is in no ⏳ line: the first digest keeps the footer", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await waitingLoop(trx, org);
      await delegation(trx, org, new Date("2026-11-27T09:00:00Z"));
      await runDigests(trx, EIGHT);
      const [text = ""] = await digestTexts(trx, org.ctx.orgId);
      expect(text).toContain("📌 NEEDS YOU TODAY");
      expect(text).toContain(FOOTER);
      expect(text).not.toContain("No answer from Marta");
    });
  });

  test("a delegation with no due date is in no ⏳ line either: the footer stays", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await delegation(trx, org, null);
      await runDigests(trx, EIGHT);
      expect((await digestTexts(trx, org.ctx.orgId))[0]).toContain(FOOTER);
    });
  });

  test("a delegation due today is a ⏳ line: the footer goes", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await delegation(trx, org, new Date("2026-11-19T09:00:00Z"));
      await runDigests(trx, EIGHT);
      const [text = ""] = await digestTexts(trx, org.ctx.orgId);
      expect(text).toContain("⏳ No answer from Marta");
      expect(text).not.toContain("Delegations:");
    });
  });

  test("a member without consent keeps the footer, and its ⏳ count is of loops only; the delegation is named nowhere", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx, { consent: false });
      await waitingLoop(trx, org);
      await delegation(trx, org, new Date("2026-11-19T09:00:00Z"));
      await runDigests(trx, EIGHT);
      const [text = ""] = await digestTexts(trx, org.ctx.orgId);
      expect(text).toContain("⏳ Waiting on others: 1");
      expect(text).toContain(FOOTER);
      expect(text).not.toContain("No answer from Marta");
    });
  });
});

describe("G2 r08: the count line of a later digest", () => {
  test("counts a delegation due today with no loop at all", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await delegation(trx, org, new Date("2026-11-19T09:00:00Z"));
      await runDigests(trx, EIGHT);
      await runDigests(trx, SIXTEEN);
      const texts = await digestTexts(trx, org.ctx.orgId);
      expect(texts[1]?.split("\n").at(-1)).toBe("🔁 Open loops: 1 waiting");
    });
  });
});

describe("G2 r11: a digest with only a ⌛ line", () => {
  test("view.loopIds holds the id of the ⌛ loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const stale = await staleLoop(trx, org, "ONLY-STALE-SUBJECT");
      await runDigests(trx, EIGHT);
      const row = await trx
        .selectFrom("outbox")
        .select(["view"])
        .where("org_id", "=", org.ctx.orgId)
        .where("kind", "=", "digest")
        .executeTakeFirstOrThrow();
      const view = row.view as { text: string; loopIds?: string[] };
      expect(view.text).toContain("⌛ Closed without an answer: ONLY-STALE-SUBJECT");
      expect(view.loopIds).toEqual([stale]);
    });
  });

  test("the Sent switch off clears it", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await staleLoop(trx, org, "ONLY-STALE-SUBJECT");
      await runDigests(trx, EIGHT);
      await setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: "test", at: FRIDAY }, sentSwitchHooks);
      const row = await trx
        .selectFrom("outbox")
        .select(["status", "text", "view"])
        .where("org_id", "=", org.ctx.orgId)
        .where("kind", "=", "digest")
        .executeTakeFirstOrThrow();
      expect([row.status, row.text, JSON.stringify(row.view)]).toEqual(["failed", "[removed]", "{}"]);
    });
  });
});

describe("the erase (committed rows)", () => {
  const orgs: string[] = [];
  const users: string[] = [];
  afterEach(async () => {
    if (orgs.length > 0) await db.deleteFrom("organizations").where("id", "in", orgs).execute();
    if (users.length > 0) await db.deleteFrom("users").where("id", "in", users).execute();
    orgs.length = 0;
    users.length = 0;
  });

  async function world(): Promise<BriefOrg> {
    return db.transaction().execute(async (trx) => {
      await isolateChannels(trx);
      const org = await briefOrg(trx);
      orgs.push(org.ctx.orgId);
      users.push(org.userId, org.memberId);
      return org;
    });
  }
  const erase = (org: BriefOrg, address: string) =>
    eraseSubjectData(db, {
      orgId: org.ctx.orgId,
      address,
      confirm: address,
      credentialsKey: Buffer.alloc(32, 7).toString("base64"),
      now: FRIDAY,
    });

  test("G2 r11: a digest with only a ⌛ line is blanked when the erase clears that loop", async () => {
    const org = await world();
    const person = "stale-person@brief.example.test";
    await db.transaction().execute((trx) =>
      insertLoopRow(trx, org.ctx, org.mailboxId, {
        status: "closed",
        close_reason: "stale",
        closed_at: new Date("2026-11-19T10:00:00Z"),
        subject: "STALE-SECRET-SUBJECT",
        counterpart: person,
        to_addresses: [person],
        due_at: new Date("2026-10-01T10:00:00Z"),
      })
    );
    await runDigests(db, EIGHT);
    await db
      .updateTable("outbox")
      .set({ status: "sent", sent_at: FRIDAY })
      .where("org_id", "=", org.ctx.orgId)
      .execute();
    const before = await db.selectFrom("outbox").select(["text", "view"]).where("org_id", "=", org.ctx.orgId).execute();
    expect(JSON.stringify(before)).toContain("STALE-SECRET-SUBJECT");

    expect((await erase(org, person)).kind).toBe("erased");

    const after = await db.selectFrom("outbox").select(["text", "view"]).where("org_id", "=", org.ctx.orgId).execute();
    expect(after).toHaveLength(1);
    expect(JSON.stringify(after)).not.toContain("STALE-SECRET-SUBJECT");
    expect([after[0]?.text, JSON.stringify(after[0]?.view)]).toEqual(["[removed]", "{}"]);
  });

  test("G2 r05: a `sending` digest that names the erased loop is deleted, not left with the text", async () => {
    const org = await world();
    const person = "sending-person@brief.example.test";
    await db.transaction().execute((trx) =>
      waitingLoop(trx, org, {
        counterpart: person,
        to_addresses: [person],
        subject: "SENDING-SECRET-SUBJECT",
        text: "SENDING-SECRET-ASK",
      })
    );
    await runDigests(db, EIGHT);
    // The sender has claimed the row and not yet marked it sent.
    await db
      .updateTable("outbox")
      .set({ status: "sending", locked_at: new Date(EIGHT) })
      .where("org_id", "=", org.ctx.orgId)
      .execute();

    expect((await erase(org, person)).kind).toBe("erased");

    const after = await db
      .selectFrom("outbox")
      .select(["status", "text", "view"])
      .where("org_id", "=", org.ctx.orgId)
      .execute();
    expect(JSON.stringify(after)).not.toContain("SENDING-SECRET");
    expect(after.filter((row) => row.status === "sending")).toEqual([]);
  });
});
