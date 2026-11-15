// F116 stage 18: the brief in the first digest of the member's local day, the count line in later ones (T6–T10 and the rules
// around them). Rows are inside one transaction that rolls back; the races are in channels-digest-brief-race.test.ts.
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { buildDigestMessage } from "../../src/modules/reports";
import { setDigestTimes, setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import {
  briefOrg,
  DAY,
  EIGHT,
  runDigests,
  SIXTEEN,
  waitingLoop,
  type BriefOrg,
} from "./channels-digest-brief-fixtures";
import {
  insertAttachmentHeaders,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTriaged,
  isolateChannels,
  linkChat,
  randomChatId,
  renderedOf,
} from "./fixtures";
import { consentRow, unlinkRow } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow, insertSentRow } from "./loops-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

async function digestTexts(trx: Transaction<DB>, orgId: string): Promise<string[]> {
  const rows = await trx
    .selectFrom("outbox")
    .select(["kind", "view", "channel", "detail", "locale", "text", "buttons", "dedup_key"])
    .where("org_id", "=", orgId)
    .where("kind", "=", "digest")
    .orderBy("dedup_key")
    .execute();
  return rows.map((row) => renderedOf(row).text);
}

const loopRow = (trx: Transaction<DB>, id: string) =>
  trx.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

async function ready(trx: Transaction<DB>, opts: Parameters<typeof briefOrg>[1] = {}): Promise<BriefOrg> {
  await isolateChannels(trx);
  return briefOrg(trx, opts);
}

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

describe("the consent of the member (D17, review 17 N4, N5)", () => {
  async function covered(trx: Transaction<DB>, opts: Parameters<typeof briefOrg>[1]) {
    const org = await ready(trx, opts);
    await waitingLoop(trx, org);
    await insertLoopRow(trx, org.ctx, org.mailboxId, {
      kind: "promised",
      text: "PROMISE-TEXT",
      counterpart: "promise@example.test",
      due_at: new Date("2026-11-20T10:00:00Z"),
    });
    await insertLoopRow(trx, org.ctx, org.mailboxId, {
      status: "closed",
      close_reason: "stale",
      closed_at: new Date("2026-11-19T10:00:00Z"),
      subject: "STALE-SUBJECT",
      due_at: new Date("2026-10-01T10:00:00Z"),
    });
    await insertTriaged(trx, org.ctx, org.mailboxId, {
      category: "needs_reply",
      createdAt: new Date("2026-11-18T05:00:00Z"),
      subject: "REPLY-MAIL",
      from: "x@x.test",
    });
    await runDigests(trx, EIGHT);
    return { org, text: (await digestTexts(trx, org.ctx.orgId))[0] ?? "" };
  }

  test("a member with no consent row: counts and the ask; no address, no loop subject, no loop text; mail lines show; nothing is marked", async () => {
    await withRollback(db, async (trx) => {
      const { org, text } = await covered(trx, { consent: false });
      expect(text).toContain("⏳ Waiting on others: 1");
      expect(text).toContain("🤝 Promised: 1");
      expect(text).toContain("⌛ Closed without an answer: 1");
      expect(text).toContain("Confirm the new Telegram terms in the panel to see them here.");
      for (const secret of [
        "anna@example.test",
        "promise@example.test",
        "Offer for Q1",
        "send the offer",
        "PROMISE-TEXT",
        "STALE-SUBJECT",
      ])
        expect(text).not.toContain(secret);
      expect(text).toContain("REPLY-MAIL");
      const loops = await trx
        .selectFrom("open_loops")
        .select(["surfaced_at", "stale_notified_at"])
        .where("org_id", "=", org.ctx.orgId)
        .execute();
      expect(loops.every((row) => row.surfaced_at === null && row.stale_notified_at === null)).toBe(true);
      const view = (
        await trx.selectFrom("outbox").select("view").where("org_id", "=", org.ctx.orgId).executeTakeFirstOrThrow()
      ).view as { loopIds?: string[] };
      expect(view.loopIds).toBeUndefined();
    });
  });

  test("an old consent version, a garbage version and an unlink after the consent are not covered; a newer consent is", async () => {
    for (const make of [
      (trx: Transaction<DB>, org: BriefOrg) =>
        consentRow(trx, org.ctx.orgId, org.userId, "2026-11-15", new Date("2026-11-06T00:00:00Z")),
      (trx: Transaction<DB>, org: BriefOrg) =>
        consentRow(trx, org.ctx.orgId, org.userId, "garbage", new Date("2026-11-06T00:00:00Z")),
      (trx: Transaction<DB>, org: BriefOrg) =>
        unlinkRow(trx, org.ctx.orgId, org.userId, new Date("2026-11-19T00:00:00Z")),
    ]) {
      await withRollback(db, async (trx) => {
        await isolateChannels(trx);
        const org = await briefOrg(trx, { consent: false });
        await make(trx, org);
        await waitingLoop(trx, org);
        await runDigests(trx, EIGHT);
        const text = (await digestTexts(trx, org.ctx.orgId))[0] ?? "";
        expect(text).toContain("Confirm the new Telegram terms in the panel");
        expect(text).not.toContain("anna@example.test");
      });
    }
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const org = await briefOrg(trx, { consent: false });
      await unlinkRow(trx, org.ctx.orgId, org.userId, new Date("2026-11-06T00:00:00Z"));
      await consentRow(trx, org.ctx.orgId, org.userId, "2026-11-15.2", new Date("2026-11-07T00:00:00Z"));
      await waitingLoop(trx, org);
      await runDigests(trx, EIGHT);
      expect((await digestTexts(trx, org.ctx.orgId))[0]).toContain("anna@example.test");
    });
  });

  test("a covered member gets the lines; the later digest of an uncovered member still gets the counts only", async () => {
    await withRollback(db, async (trx) => {
      const { text } = await covered(trx, {});
      expect(text).toContain("anna@example.test");
      expect(text).not.toContain("Confirm the new Telegram terms");
    });
    await withRollback(db, async (trx) => {
      const org = await ready(trx, { consent: false });
      await waitingLoop(trx, org);
      await runDigests(trx, EIGHT);
      await runDigests(trx, SIXTEEN);
      expect((await digestTexts(trx, org.ctx.orgId))[1]?.split("\n").at(-1)).toBe("🔁 Open loops: 1 waiting");
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
      expect(text).toContain("⏳ Brak odpowiedzi od anna@example.test od wt. 10.11 · send the offer");
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
