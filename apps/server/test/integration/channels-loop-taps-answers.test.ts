import { encodeCallback } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { handleCallback, insertOutbox } from "../../src/modules/channels";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { ready, type BriefOrg } from "./channels-digest-brief-fixtures";
import { briefLoop, deliverDigest, linkOf, MESSAGE_AT, tapDeps } from "./channels-loop-taps-fixtures";
import { createOrgWithMailbox, insertDelegate, insertDelegation, insertDraftAndSend, insertTriaged } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { actionsOfLoop, auditOf, loopOf } from "./loops-commands-fixtures";

// The roles and the answers of the loop taps. Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const loopData = (kind: "lf" | "ll" | "lc" | "lx" | "lr", id: string): string => `${kind}:${id}`;
const tap = (trx: Transaction<DB>, link: ReturnType<typeof linkOf>, data: string) =>
  handleCallback(tapDeps(trx), link, data);
const UNKNOWN = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("roles (D11)", () => {
  test("T5 a member taps Draft, Drop and Reopen: the owner-only answer, no row, no loop read; Done and Later work", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await briefLoop(trx, org);
      const member = linkOf(org, { userId: org.memberId, role: "assistant" });
      for (const kind of ["lf", "lx", "lr"] as const) {
        const result = await tap(trx, member, loopData(kind, loop.id));
        expect(result).toEqual({ answer: "Only an owner can do this." });
        // The role check comes before any query: an unknown id gives the same answer, not "not in your account".
        expect(await tap(trx, member, loopData(kind, UNKNOWN))).toEqual({ answer: "Only an owner can do this." });
      }
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
      expect((await loopOf(trx, loop.id)).status).toBe("open");
      expect((await tap(trx, member, loopData("ll", loop.id))).answer).toMatch(/^Moved to /);
      expect((await tap(trx, member, loopData("lc", loop.id))).answer).toBe("Done.");
      expect((await auditOf(trx, org.ctx.orgId, "loop.closed")).map((row) => row.actor)).toEqual([org.memberId]);
    });
  });

  test("the org and the user come from the link: a link of another organization cannot reach the loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await briefLoop(trx, org);
      const other = await createOrgWithMailbox(trx);
      const foreign = linkOf(org, { orgId: other.orgId, userId: other.userId });
      expect((await tap(trx, foreign, loopData("lc", loop.id))).answer).toBe("This item is not in your account.");
      expect((await loopOf(trx, loop.id)).status).toBe("open");
    });
  });
});

describe("Later", () => {
  test("T6 three taps move the loop; the fourth answers limit_reached", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await briefLoop(trx, org);
      const answers: string[] = [];
      for (let i = 0; i < 3; i += 1) answers.push((await tap(trx, linkOf(org), loopData("ll", loop.id))).answer);
      expect(answers.every((answer) => /^Moved to /.test(answer))).toBe(true);
      expect((await loopOf(trx, loop.id)).later_count).toBe(3);
      expect((await tap(trx, linkOf(org), loopData("ll", loop.id))).answer).toBe(
        "This loop was moved 3 times already."
      );
      expect((await loopOf(trx, loop.id)).later_count).toBe(3);
    });
  });

  test("a promise has no Later", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await briefLoop(trx, org, { kind: "promised" });
      expect((await tap(trx, linkOf(org), loopData("ll", loop.id))).answer).toBe("A promise cannot be moved.");
    });
  });
});

describe("the answers of Draft follow-up", () => {
  const cases: [string, Parameters<typeof briefLoop>[2], string][] = [
    ["closed", { status: "closed", close_reason: "dropped", closed_at: MESSAGE_AT }, "This loop is closed."],
    [
      "limit_reached",
      { follow_ups_sent: 2, last_follow_up_at: new Date("2026-11-01T09:00:00Z") },
      "Two follow-ups were drafted already: no more.",
    ],
    ["too_soon", { follow_ups_sent: 1, last_follow_up_at: MESSAGE_AT }, "It is too early for a follow-up."],
  ];
  test.each(cases)("T8 %s", async (_name, over, text) => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await briefLoop(trx, org, over);
      expect((await tap(trx, linkOf(org), loopData("lf", loop.id))).answer).toBe(text);
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
    });
  });

  test("shadow, drafts off, suspicious thread, flag off and unknown id", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await briefLoop(trx, org);
      await trx
        .updateTable("mailbox_settings")
        .set({ mode: "shadow" })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      expect((await tap(trx, linkOf(org), loopData("lf", loop.id))).answer).toBe("Shadow mode: no draft.");
      await trx
        .updateTable("mailbox_settings")
        .set({ mode: "assist", tool_switches: JSON.stringify({ create_draft: false }) })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      expect((await tap(trx, linkOf(org), loopData("lf", loop.id))).answer).toBe("Drafts are off for this mailbox.");
      await trx.deleteFrom("mailbox_settings").where("mailbox_id", "=", org.mailboxId).execute();
      const flagged = await briefLoop(trx, org);
      await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "info",
        createdAt: MESSAGE_AT,
        threadKey: flagged.threadKey,
        suspiciousReasons: ["lookalike_domain"],
      });
      // No settings row: the drafts are off before the suspicion is read? The suspicion rule runs first.
      expect((await tap(trx, linkOf(org), loopData("lf", flagged.id))).answer).toBe(
        "This thread looks suspicious: no follow-up."
      );
      expect((await tap(trx, linkOf(org), loopData("lf", UNKNOWN))).answer).toBe("This item is not in your account.");
      await setOrgFeature(trx, org.ctx, { flag: "open_loops", enabled: false, actor: "cli", now: MESSAGE_AT });
      expect((await tap(trx, linkOf(org), loopData("lf", loop.id))).answer).toBe("Open loops are off.");
      expect((await tap(trx, linkOf(org), loopData("ll", loop.id))).answer).toBe("Open loops are off.");
      expect((await tap(trx, linkOf(org), loopData("lc", loop.id))).answer).toBe("This item is not in your account.");
    });
  });

  test("a Polish user gets Polish answers", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const loop = await briefLoop(trx, org);
      const pl = linkOf(org, { locale: "pl" });
      expect((await tap(trx, pl, loopData("lf", loop.id))).answer).toBe("Przypomnienie gotowe. Sprawdź kartę.");
      expect((await tap(trx, pl, loopData("lc", loop.id))).answer).toBe("Gotowe.");
      expect((await tap(trx, pl, loopData("lc", loop.id))).answer).toBe("Ta sprawa jest już zamknięta.");
      // Shadow mode is "Tryb podglądu" in every Polish text.
      const shadow = await briefLoop(trx, org);
      await trx
        .updateTable("mailbox_settings")
        .set({ mode: "shadow" })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      expect((await tap(trx, pl, loopData("lf", shadow.id))).answer).toBe("Tryb podglądu: bez szkicu.");
    });
  });
});

