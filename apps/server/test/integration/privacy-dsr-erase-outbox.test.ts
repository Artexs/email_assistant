import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { noticeKinds } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { auditEvents } from "../../src/modules/audit";
import {
  eraseManyMailOutbox,
  eraseSubjectData,
  NOTICE_MAIL_CONTENT,
  type DsrEraseResult,
} from "../../src/modules/privacy";
import { insertDigest } from "../../src/modules/reports";
import { createDb, type DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb } from "./helpers";

// F106 stage 09: the erase blanks stored digests and approval sets that can list the erased mail. The seed is committed
// (the erase runs its own transaction); `afterEach` removes it. The connection is the `app` role.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/org-dsr.ts");
const KEY = Buffer.alloc(32, 7).toString("base64");
const HOUR = 3_600_000;
// 55 characters: the digest cuts a sender to 40, so the address pattern of the erase cannot match it there.
const PERSON = "jan.kowalski-nowak.dzial.ksiegowosci@example-firma.test";
const CUT_SENDER = PERSON.slice(0, 39);
const SUBJECT = "Faktura korekta 7/2026";
const AI_TEXT = "prosi o zwrot kosztow";

const orgIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

interface World {
  orgId: string;
  userId: string;
  mailboxId: string;
  goneMail: string; // from the person; created at T0
  keptMail: string; // from someone else
  t0: Date;
  rows: Record<string, string>; // name → outbox id
}

const digestText = `Digest\n1. ${CUT_SENDER}… — ${SUBJECT}\n   ${AI_TEXT}`;
const digestView = { text: digestText, buttons: [[{ text: "Open", data: "x" }]] };

async function seed(options: { extraRows?: boolean } = {}): Promise<World> {
  const t0 = new Date(Date.now() - 6 * HOUR);
  const suffix = randomUUID().slice(0, 8);
  return db.transaction().execute(async (trx) => {
    const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
    userIds.push(userId);
    orgIds.push(orgId);
    const ctx = { orgId };
    const goneMail = await insertTestEmail(trx, ctx, mailboxId, {
      from_address: PERSON,
      subject: SUBJECT,
      created_at: t0,
    });
    const keptMail = await insertTestEmail(trx, ctx, mailboxId, {
      from_address: `kept-${suffix}@x.test`,
      subject: "Other",
      created_at: new Date(t0.getTime() + HOUR),
    });
    const rows: Record<string, string> = {};
    let n = 0;
    const slot = () => {
      n += 1;
      return `2026-11-0${n}T09:00`;
    };
    const digest = async (
      name: string,
      status: "sent" | "failed" | "pending" | "sending",
      createdAt: Date
    ): Promise<void> => {
      const key = slot();
      const digestId = await insertDigest(trx, ctx, {
        userId,
        slotKey: key,
        periodStart: new Date(createdAt.getTime() - HOUR),
        periodEnd: createdAt,
      });
      if (digestId === null) throw new Error("digest slot taken");
      rows[name] = await outbox(trx, orgId, userId, {
        kind: "digest",
        dedup: `digest:${key}`,
        status,
        createdAt,
        digestId,
      });
    };
    const hoursAfter = (h: number) => new Date(t0.getTime() + h * HOUR);
    await digest("oldSent", "sent", hoursAfter(-2));
    await digest("newSent", "sent", hoursAfter(1));
    await digest("newPending", "pending", hoursAfter(2));
    if (options.extraRows === true) {
      await digest("newFailed", "failed", hoursAfter(3));
      await digest("newSending", "sending", hoursAfter(4));
    }
    rows.setKeptSent = await outbox(trx, orgId, userId, {
      kind: "approval_set",
      dedup: `approval_set:kept-${suffix}`,
      status: "sent",
      createdAt: hoursAfter(1),
      emailId: keptMail,
    });
    rows.setGoneSent = await outbox(trx, orgId, userId, {
      kind: "approval_set",
      dedup: `approval_set:gone-${suffix}`,
      status: "sent",
      createdAt: hoursAfter(1),
      emailId: goneMail,
    });
    rows.setKeptPending = await outbox(trx, orgId, userId, {
      kind: "approval_set",
      dedup: `approval_set:pending-${suffix}`,
      status: "pending",
      createdAt: hoursAfter(1),
      emailId: keptMail,
    });
    rows.urgentKept = await outbox(trx, orgId, userId, {
      kind: "urgent",
      dedup: `urgent:kept-${suffix}`,
      status: "sent",
      createdAt: hoursAfter(1),
      emailId: keptMail,
    });
    rows.syncOk = await outbox(trx, orgId, userId, {
      kind: "sync_ok",
      dedup: `sync_ok:${suffix}`,
      status: "sent",
      createdAt: hoursAfter(1),
      mailboxId,
    });
    return { orgId, userId, mailboxId, goneMail, keptMail, t0, rows };
  });
}

