import { randomUUID } from "node:crypto";

import { MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { isOwnMailOf } from "../../src/composition";
import { isOwnActionId } from "../../src/modules/actions";
import {
  createImapReportMailbox,
  createReportMailSender,
  insertOutbox,
  isOwnReportMail,
} from "../../src/modules/channels";
import {
  backfillMailbox,
  connectMailbox,
  openImapProvider,
  renderSeedMessage,
  syncMailbox,
  verifySmtpLogin,
  type ImapConnectOptions,
} from "../../src/modules/mail";
import { insertDigest } from "../../src/modules/reports";
import { createOrganizationWithOwner, setMemberReportChannel, setOrgFeature } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";

import { isolateChannels } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The report mail against the real IMAP server (GreenMail, bun run dev:up; auth is off, any password logs in): the report mail sender
// APPENDs a digest row into the INBOX, and no sync, history backfill or rescan stores it (ADR 0022 point 2). Random addresses.
const db = testDb();
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
const config = loadConfig();
const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
const BASE = "https://app.example.test";

afterAll(async () => {
  await db.destroy();
});

async function setup(trx: Transaction<DB>) {
  await isolateChannels(trx);
  const suffix = randomUUID();
  const { orgId, userId } = await createOrganizationWithOwner(trx, {
    orgName: `Report Mail Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: `report-${suffix}@x.test`,
    displayName: "Owner",
    locale: "en",
  });
  const ctx = { orgId };
  const address = `r-${suffix}@localhost`;
  const imap: ImapConnectOptions = {
    host,
    port: imapPort,
    user: address,
    auth: { kind: "password", password: `pw-${suffix}` },
  };
  const { mailboxId } = await connectMailbox(
    { db: trx, secrets, openProvider: openImapProvider, verifySmtp: verifySmtpLogin },
    ctx,
    { address, password: `pw-${suffix}`, secretKind: "password", imapHost: host, imapPort, smtpHost: host, smtpPort }
  );
  const now = new Date();
  await setMemberReportChannel(trx, ctx, userId, { channel: "mail", mailboxId });
  await setOrgFeature(trx, ctx, { flag: "report_mail", enabled: true, actor: "cli", now });
  return { ctx, orgId, userId, mailboxId, address, imap, now, suffix };
}

async function digestRow(trx: Transaction<DB>, s: Awaited<ReturnType<typeof setup>>): Promise<string> {
  const digestId = await insertDigest(trx, s.ctx, {
    userId: s.userId,
    slotKey: "2026-11-17T08:00",
    periodStart: new Date(s.now.getTime() - DAY_MS),
    periodEnd: s.now,
  });
  const id = await insertOutbox(trx, s.ctx, {
    userId: s.userId,
    kind: "digest",
    dedupKey: "digest:2026-11-17T08:00:mail",
    mailboxId: s.mailboxId,
    ...(digestId === null ? {} : { digestId }),
    view: { text: `📬 Digest\nOpen: ${BASE}/activity?category=spam`, buttons: [] },
    locale: "en",
    channel: "mail",
    createdAt: s.now,
    nextAttemptAt: s.now,
  });
  if (id === null) throw new Error("no mail row");
  return id;
}

const emailsOf = (trx: Transaction<DB>, mailboxId: string) =>
  trx.selectFrom("emails").select(["uid", "status", "skip_reason"]).where("mailbox_id", "=", mailboxId).execute();

test("a digest row is appended into the real INBOX with the outbox id; the sync, the history backfill and the operator backfill skip it", async () => {
  await withRollback(db, async (trx) => {
    const s = await setup(trx);
    const id = await digestRow(trx, s);
    const mailbox = createImapReportMailbox({ db: trx, secrets, openProvider: openImapProvider, now: () => s.now });
    await createReportMailSender({ db: trx, mailbox, now: () => s.now, webBaseUrl: BASE }).run();

    const sent = await trx
      .selectFrom("outbox")
      .select(["status", "external_message_id"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(sent).toMatchObject({ status: "sent", external_message_id: null });

    const server = await openImapProvider(s.imap);
    try {
      const inbox = await server.fetchAbove("INBOX", 0);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toMatchObject({
        subject: "[Email assistant] Digest",
        actionId: id,
        messageId: `<ea-report-${id}@localhost>`,
      });
      expect(inbox[0]?.to).toEqual([s.address]);
      expect(inbox[0]?.from).toBe(s.address);
      const fetched = await server.fetchFlagsIn("INBOX", [inbox[0]?.uid ?? 0]);
      // No flag: the message shows as new in the INBOX.
      expect(fetched[0]?.flags).toEqual([]);
    } finally {
      await server.close();
    }

    // Test 4: the sync skips it.
    const synced = await syncMailbox(
      { db: trx, provider: await openImapProvider(s.imap), isOwnActionId: isOwnMailOf(trx), now: () => s.now },
      s.ctx,
      s.mailboxId
    );
    expect(synced.skippedOwn).toBe(1);
    expect(synced.stored).toBe(0);
    expect(await emailsOf(trx, s.mailboxId)).toEqual([]);

    // Test 5: the history backfill and the operator backfill read the INBOX window and skip it.
    const deps = { db: trx, secrets, isOwnActionId: isOwnMailOf(trx) };
    const history = await backfillMailbox(deps, s.ctx, s.mailboxId, { days: 30, now: s.now, purpose: "history" });
    expect(history.kind).toBe("done");
    const plain = await backfillMailbox(deps, s.ctx, s.mailboxId, { days: 30, now: s.now });
    expect(plain.stored).toBe(0);
    expect(await emailsOf(trx, s.mailboxId)).toEqual([]);

    // Control: with the check of drafts alone, the same history run stores the report mail as a mail of the user.
    const control = await backfillMailbox(
      { db: trx, secrets, isOwnActionId: (ctx, mailboxId, actionId) => isOwnActionId(trx, ctx, mailboxId, actionId) },
      s.ctx,
      s.mailboxId,
      { days: 30, now: s.now, purpose: "history" }
    );
    expect(control.kind).toBe("done");
    expect(await emailsOf(trx, s.mailboxId)).toHaveLength(1);
  });
});

test("a foreign mail with a forged X-EA-Action-Id is stored; a value that is not a uuid gives no query error", async () => {
  await withRollback(db, async (trx) => {
    const s = await setup(trx);
    // The id of a Telegram outbox row of this organization (not a mail row), the id of nothing, and values that are not uuids.
    const telegramRow = await insertOutbox(trx, s.ctx, {
      userId: s.userId,
      kind: "weekly_report",
      dedupKey: `weekly_report:${randomUUID()}`,
      mailboxId: s.mailboxId,
      view: {},
      locale: "en",
      createdAt: s.now,
      nextAttemptAt: s.now,
    });
    const mailRow = await digestRow(trx, s);
    const forged = [
      telegramRow ?? "",
      randomUUID(),
      "not-a-uuid",
      "x'; DROP TABLE outbox; --",
      mailRow.toUpperCase().slice(0, 30),
    ];
    const server = await openImapProvider(s.imap);
    try {
      for (const [index, value] of forged.entries()) {
        await server.appendMessage(
          "INBOX",
          Buffer.from(
            renderSeedMessage({
              messageId: `<forged${index}-${s.suffix}@x.test>`,
              from: `stranger${index}@x.test`,
              to: [s.address],
              subject: `Forged ${index}`,
              date: s.now,
              text: `Body ${index}`,
              headers: { "X-EA-Action-Id": value },
            })
          ),
          [],
          s.now
        );
      }
    } finally {
      await server.close();
    }
    const synced = await syncMailbox(
      { db: trx, provider: await openImapProvider(s.imap), isOwnActionId: isOwnMailOf(trx), now: () => s.now },
      s.ctx,
      s.mailboxId
    );
    expect(synced.skippedOwn).toBe(0);
    expect(synced.stored).toBe(forged.length);
    expect((await emailsOf(trx, s.mailboxId)).map((row) => row.status)).toEqual(forged.map(() => "pending"));
  });
});

test("isOwnReportMail: only a mail row of this organization and this mailbox counts; a uuid is needed", async () => {
  await withRollback(db, async (trx) => {
    const a = await setup(trx);
    const b = await setup(trx);
    const mailRow = await digestRow(trx, a);
    expect(await isOwnReportMail(trx, a.ctx, a.mailboxId, mailRow)).toBe(true);
    // Another mailbox, another organization, an unknown id and a value that is not a uuid.
    expect(await isOwnReportMail(trx, a.ctx, randomUUID(), mailRow)).toBe(false);
    expect(await isOwnReportMail(trx, b.ctx, b.mailboxId, mailRow)).toBe(false);
    // The mailbox and the row are right but the caller names another organization: the organization filter decides.
    expect(await isOwnReportMail(trx, b.ctx, a.mailboxId, mailRow)).toBe(false);
    expect(await isOwnReportMail(trx, a.ctx, a.mailboxId, randomUUID())).toBe(false);
    expect(await isOwnReportMail(trx, a.ctx, a.mailboxId, "not-a-uuid")).toBe(false);
    // A Telegram row is no report mail.
    const telegram = await insertOutbox(trx, a.ctx, {
      userId: a.userId,
      kind: "weekly_report",
      dedupKey: `weekly_report:${randomUUID()}`,
      mailboxId: a.mailboxId,
      view: {},
      locale: "en",
      createdAt: a.now,
      nextAttemptAt: a.now,
    });
    expect(await isOwnReportMail(trx, a.ctx, a.mailboxId, telegram ?? "")).toBe(false);
  });
});

test("the APPEND landed and the mark did not: the next claim finds the message by its Message-ID and appends nothing", async () => {
  await withRollback(db, async (trx) => {
    const s = await setup(trx);
    const id = await digestRow(trx, s);
    const mailbox = createImapReportMailbox({ db: trx, secrets, openProvider: openImapProvider, now: () => s.now });
    await createReportMailSender({ db: trx, mailbox, now: () => s.now, webBaseUrl: BASE }).run();
    const server = await openImapProvider(s.imap);
    try {
      const before = await server.fetchAbove("INBOX", 0);
      expect(before).toHaveLength(1);
      expect(before[0]?.messageId).toBe(`<ea-report-${id}@localhost>`);
      // A crash after the APPEND leaves the row `sending` with an old lock (the mark never landed).
      await trx
        .updateTable("outbox")
        .set({ status: "sending", sent_at: null, locked_at: new Date(s.now.getTime() - 10 * MINUTE_MS) })
        .where("id", "=", id)
        .execute();
      const later = new Date(s.now.getTime() + MINUTE_MS);
      await createReportMailSender({ db: trx, mailbox, now: () => later, webBaseUrl: BASE }).run();
      const after = await server.fetchAbove("INBOX", 0);
      expect(after.map((meta) => meta.uid)).toEqual(before.map((meta) => meta.uid));
      // The own-mail header stays: the sync still skips the one message.
      expect(after[0]?.actionId).toBe(id);
    } finally {
      await server.close();
    }
    const row = await trx
      .selectFrom("outbox")
      .select(["status", "attempts"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: "sent", attempts: 1 });
  });
});