describe("Reopen", () => {
  test("a loop that Sent tracking closed cannot be reopened: its own text; an open loop answers 'open already'", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const closed = await briefLoop(trx, org, { status: "closed", close_reason: "sent_off", closed_at: MESSAGE_AT });
      expect((await tap(trx, linkOf(org), loopData("lr", closed.id))).answer).toBe("This loop cannot be reopened.");
      const open = await briefLoop(trx, org);
      expect((await tap(trx, linkOf(org), loopData("lr", open.id))).answer).toBe("This loop is open already.");
    });
  });
});

const MAIL_AT = new Date("2026-11-19T12:00:00Z");

async function delegationOf(
  trx: Transaction<DB>,
  org: BriefOrg,
  status: "sent" | "overdue",
  dueAt: Date
): Promise<{ id: string; emailId: string }> {
  const delegate = await insertDelegate(trx, org.ctx, { name: "Marta" });
  const row = await insertDraftAndSend(trx, org.ctx, org.mailboxId, {
    delegateId: delegate,
    subject: "DELEGATION-SUBJECT",
    // The digest of the test is at 2026-11-20T07:00Z and lists the mail triaged before it: a mail made with the
    // real clock falls outside the period of the digest after that hour of the day.
    createdAt: MAIL_AT,
  });
  const id = await insertDelegation(trx, org.ctx, {
    mailboxId: org.mailboxId,
    emailId: row.emailId,
    delegateId: delegate,
    draftActionId: row.draftId,
    sendActionId: row.sendId,
    status,
    dueAt,
    sentAt: new Date("2026-11-10T09:00:00Z"),
  });
  return { id, emailId: row.emailId };
}

describe("a delegation line", () => {
  test("Done on an overdue delegation edits that line of the digest, never with the text of another message", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const { id, emailId } = await delegationOf(trx, org, "overdue", new Date("2026-11-19T09:00:00Z"));
      const { messageId, message } = await deliverDigest(trx);
      const data = encodeCallback({ kind: "delegation_done", delegationId: id });
      // The "delegation answered" notice of the same delegation exists too: its stored text must never replace the digest.
      await insertOutbox(trx, org.ctx, {
        userId: org.userId,
        kind: "delegation_answered",
        dedupKey: `delegation_answered:${id}`,
        emailId,
        view: {},
        locale: "en",
        createdAt: MESSAGE_AT,
        nextAttemptAt: MESSAGE_AT,
      });
      await trx
        .updateTable("outbox")
        .set({ text: "NOTICE-TEXT", status: "sent", sent_at: MESSAGE_AT, external_message_id: "5000" })
        .where("dedup_key", "=", `delegation_answered:${id}`)
        .execute();
      // The mail of the delegation shows as a row of the normal list too: its ✏️ button stays.
      expect(message.buttons.flat().map((button) => button.data)).toContain(data);
      const result = await handleCallback(tapDeps(trx), linkOf(org), data, { messageId });
      expect(result.answer).toBe("✅ Done.");
      expect(result.edit?.text).toContain("✓ ⏳ No answer from Marta");
      expect(result.edit?.buttons.flat().map((button) => button.data)).not.toContain(data);
      expect(result.edit?.buttons.flat().some((button) => button.text === "✏️ 1")).toBe(true);
      expect(result.edit?.text).not.toContain("NOTICE-TEXT");
      expect(result.edit?.text.split("\n")[0]).toBe(message.text.split("\n")[0]);
    });
  });

  test("a sent delegation (not overdue) has no Done button: the tap would answer 'not answered yet'", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await delegationOf(trx, org, "sent", new Date("2026-11-20T15:00:00Z"));
      const { message } = await deliverDigest(trx);
      expect(message.text).toContain("⏳");
      expect(message.buttons.flat().some((button) => button.data.startsWith("dd:"))).toBe(false);
    });
  });
});
