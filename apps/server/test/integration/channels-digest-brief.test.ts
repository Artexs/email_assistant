// F116 stage 18: the brief in the first digest of the member's local day, the count line in later ones (T6–T10). Rows are inside
// one transaction that rolls back. Other files: -sections (the lines from the database), -consent, -guards, -copies, -race.

import { afterAll, describe, expect, test } from "bun:test";

import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { buildDigestMessage } from "../../src/modules/reports";
import { setDigestTimes, setOrgFeature } from "../../src/modules/tenancy";

import { digestTexts, EIGHT, loopRow, ready, runDigests, SIXTEEN, waitingLoop } from "./channels-digest-brief-fixtures";
import {
  insertAttachmentHeaders,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTriaged,
  linkChat,
  randomChatId,
  renderedOf,
} from "./fixtures";
import { consentRow } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow } from "./loops-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("the first digest of the day (T6, T7)", () => {
  test("T6 slots 08:00 and 16:00: the brief at 08:00, the count line at 16:00", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await waitingLoop(trx, org);
      await insertLoopRow(trx, org.ctx, org.mailboxId, {
        kind: "promised",
        counterpart: "anna@example.test",
        text: "send the numbers",
        due_at: new Date("2026-11-20T10:00:00Z"),
      });

      await runDigests(trx, EIGHT);
      await runDigests(trx, SIXTEEN);

      const [first = "", second = ""] = await digestTexts(trx, org.ctx.orgId);
      expect(first).toContain("📌 NEEDS YOU TODAY");
      expect(first).toContain("⏳ No answer from anna@example.test since Tue 10.11 · send the offer");
      expect(first).toContain("🤝 You promised anna@example.test: send the numbers · due Fri 20.11");
      expect(first).not.toContain("Open loops:");
      expect(second).not.toContain("NEEDS YOU TODAY");
      expect(second).not.toContain("anna@example.test");
      expect(second.split("\n").at(-1)).toBe("🔁 Open loops: 1 waiting, 1 promise due");
    });
  });

  test("T7 the 08:00 digest never reached the chat: the 16:00 digest has the brief", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await waitingLoop(trx, org);
      await runDigests(trx, EIGHT);
      await trx
        .updateTable("outbox")
        .set({ status: "failed", error_code: "blocked" })
        .where("org_id", "=", org.ctx.orgId)
        .execute();
      await runDigests(trx, SIXTEEN);
      const texts = await digestTexts(trx, org.ctx.orgId);
      expect(texts).toHaveLength(2);
      expect(texts[1]).toContain("📌 NEEDS YOU TODAY");
    });
  });

  test("T7 the 08:00 job never ran: the first digest of the day has the brief, whatever its slot", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await waitingLoop(trx, org);
      await runDigests(trx, SIXTEEN);
      const texts = await digestTexts(trx, org.ctx.orgId);
      expect(texts).toHaveLength(1);
      expect(texts[0]).toContain("📌 NEEDS YOU TODAY");
    });
  });

  test("a digest of the day before does not count: the next day starts with a brief again", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await waitingLoop(trx, org, { due_at: new Date("2026-11-19T09:00:00Z") });
      await runDigests(trx, "2026-11-19T07:00:00Z");
      await runDigests(trx, EIGHT);
      const texts = await digestTexts(trx, org.ctx.orgId);
      expect(texts).toHaveLength(2);
      expect(texts.every((text) => text.includes("📌 NEEDS YOU TODAY"))).toBe(true);
    });
  });

  test("a notice of another kind, an earlier digest of the day before and a digest of the same day that comes later do not count", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await waitingLoop(trx, org);
      // An urgent notice and a sync notice of the same day, queued before the digest.
      for (const [kind, dedup] of [
        ["sync_stale", "notice:1"],
        ["auth_error", "notice:2"],
      ] as const) {
        await trx
          .insertInto("outbox")
          .values({
            org_id: org.ctx.orgId,
            user_id: org.userId,
            kind,
            dedup_key: dedup,
            mailbox_id: org.mailboxId,
            view: JSON.stringify({ text: "x" }),
            buttons: "[]",
            status: "sent",
            sent_at: new Date("2026-11-20T05:00:00Z"),
            created_at: new Date("2026-11-20T05:00:00Z"),
            next_attempt_at: new Date("2026-11-20T05:00:00Z"),
          })
          .execute();
      }
      await runDigests(trx, EIGHT);
      const [text = ""] = await digestTexts(trx, org.ctx.orgId);
      expect(text).toContain("📌 NEEDS YOU TODAY");
    });
  });

  test("a digest of another member of the organization does not count", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await waitingLoop(trx, org);
      await runDigests(trx, EIGHT);
      // The same day, another user (the assistant) gets his own first digest.
      await linkChat(trx, org.ctx, org.memberId, randomChatId(), new Date("2026-11-05T20:00:00Z"));
      await setDigestTimes(trx, org.ctx, org.memberId, ["08:00"]);
      await consentRow(trx, org.ctx.orgId, org.memberId, "2026-11-15.2", new Date("2026-11-06T00:00:00Z"));
      await runDigests(trx, "2026-11-20T07:01:00Z");
      const rows = await trx
        .selectFrom("outbox")
        .select(["user_id", "kind", "view", "channel", "detail", "locale", "text", "buttons"])
        .where("org_id", "=", org.ctx.orgId)
        .execute();
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => renderedOf(row).text.includes("📌 NEEDS YOU TODAY"))).toBe(true);
    });
  });
});

