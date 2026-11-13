import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { claimDueOutbox, insertOutbox, queueMailboxRemovedNotices } from "../../src/modules/channels";
import { MAILBOX_REMOVED_TEXT } from "../../src/modules/channels/texts";
import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import { claimEmails, listSyncTargets, removeMailbox, type RemoveDeps } from "../../src/modules/mail";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { insertDigest } from "../../src/modules/reports";
import { saveTriage, type TriageDecision, type TriageMailbox } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, insertTestEmail, linkChat, randomChatId, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { countMailboxRows, fillMailbox, type MailboxIds } from "./mailbox-rows";

const db = testDb();
const now = new Date("2026-11-11T10:00:00Z");

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

const deps: RemoveDeps = {
  db,
  onRemoved: async (trx, ctx, input) => {
    await queueMailboxRemovedNotices(trx, ctx, input);
  },
};

const decision: TriageDecision = {
  finalCategory: "info",
  modelCategory: "info",
  confidence: 0.9,
  reasonCode: "newsletter",
  reason: null,
  summary: "short summary",
  fields: {},
  vip: false,
  model: "m",
  promptVersion: "classifier-v1",
  usage: null,
  auditReasonCode: "newsletter",
  delegation: null,
};

// A committed organization with a filled mailbox and a linked owner.
async function setup(opts?: { address?: string }) {
  return db.transaction().execute(async (trx) => {
    const created = await createOrgWithMailbox(trx, opts);
    const ctx = { orgId: created.orgId };
    orgIds.push(created.orgId);
    userIds.push(created.userId);
    const ids = await fillMailbox(trx, ctx, created.mailboxId, created.userId);
    await linkChat(trx, ctx, created.userId, randomChatId(), now);
    return { ...created, ctx, ids };
  });
}

const counts = (orgId: string, ids: MailboxIds, opts?: { exceptEvents?: readonly string[] }) =>
  db.transaction().execute((trx) => countMailboxRows(trx, orgId, ids, opts));

async function addressOf(mailboxId: string): Promise<string> {
  const row = await db.selectFrom("mailboxes").select("address").where("id", "=", mailboxId).executeTakeFirstOrThrow();
  return row.address;
}

async function statusOf(mailboxId: string): Promise<string | undefined> {
  const row = await db.selectFrom("mailboxes").select("status").where("id", "=", mailboxId).executeTakeFirst();
  return row?.status;
}

async function auditRows(orgId: string, event: string) {
  return db.selectFrom("audit_log").selectAll().where("org_id", "=", orgId).where("event", "=", event).execute();
}

const allZero = (row: Record<string, number>) => Object.values(row).every((n) => n === 0);

async function insertDigestOutbox(
  trx: Transaction<DB>,
  orgId: string,
  userId: string,
  status: "pending" | "sent",
  slot: string,
  text: string
): Promise<string> {
  const ctx = { orgId };
  const digestId = await insertDigest(trx, ctx, {
    userId,
    slotKey: slot,
    periodStart: new Date("2026-11-10T10:00:00Z"),
    periodEnd: now,
  });
  const outboxId = await insertOutbox(trx, ctx, {
    userId,
    kind: "digest",
    dedupKey: `digest:${digestId}`,
    digestId: digestId ?? undefined,
    message: { text, buttons: [] },
    view: {},
    locale: "en",
    createdAt: now,
    nextAttemptAt: now,
  });
  if (!outboxId) throw new Error("digest outbox was not inserted");
  await trx
    .updateTable("outbox")
    .set({ status, sent_at: status === "sent" ? now : null })
    .where("id", "=", outboxId)
    .execute();
  return outboxId;
}

