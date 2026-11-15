// F116 stage 18: the lines of the brief as they come from the database (🔴 ✍️ ⏳ 🤝), in both languages, shadow mode and the panel link.
import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";

import { briefOrg, DAY, digestTexts, EIGHT, ready, runDigests, waitingLoop } from "./channels-digest-brief-fixtures";
import { insertDelegate, insertDelegation, insertDraftAndSend, insertTriaged } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow, insertSentRow } from "./loops-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("the sections from the database", () => {
  test("🔴 an urgent mail without an own answer; an answered one (flag or own sent mail later in the thread) leaves it", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const open = await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "urgent",
        createdAt: new Date("2026-11-20T05:00:00Z"),
        subject: "URGENT-OPEN",
        from: "a@x.test",
      });
      const flagged = await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "urgent",
        createdAt: new Date("2026-11-20T05:01:00Z"),
        subject: "URGENT-FLAG",
        from: "b@x.test",
      });
      const threadKey = "<thread-own-answer@x.test>";
      await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "urgent",
        createdAt: new Date("2026-11-20T05:02:00Z"),
        subject: "URGENT-SENT",
        from: "c@x.test",
        threadKey,
        receivedAt: new Date("2026-11-20T05:02:00Z"),
      });
      await trx
        .insertInto("email_flags")
        .values({
          email_id: flagged,
          org_id: org.ctx.orgId,
          answered: true,
          flagged: false,
          seen: true,
          checked_at: new Date(EIGHT),
        })
        .execute();
      const sentId = await insertSentRow(trx, org.ctx, org.mailboxId, { threadKey, subject: "Re: URGENT-SENT" });
      await trx
        .updateTable("sent_emails")
        .set({ sent_at: new Date("2026-11-20T06:00:00Z") })
        .where("id", "=", sentId)
        .execute();
      void open;
      // A mail of the user in another thread, a mail of the user before the urgent mail arrived, and a mail that the system sent
      // in the same thread are no answer.
      const openThread = (
        await trx.selectFrom("emails").select("thread_key").where("id", "=", open).executeTakeFirstOrThrow()
      ).thread_key;
      const later = await insertSentRow(trx, org.ctx, org.mailboxId, { subject: "Other thread" });
      const earlier = await insertSentRow(trx, org.ctx, org.mailboxId, { threadKey: openThread, subject: "Before" });
      await trx
        .updateTable("sent_emails")
        .set({ sent_at: new Date("2026-11-20T06:30:00Z") })
        .where("id", "=", later)
        .execute();
      await trx
        .updateTable("sent_emails")
        .set({ sent_at: new Date("2026-11-20T04:00:00Z") })
        .where("id", "=", earlier)
        .execute();
      const system = await insertDraftAndSend(trx, org.ctx, org.mailboxId, {});
      await trx
        .insertInto("sent_emails")
        .values({
          org_id: org.ctx.orgId,
          mailbox_id: org.mailboxId,
          dedup_key: `mid:<system-${randomUUID()}@x.test>:h1`,
          path: "Sent",
          uidvalidity: "7",
          uid: "99",
          message_id: `<system-${randomUUID()}@x.test>`,
          thread_key: openThread,
          to_addresses: ["a@x.test"],
          origin: "system",
          content: "headers_only",
          action_id: system.sendId,
          sent_at: new Date("2026-11-20T06:40:00Z"),
          internal_date: new Date("2026-11-20T06:40:00Z"),
        })
        .execute();

      await runDigests(trx, EIGHT);
      const [text = ""] = await digestTexts(trx, org.ctx.orgId);
      const lines = text.split("\n").filter((line) => line.startsWith("🔴"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("URGENT-OPEN");
      // The answered ones stay in the normal list.
      expect(text).toContain("URGENT-FLAG");
      expect(text).toContain("URGENT-SENT");
    });
  });

  test("✍️ needs_reply mail of the last 14 days with no answer, oldest first; no \\Answered, no later own mail in the thread", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const at = (days: number) => new Date(Date.parse(EIGHT) - days * DAY);
      await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "needs_reply",
        createdAt: at(3),
        subject: "REPLY-3D",
        from: "x@x.test",
      });
      await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "needs_reply",
        createdAt: at(9),
        subject: "REPLY-9D",
        from: "y@x.test",
      });
      await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "needs_reply",
        createdAt: at(15),
        subject: "REPLY-15D",
        from: "z@x.test",
      });
      const answered = await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "needs_reply",
        createdAt: at(4),
        subject: "REPLY-ANSWERED",
        from: "w@x.test",
      });
      await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "info",
        createdAt: at(2),
        subject: "NOT-REPLY",
        from: "v@x.test",
      });
      await trx
        .insertInto("email_flags")
        .values({
          email_id: answered,
          org_id: org.ctx.orgId,
          answered: true,
          flagged: false,
          seen: true,
          checked_at: new Date(EIGHT),
        })
        .execute();

      await runDigests(trx, EIGHT);
      const [text = ""] = await digestTexts(trx, org.ctx.orgId);
      const lines = text.split("\n").filter((line) => line.startsWith("✍️"));
      expect(lines.map((line) => line.split(" · ")[1])).toEqual(["REPLY-9D", "REPLY-3D"]);
      expect(lines[0]).toBe("✍️ y@x.test · REPLY-9D · 9 d");
    });
  });

  test("⏳ an open delegation with a due date by the end of the day; one due next week is not named", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const delegate = await insertDelegate(trx, org.ctx, { name: "Marta" });
      for (const [status, dueAt, subject] of [
        ["sent", new Date("2026-11-19T09:00:00Z"), "DELEGATION-DUE"],
        ["overdue", new Date("2026-11-27T09:00:00Z"), "DELEGATION-LATER"],
        ["answered", new Date("2026-11-19T09:00:00Z"), "DELEGATION-ANSWERED"],
      ] as const) {
        const row = await insertDraftAndSend(trx, org.ctx, org.mailboxId, { delegateId: delegate, subject });
        await insertDelegation(trx, org.ctx, {
          mailboxId: org.mailboxId,
          emailId: row.emailId,
          delegateId: delegate,
          draftActionId: row.draftId,
          sendActionId: row.sendId,
          status,
          dueAt,
        });
      }
      await runDigests(trx, EIGHT);
      const [text = ""] = await digestTexts(trx, org.ctx.orgId);
      const lines = text.split("\n").filter((line) => line.startsWith("⏳"));
      expect(lines).toEqual(["⏳ No answer from Marta since Thu 05.11 · DELEGATION-DUE"]);
      // The first digest drops the delegation footer: the ⏳ block has it.
      expect(text).not.toContain("Delegations:");
    });
  });

  test("an organization sees only its own loops, mail and delegations", async () => {
    await withRollback(db, async (trx) => {
      const a = await ready(trx);
      const b = await briefOrg(trx);
      await waitingLoop(trx, b, {
        counterpart: "other-org@example.test",
        subject: "OTHER-ORG-SUBJECT",
        text: "OTHER-ORG-ASK",
      });
      await insertTriaged(trx, b.ctx, b.mailboxId, {
        category: "needs_reply",
        createdAt: new Date("2026-11-19T05:00:00Z"),
        subject: "OTHER-ORG-MAIL",
        from: "o@x.test",
      });
      await runDigests(trx, EIGHT);
      const [text = ""] = await digestTexts(trx, a.ctx.orgId);
      expect(text).not.toContain("OTHER-ORG");
      expect(text).not.toContain("other-org@example.test");
    });
  });
});