describe("surfaced_at and stale_notified_at (T8)", () => {
  test("T8 surfaced_at is set once; a second digest leaves it; a ⌛ line is named once", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const shown = await waitingLoop(trx, org);
      const promised = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        kind: "promised",
        text: "send the numbers",
        due_at: new Date("2026-11-20T10:00:00Z"),
      });
      // Not due by the end of the day: no line, no mark.
      const later = await waitingLoop(trx, org, { due_at: new Date("2026-11-21T10:00:00Z") });
      const stale = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        status: "closed",
        close_reason: "stale",
        closed_at: new Date("2026-11-19T10:00:00Z"),
        subject: "Old offer",
        due_at: new Date("2026-10-01T10:00:00Z"),
      });

      await runDigests(trx, EIGHT);
      const first = await loopRow(trx, shown);
      expect(first.surfaced_at?.toISOString()).toBe(EIGHT.replace("Z", ".000Z"));
      expect((await loopRow(trx, promised)).surfaced_at?.toISOString()).toBe(EIGHT.replace("Z", ".000Z"));
      expect((await loopRow(trx, later)).surfaced_at).toBeNull();
      const named = await loopRow(trx, stale);
      expect(named.stale_notified_at?.toISOString()).toBe(EIGHT.replace("Z", ".000Z"));

      // The next day's first digest: the loop stays surfaced at its first time; the ⌛ line is not named again.
      await runDigests(trx, "2026-11-23T07:00:00Z");
      expect((await loopRow(trx, shown)).surfaced_at?.toISOString()).toBe(EIGHT.replace("Z", ".000Z"));
      expect((await loopRow(trx, stale)).stale_notified_at?.toISOString()).toBe(EIGHT.replace("Z", ".000Z"));
      const texts = await digestTexts(trx, org.ctx.orgId);
      expect(texts[0]).toContain("⌛ Closed without an answer: Old offer");
      expect(texts[1]).not.toContain("⌛");
    });
  });

  test("a count line of a later digest marks nothing", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await runDigests(trx, EIGHT);
      const loop = await waitingLoop(trx, org);
      await runDigests(trx, SIXTEEN);
      expect((await loopRow(trx, loop)).surfaced_at).toBeNull();
    });
  });

  test("the digest that does not name a loop (4096 cut) does not mark it: the marks follow the text", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      const ids: string[] = [];
      for (let i = 0; i < 7; i += 1)
        ids.push(await waitingLoop(trx, org, { due_at: new Date(Date.UTC(2026, 10, 10 + i, 9)) }));
      await runDigests(trx, EIGHT);
      const marked = await trx.selectFrom("open_loops").select(["id", "surfaced_at"]).where("id", "in", ids).execute();
      // A section names at most 5 lines: the 5 oldest are marked, the other two wait for the next first digest.
      expect(marked.filter((row) => row.surfaced_at !== null)).toHaveLength(5);
      const texts = await digestTexts(trx, org.ctx.orgId);
      expect(texts[0]).toContain("+2 more in the panel");
    });
  });
});