describe("removeMailbox", () => {
  test("a wrong address changes nothing", async () => {
    const s = await setup();
    const before = await counts(s.orgId, s.ids);
    const auditBefore = (await auditRows(s.orgId, "mailbox.paused")).length;

    const result = await removeMailbox(deps, s.ctx, s.mailboxId, {
      userId: s.userId,
      confirmAddress: "wrong@x.test",
      now,
    });

    expect(result).toEqual({ kind: "confirm_mismatch" });
    expect(await statusOf(s.mailboxId)).toBe("active");
    expect(await counts(s.orgId, s.ids)).toEqual(before);
    expect((await auditRows(s.orgId, "mailbox.paused")).length).toBe(auditBefore);
    expect(await auditRows(s.orgId, "mailbox.removed")).toEqual([]);
  });

  test("a mailbox of another organization or an unknown id is not found", async () => {
    const a = await setup();
    const b = await setup();
    const beforeA = await counts(a.orgId, a.ids);

    const other = await removeMailbox(deps, b.ctx, a.mailboxId, {
      userId: b.userId,
      confirmAddress: await addressOf(a.mailboxId),
      now,
    });
    expect(other).toEqual({ kind: "not_found" });
    const unknown = await removeMailbox(deps, a.ctx, randomUUID(), {
      userId: a.userId,
      confirmAddress: "any@x.test",
      now,
    });
    expect(unknown).toEqual({ kind: "not_found" });
    expect(await counts(a.orgId, a.ids)).toEqual(beforeA);
    expect(await statusOf(a.mailboxId)).toBe("active");
  });

  test("removes every row, writes one audit row and notifies the linked owner only", async () => {
    const s = await setup();
    const address = await addressOf(s.mailboxId);
    const { assistantId, unlinkedOwnerId } = await db.transaction().execute(async (trx) => {
      const assistant = await addMember(trx, s.orgId, "assistant");
      const unlinkedOwner = await addMember(trx, s.orgId, "owner");
      await linkChat(trx, s.ctx, assistant, randomChatId(), now);
      return { assistantId: assistant, unlinkedOwnerId: unlinkedOwner };
    });
    userIds.push(assistantId, unlinkedOwnerId);

    const result = await removeMailbox(deps, s.ctx, s.mailboxId, {
      userId: s.userId,
      confirmAddress: `  ${address.toUpperCase()} `,
      now,
    });

    expect(result).toEqual({ kind: "removed" });
    expect(allZero(await counts(s.orgId, s.ids, { exceptEvents: ["mailbox.removed"] }))).toBe(true);
    const audit = await auditRows(s.orgId, "mailbox.removed");
    expect(audit.length).toBe(1);
    expect(audit[0]?.actor).toBe(s.userId);
    expect(audit[0]?.data).toEqual({ mailbox_id: s.mailboxId });

    const notices = await db
      .selectFrom("outbox")
      .select(["user_id", "status", "text", "mailbox_id", "email_id"])
      .where("org_id", "=", s.orgId)
      .where("kind", "=", "mailbox_removed")
      .execute();
    expect(notices).toEqual([
      { user_id: s.userId, status: "pending", text: MAILBOX_REMOVED_TEXT, mailbox_id: null, email_id: null },
    ]);
    const leaks = await db
      .selectFrom("outbox")
      .select("id")
      .where("org_id", "=", s.orgId)
      .where(sql<boolean>`text ILIKE '%' || ${address} || '%'`)
      .execute();
    expect(leaks).toEqual([]);
  });

  test("a second mailbox of the organization and a mailbox of another organization keep their rows", async () => {
    const a = await setup();
    const b = await setup();
    const secondIds = await db.transaction().execute(async (trx) => {
      const id = randomUUID();
      await insertMailbox(trx, a.ctx, {
        id,
        address: `second-${id}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await insertInboxFolder(trx, a.ctx, id);
      await insertDefaultSettings(trx, a.ctx, id);
      return fillMailbox(trx, a.ctx, id, a.userId);
    });
    const beforeSecond = await counts(a.orgId, secondIds);
    const beforeB = await counts(b.orgId, b.ids);

    const result = await removeMailbox(deps, a.ctx, a.mailboxId, {
      userId: a.userId,
      confirmAddress: await addressOf(a.mailboxId),
      now,
    });

    expect(result).toEqual({ kind: "removed" });
    expect(await counts(a.orgId, secondIds)).toEqual(beforeSecond);
    expect(await counts(b.orgId, b.ids)).toEqual(beforeB);
  });

  test("a job that holds a claimed mail writes nothing after the removal", async () => {
    const s = await setup();
    const emailId = await db.transaction().execute((trx) => insertTestEmail(trx, s.ctx, s.mailboxId));
    const settings = await getMailboxSettings(db, s.ctx, s.mailboxId);
    if (!settings) throw new Error("no settings");
    const [email] = await claimEmails(db, s.ctx, s.mailboxId, {
      now,
      limit: 10,
      staleBefore: new Date(now.getTime() - 5 * 60_000),
      syntheticOnly: false,
    });
    if (!email) throw new Error("claim failed");
    const mailbox: TriageMailbox = {
      id: s.mailboxId,
      settingsVersion: settings.version,
      mode: "assist",
      toolSwitches: { move: true, mark_read: true, flag: true, create_draft: false, move_unsure: true },
      policy: { info: { auto: true } },
      rules: [],
      movesSupported: true,
      delegates: [],
      timezone: "Europe/Warsaw",
      junkFolder: null,
      resumedAt: null,
    };

    const result = await removeMailbox(deps, s.ctx, s.mailboxId, {
      userId: s.userId,
      confirmAddress: await addressOf(s.mailboxId),
      now,
    });
    expect(result).toEqual({ kind: "removed" });

    expect(await saveTriage(db, s.ctx, mailbox, email, decision, now)).toEqual({ kind: "lost" });
    const results = await db.selectFrom("triage_results").select("id").where("email_id", "=", emailId).execute();
    expect(results).toEqual([]);
    const actions = await db.selectFrom("actions").select("id").where("email_id", "=", emailId).execute();
    expect(actions).toEqual([]);
    const targets = await listSyncTargets(db);
    expect(targets.some((target) => target.mailboxId === s.mailboxId)).toBe(false);
  });

  test("a delete waits for a lock on the emails, then finishes", async () => {
    const s = await setup();
    const gate = Promise.withResolvers<undefined>();
    const lockTaken = Promise.withResolvers<undefined>();
    const holder = db.transaction().execute(async (trx) => {
      await sql`SELECT id FROM emails WHERE mailbox_id = ${s.mailboxId} FOR UPDATE`.execute(trx);
      lockTaken.resolve(undefined);
      await gate.promise;
    });
    await lockTaken.promise;

    let settled = false;
    const removal = removeMailbox(deps, s.ctx, s.mailboxId, {
      userId: s.userId,
      confirmAddress: await addressOf(s.mailboxId),
      now,
    }).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);

    gate.resolve(undefined);
    await holder;
    const result = await Promise.race([
      removal,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("remove took over 5 s")), 5000)),
    ]);
    expect(result).toEqual({ kind: "removed" });
    expect(allZero(await counts(s.orgId, s.ids, { exceptEvents: ["mailbox.removed"] }))).toBe(true);
  });

  test("two removals that both pass the lookup: the second gets not found from the delete", async () => {
    const s = await setup();
    const input = { userId: s.userId, confirmAddress: await addressOf(s.mailboxId), now };
    const gate = Promise.withResolvers<undefined>();
    const lockTaken = Promise.withResolvers<undefined>();
    const holder = db.transaction().execute(async (trx) => {
      await sql`SELECT id FROM mailboxes WHERE id = ${s.mailboxId} FOR UPDATE`.execute(trx);
      lockTaken.resolve(undefined);
      await gate.promise;
    });
    await lockTaken.promise;

    // The lookup is a plain read, so both calls pass it. The pause update then waits for the row lock.
    const removals = [removeMailbox(deps, s.ctx, s.mailboxId, input), removeMailbox(deps, s.ctx, s.mailboxId, input)];
    await new Promise((resolve) => setTimeout(resolve, 300));
    gate.resolve(undefined);
    await holder;
    const results = await Promise.all(removals);

    expect(results.map((result) => result.kind).sort()).toEqual(["not_found", "removed"]);
    expect((await auditRows(s.orgId, "mailbox.removed")).length).toBe(1);
  });

  test("two removals at once: one removed, one not found, one audit row", async () => {
    const s = await setup();
    const input = { userId: s.userId, confirmAddress: await addressOf(s.mailboxId), now };

    const results = await Promise.all([
      removeMailbox(deps, s.ctx, s.mailboxId, input),
      removeMailbox(deps, s.ctx, s.mailboxId, input),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(["not_found", "removed"]);
    expect((await auditRows(s.orgId, "mailbox.removed")).length).toBe(1);
  });

  test("a failing delete rolls back and restores the status", async () => {
    const s = await setup();
    const before = await counts(s.orgId, s.ids);
    const failing: RemoveDeps = {
      db,
      onRemoved: async () => {
        throw new Error("boom");
      },
    };

    await expect(
      removeMailbox(failing, s.ctx, s.mailboxId, {
        userId: s.userId,
        confirmAddress: await addressOf(s.mailboxId),
        now,
      })
    ).rejects.toThrow("boom");

    expect(await statusOf(s.mailboxId)).toBe("active");
    expect(await counts(s.orgId, s.ids)).toEqual(before);

    await db.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", s.mailboxId).execute();
    await expect(
      removeMailbox(failing, s.ctx, s.mailboxId, {
        userId: s.userId,
        confirmAddress: await addressOf(s.mailboxId),
        now,
      })
    ).rejects.toThrow("boom");
    expect(await statusOf(s.mailboxId)).toBe("paused");
    expect(await counts(s.orgId, s.ids)).toEqual(before);
  });

  test("the notice goes to the owners of the organization only", async () => {
    const a = await setup();
    const b = await setup();
    const queued = await db
      .transaction()
      .execute((trx) => queueMailboxRemovedNotices(trx, a.ctx, { mailboxId: a.mailboxId, now }));
    expect(queued).toBe(1);
    const rows = await db
      .selectFrom("outbox")
      .select("user_id")
      .where("kind", "=", "mailbox_removed")
      .where("org_id", "in", [a.orgId, b.orgId])
      .execute();
    expect(rows.map((row) => row.user_id)).toEqual([a.userId]);
  });

  test("no `[removed]` text is claimed after the removal", async () => {
    const s = await setup();
    await db.transaction().execute(async (trx) => {
      await insertDigestOutbox(trx, s.orgId, s.userId, "sent", "2026-11-10T08:00", "Digest sent");
      await insertDigestOutbox(trx, s.orgId, s.userId, "pending", "2026-11-11T08:00", "Digest pending");
    });

    const result = await removeMailbox(deps, s.ctx, s.mailboxId, {
      userId: s.userId,
      confirmAddress: await addressOf(s.mailboxId),
      now,
    });
    expect(result).toEqual({ kind: "removed" });

    const claimed = await claimDueOutbox(db, {
      now,
      limit: 50,
      staleBefore: new Date(now.getTime() - 5 * 60_000),
      orgIds: [s.orgId],
    });
    expect(claimed.some((row) => row.text === "[removed]")).toBe(false);
    expect(claimed.some((row) => row.text === "Digest pending")).toBe(false);
  });
});