describe("language, shadow, links", () => {
  test("a Polish member gets Polish lines and dates", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await trx.updateTable("users").set({ locale: "pl" }).where("id", "=", org.userId).execute();
      await waitingLoop(trx, org);
      await runDigests(trx, EIGHT);
      const [text = ""] = await digestTexts(trx, org.ctx.orgId);
      expect(text).toContain("📌 DO ZAŁATWIENIA DZIŚ");
      expect(text).toContain("⏳ anna@example.test nie odpowiada od wt. 10.11 · send the offer");
    });
  });

  test("T5 a shadow mailbox: a past due delegated loop says 'would draft a follow-up'", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await trx
        .updateTable("mailbox_settings")
        .set({ mode: "shadow" })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      const delegate = await insertDelegate(trx, org.ctx, { email: "delegate@x.test" });
      await insertLoopRow(trx, org.ctx, org.mailboxId, {
        kind: "delegated",
        delegate_id: delegate,
        counterpart: "delegate@x.test",
        to_addresses: ["delegate@x.test"],
        subject: "Offer",
        due_at: new Date("2026-11-19T09:00:00Z"),
      });
      await runDigests(trx, EIGHT);
      const [text = ""] = await digestTexts(trx, org.ctx.orgId);
      expect(text).toContain(
        "⏳ No answer from delegate@x.test since Tue 10.11 · send the numbers · would draft a follow-up"
      );
    });
  });

  test("the '+n more' link points at the panel when WEB_BASE_URL is set, with no double slash", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      for (let i = 0; i < 7; i += 1) await waitingLoop(trx, org, { due_at: new Date(Date.UTC(2026, 10, 10 + i, 9)) });
      await runDigests(trx, EIGHT, "https://panel.example.test/");
      const [text = ""] = await digestTexts(trx, org.ctx.orgId);
      expect(text).toContain("+2 more in the panel: https://panel.example.test/delegations?tab=waiting");
    });
  });
});