async function outbox(
  trx: Transaction<DB>,
  orgId: string,
  userId: string,
  row: {
    kind: "digest" | "approval_set" | "urgent" | "sync_ok";
    dedup: string;
    status: "sent" | "failed" | "pending" | "sending";
    createdAt: Date;
    emailId?: string;
    mailboxId?: string;
    digestId?: string;
  }
): Promise<string> {
  const view = row.kind === "digest" || row.kind === "approval_set" ? digestView : { note: "kept" };
  const inserted = await trx
    .insertInto("outbox")
    .values({
      org_id: orgId,
      user_id: userId,
      kind: row.kind,
      dedup_key: row.dedup,
      email_id: row.emailId ?? null,
      mailbox_id: row.mailboxId ?? null,
      digest_id: row.digestId ?? null,
      text: row.kind === "digest" || row.kind === "approval_set" ? digestText : "Notice text",
      view: JSON.stringify(view),
      status: row.status,
      created_at: row.createdAt,
      next_attempt_at: row.createdAt,
      sent_at: row.status === "sent" ? row.createdAt : null,
      locked_at: row.status === "sending" ? row.createdAt : null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

async function outboxRows(orgId: string): Promise<Record<string, unknown>[]> {
  const result = await sql<{ r: Record<string, unknown> }>`
    select row_to_json(o) as r from outbox o where org_id = ${orgId}::uuid order by id`.execute(db);
  return result.rows.map((row) => row.r);
}

async function row(id: string) {
  return db.selectFrom("outbox").select(["id", "text", "view", "status"]).where("id", "=", id).executeTakeFirst();
}

async function erase(w: World, extra: Partial<Parameters<typeof eraseSubjectData>[1]> = {}): Promise<DsrEraseResult> {
  return eraseSubjectData(db, { orgId: w.orgId, address: PERSON, confirm: PERSON, credentialsKey: KEY, ...extra });
}

async function erased(w: World, extra: Partial<Parameters<typeof eraseSubjectData>[1]> = {}) {
  const result = await erase(w, extra);
  if (result.kind !== "erased") throw new Error(`erase answered ${result.kind}`);
  return result;
}

async function run(args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
}

describe("erase: stored messages that list many mails", () => {
  test("1. every notice kind has a class (the registry is typed over NoticeKind); the many-mails kinds are the two lists", () => {
    expect(Object.keys(NOTICE_MAIL_CONTENT).sort()).toEqual([...noticeKinds].sort());
    const many = noticeKinds.filter((kind) => NOTICE_MAIL_CONTENT[kind] === "many_mails");
    expect(many.sort()).toEqual(["approval_set", "digest"]);
  });

  test("2. a sent digest after the erased mail loses the cut sender, the subject and the AI text", async () => {
    const w = await seed();
    const before = await row(w.rows.newSent as string);
    expect(before?.text).toContain(CUT_SENDER);
    expect(before?.text).toContain(SUBJECT);
    expect(before?.text).toContain(AI_TEXT);
    expect(CUT_SENDER).not.toBe(PERSON);
    await erased(w);
    const after = await row(w.rows.newSent as string);
    expect(after).toMatchObject({ text: "[removed]", view: {}, status: "sent" });
  });

  test("3. a pending digest in the range is deleted; its digests row stays; the slot is not queued again", async () => {
    const w = await seed();
    const pending = await row(w.rows.newPending as string);
    expect(pending?.status).toBe("pending");
    const slotsBefore = await db.selectFrom("digests").select("slot_key").where("org_id", "=", w.orgId).execute();
    await erased(w);
    expect(await row(w.rows.newPending as string)).toBeUndefined();
    const slotsAfter = await db.selectFrom("digests").select("slot_key").where("org_id", "=", w.orgId).execute();
    expect(slotsAfter).toHaveLength(slotsBefore.length);
    // The digest job inserts the `digests` row first: the dropped slot answers null (no second message), a later slot works.
    const ctx = { orgId: w.orgId };
    const dropped = slotsBefore.map((slot) => slot.slot_key).sort()[2] as string;
    const again = await insertDigest(db, ctx, {
      userId: w.userId,
      slotKey: dropped,
      periodStart: w.t0,
      periodEnd: new Date(w.t0.getTime() + HOUR),
    });
    expect(again).toBeNull();
    const next = await insertDigest(db, ctx, {
      userId: w.userId,
      slotKey: "2026-11-09T09:00",
      periodStart: w.t0,
      periodEnd: new Date(w.t0.getTime() + HOUR),
    });
    expect(next).not.toBeNull();
  });

  test("4. a sent digest from before the earliest erased mail is unchanged", async () => {
    const w = await seed();
    const before = await row(w.rows.oldSent as string);
    await erased(w);
    expect(await row(w.rows.oldSent as string)).toEqual(before);
    expect(before?.text).toContain(SUBJECT);
  });

  test("5. a sent approval set of a kept mail is blanked; one of the erased mail is gone by cascade", async () => {
    const w = await seed();
    await erased(w);
    expect(await row(w.rows.setKeptSent as string)).toMatchObject({ text: "[removed]", view: {} });
    expect(await row(w.rows.setGoneSent as string)).toBeUndefined();
  });

  test("6. a pending approval set of kept mails, a one-mail kind and a no-mail kind stay unchanged", async () => {
    const w = await seed();
    const names = ["setKeptPending", "urgentKept", "syncOk"];
    const before = await Promise.all(names.map((name) => row(w.rows[name] as string)));
    await erased(w);
    expect(await Promise.all(names.map((name) => row(w.rows[name] as string)))).toEqual(before);
  });

  test("7. an erase that removes no mail changes no outbox row", async () => {
    const w = await seed();
    const before = await outboxRows(w.orgId);
    const result = await erased(w, { address: "nobody@x.test", confirm: "nobody@x.test" });
    expect(result.counts.mails).toBe(0);
    expect(result.stepCounts).toEqual({ outbox_blanked: 0, outbox_dropped: 0 });
    expect(await outboxRows(w.orgId)).toEqual(before);
  });

  test("8. the audit row holds the counts and no address; failed and sending rows are covered", async () => {
    const w = await seed();
    const result = await erased(w);
    expect(result.stepCounts).toEqual({ outbox_blanked: 2, outbox_dropped: 1 });
    const audit = await db
      .selectFrom("audit_log")
      .select("data")
      .where("org_id", "=", w.orgId)
      .where("event", "=", auditEvents.dsrErase)
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.data).toMatchObject({ outbox_blanked: 2, outbox_dropped: 1 });
    expect(JSON.stringify(audit)).not.toContain("example-firma");

    const w2 = await seed({ extraRows: true });
    const result2 = await erased(w2);
    expect(result2.stepCounts).toEqual({ outbox_blanked: 3, outbox_dropped: 2 });
    expect(await row(w2.rows.newFailed as string)).toMatchObject({ text: "[removed]", view: {} });
    expect(await row(w2.rows.newSending as string)).toBeUndefined();
  });

  test("8b. a second erase blanks nothing again", async () => {
    const w = await seed();
    await erased(w);
    const after = await outboxRows(w.orgId);
    const second = await erased(w);
    expect(second.stepCounts).toEqual({ outbox_blanked: 0, outbox_dropped: 0 });
    expect(await outboxRows(w.orgId)).toEqual(after);
  });

  test("9. another organization's digests are unchanged, also with the same person and the same times", async () => {
    const a = await seed();
    const b = await seed();
    const before = await outboxRows(b.orgId);
    expect(before.length).toBeGreaterThan(0);
    await erased(a);
    expect(await outboxRows(b.orgId)).toEqual(before);
  });

  test("9b. the step's own org filter: on a connection without row-level policies another organization stays whole", async () => {
    const url = process.env.MIGRATOR_DATABASE_URL;
    if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the integration tests need it");
    const owner = createDb(url);
    try {
      const a = await seed();
      const b = await seed();
      const beforeB = await outboxRows(b.orgId);
      const counts = await owner
        .transaction()
        .execute((trx) => eraseManyMailOutbox(trx, a.orgId, { mailIds: [a.goneMail], earliestCreatedAt: a.t0 }));
      expect(counts).toEqual({ outbox_blanked: 3, outbox_dropped: 1 });
      expect(await outboxRows(b.orgId)).toEqual(beforeB);
    } finally {
      await owner.destroy();
    }
  });

  test("10. a failure after the step rolls the outbox back too (one transaction)", async () => {
    const w = await seed();
    const before = await outboxRows(w.orgId);
    const boom = new Error("boom");
    await expect(
      erase(w, {
        step: async (trx, orgId, erasedRows) => {
          const counts = await eraseManyMailOutbox(trx, orgId, erasedRows);
          expect(counts).toEqual({ outbox_blanked: 2, outbox_dropped: 1 });
          throw boom;
        },
      })
    ).rejects.toBe(boom);
    expect(await outboxRows(w.orgId)).toEqual(before);
  });

  test("11. the CLI prints both outbox lines and no address", async () => {
    const w = await seed();
    const result = await run(["--org-id", w.orgId, "--address", PERSON, "--erase", "--confirm", PERSON]);
    expect(result.code).toBe(0);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toContain("blanked outbox 2");
    expect(lines).toContain("dropped outbox 1");
    expect(result.stdout + result.stderr).not.toContain("example-firma");
  });
});