describe("the flag off (T9) and the attachment line (T10)", () => {
  test("T9 flag off: today's digest, byte for byte, with the delegation footer and no loop line", async () => {
    await withRollback(db, async (trx) => {
      const off = await ready(trx, { loopsFlag: false });
      await waitingLoop(trx, off);
      const delegate = await insertDelegate(trx, off.ctx);
      const row = await insertDraftAndSend(trx, off.ctx, off.mailboxId, { delegateId: delegate });
      await insertDelegation(trx, off.ctx, {
        mailboxId: off.mailboxId,
        emailId: row.emailId,
        delegateId: delegate,
        draftActionId: row.draftId,
        sendActionId: row.sendId,
        status: "sent",
        dueAt: new Date("2026-11-19T09:00:00Z"),
      });
      await insertTriaged(trx, off.ctx, off.mailboxId, {
        category: "info",
        createdAt: new Date("2026-11-20T05:00:00Z"),
        subject: "SUBJECT-INFO",
        from: "news@x.test",
      });

      await runDigests(trx, EIGHT);
      await runDigests(trx, SIXTEEN);

      const texts = await digestTexts(trx, off.ctx.orgId);
      for (const text of texts) {
        expect(text).not.toContain("NEEDS YOU TODAY");
        expect(text).not.toContain("Open loops");
        expect(text).not.toContain("anna@example.test");
        expect(text).toContain("👥 Delegations: 1 waiting for a reply, 0 overdue");
      }
      // The same digest as the one on demand builds (that path has no loop part).
      const direct = await buildDigestMessage(trx, off.ctx, {
        kind: "scheduled",
        periodStart: (
          await trx
            .selectFrom("digests")
            .select("period_start")
            .where("org_id", "=", off.ctx.orgId)
            .orderBy("slot_key")
            .executeTakeFirstOrThrow()
        ).period_start,
        periodEnd: new Date(EIGHT),
        slot: { date: "2026-11-20", time: "08:00", late: false },
        now: new Date(EIGHT),
        locale: "en",
        role: "owner",
        testMail: NO_TEST_SENDERS,
      });
      expect(texts[0]).toBe(direct.text);
      // No `loopIds` in the stored view.
      const views = await trx.selectFrom("outbox").select("view").where("org_id", "=", off.ctx.orgId).execute();
      expect(views.every((row) => !("loopIds" in (row.view as object)))).toBe(true);
    });
  });

  test("T9 flag off, attachment line on: the 📎 line stays under its row", async () => {
    await withRollback(db, async (trx) => {
      const off = await ready(trx, { loopsFlag: false });
      await setOrgFeature(trx, off.ctx, { flag: "attachment_line", enabled: true, actor: "cli", now: new Date(EIGHT) });
      const info = await insertTriaged(trx, off.ctx, off.mailboxId, {
        category: "info",
        createdAt: new Date("2026-11-20T05:00:00Z"),
        subject: "SUBJECT-FILE",
        from: "shop@x.test",
      });
      await insertAttachmentHeaders(trx, off.ctx, info, [
        { name: "faktura.pdf", type: "application/pdf", size: 122_880, inline: false },
      ]);
      await runDigests(trx, EIGHT);
      const [text] = await digestTexts(trx, off.ctx.orgId);
      expect(text).toContain("SUBJECT-FILE\n📎 1: faktura.pdf (120 kB)");
    });
  });

  test("T10 both flags on, an urgent and an info mail with a PDF each: no 📎 under 🔴, the 📎 line under the info subject", async () => {
    await withRollback(db, async (trx) => {
      const org = await ready(trx);
      await setOrgFeature(trx, org.ctx, { flag: "attachment_line", enabled: true, actor: "cli", now: new Date(EIGHT) });
      const pdf = [{ name: "faktura.pdf", type: "application/pdf", size: 122_880, inline: false }];
      const urgent = await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "urgent",
        createdAt: new Date("2026-11-20T05:00:00Z"),
        subject: "SUBJECT-URGENT",
        from: "boss@x.test",
      });
      const info = await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "info",
        createdAt: new Date("2026-11-20T05:01:00Z"),
        subject: "SUBJECT-INFO",
        from: "shop@x.test",
      });
      await insertAttachmentHeaders(trx, org.ctx, urgent, pdf);
      await insertAttachmentHeaders(trx, org.ctx, info, pdf);

      await runDigests(trx, EIGHT);
      const [text = ""] = await digestTexts(trx, org.ctx.orgId);
      const lines = text.split("\n");
      const urgentLine = lines.findIndex((line) => line.startsWith("🔴 boss@x.test"));
      expect(urgentLine).toBeGreaterThan(-1);
      expect(lines[urgentLine]).toContain("SUBJECT-URGENT");
      expect(lines[urgentLine + 1]).not.toContain("📎");
      expect(text).toContain("SUBJECT-INFO\n📎 1: faktura.pdf (120 kB)");
      expect(text.match(/📎/g)).toHaveLength(1);
      // The urgent mail is not in the normal list twice.
      expect(text.match(/SUBJECT-URGENT/g)).toHaveLength(1);
    });
  });
});
