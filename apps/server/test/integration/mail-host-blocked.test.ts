import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { detectNotices } from "../../src/modules/channels";
import { configureMailHosts, NO_TEST_SENDERS, resolveMailHost, type LookupAll } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createMailSyncJob } from "../../src/modules/mail/jobs";
import { insertCredentials, markSynced } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, isolateChannels, linkChat, randomChatId, renderedOf } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const MINUTE = 60_000;
const HOUR = 3_600_000;
// 13:00 in Europe/Warsaw: outside the quiet hours.
const NOW = new Date("2026-11-14T12:00:00Z");
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

// The preload (`bunfig.toml`) allows local hosts for GreenMail: put that policy back after each test.
afterEach(() => {
  configureMailHosts({ allowLocal: true });
});

let lines: string[] = [];
let spies: ReturnType<typeof spyOn>[] = [];

beforeEach(() => {
  lines = [];
  spies = (["log", "warn", "error"] as const).map((name) =>
    spyOn(console, name).mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    })
  );
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

async function outboxRows(trx: Transaction<DB>, orgId: string, kind: string) {
  const found = await trx
    .selectFrom("outbox")
    .select([
      "user_id",
      "kind",
      "dedup_key",
      "text",
      "buttons",
      "view",
      "locale",
      "status",
      "error_code",
      "channel",
      "detail",
    ])
    .where("org_id", "=", orgId)
    .where("kind", "=", kind)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return found.map((row) => ({ ...row, ...renderedOf(row) }));
}

async function auditCount(trx: Transaction<DB>, mailboxId: string, event: string): Promise<number> {
  const rows = await trx.selectFrom("audit_log").select("data").where("event", "=", event).execute();
  return rows.filter((row) => (row.data as { mailbox_id?: string }).mailbox_id === mailboxId).length;
}

describe("a mailbox whose host the guard refuses: the whole episode", () => {
  test("the guard refuses, the mailbox is blocked, the owner gets one notice, the guard passes, the mailbox is active again", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const address = `box-${randomUUID()}@firma.test`;
      const created = await createOrgWithMailbox(trx, { address });
      const ctx = { orgId: created.orgId };
      const mailboxId = created.mailboxId;
      const secret = secrets.encrypt("pw", `mailbox:${mailboxId}`);
      await insertCredentials(trx, ctx, {
        mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      const assistantId = await addMember(trx, created.orgId);
      await linkChat(trx, ctx, created.userId, randomChatId(), at(-HOUR));
      await linkChat(trx, ctx, assistantId, randomChatId(), at(-HOUR));
      await markSynced(trx, ctx, mailboxId, at(-5 * MINUTE));
      await trx
        .updateTable("mailboxes")
        .set({ status_changed_at: at(-HOUR) })
        .where("id", "=", mailboxId)
        .execute();

      const answers = new Map<string, string>();
      const lookup: LookupAll = async (host) => [{ address: answers.get(host) ?? "93.184.216.34", family: 4 }];
      configureMailHosts({ allowLocal: false, lookup });

      let clock = NOW;
      const job = createMailSyncJob({
        db: trx,
        secrets,
        openProvider: async (opts) => {
          if (opts.user !== address) throw new Error("no fake for this address");
          await resolveMailHost(opts.host);
          return createFakeMailProvider({ uidValidity: 7 });
        },
        isOwnActionId: async () => false,
        now: () => clock,
      });
      const notices = (time: Date) =>
        detectNotices({ db: trx, now: () => time, startedAt: at(-HOUR), testMail: NO_TEST_SENDERS });
      const mailbox = () =>
        trx
          .selectFrom("mailboxes")
          .select(["status", "status_changed_at", "last_synced_at"])
          .where("id", "=", mailboxId)
          .executeTakeFirstOrThrow();

      // 1: the guard refuses the IMAP host at the sync.
      answers.set("imap.x.test", "10.0.0.7");
      await job.run();
      expect(await mailbox()).toMatchObject({ status: "host_blocked", status_changed_at: NOW });
      expect(await auditCount(trx, mailboxId, "mailbox.host_blocked")).toBe(1);
      const audit = await trx
        .selectFrom("audit_log")
        .select("data")
        .where("event", "=", "mailbox.host_blocked")
        .execute();
      expect(audit.find((row) => (row.data as { mailbox_id?: string }).mailbox_id === mailboxId)?.data).toEqual({
        mailbox_id: mailboxId,
        source: "sync",
      });

      // 2: one notice for the owner, with no host name and no address.
      await notices(at(MINUTE));
      let found = await outboxRows(trx, created.orgId, "host_blocked");
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        user_id: created.userId,
        dedup_key: `host_blocked:${mailboxId}:${NOW.getTime()}`,
        status: "pending",
      });
      expect(found[0]?.text).toContain(address);
      for (const secretText of ["imap.x.test", "smtp.x.test", "10.0.0.7"]) {
        expect(found[0]?.text).not.toContain(secretText);
      }

      // 3: still refused: nothing new, and no "sync is late" notice.
      clock = at(5 * MINUTE);
      await job.run();
      await notices(at(6 * MINUTE));
      found = await outboxRows(trx, created.orgId, "host_blocked");
      expect(found).toHaveLength(1);
      expect(await auditCount(trx, mailboxId, "mailbox.host_blocked")).toBe(1);
      expect(await outboxRows(trx, created.orgId, "sync_stale")).toEqual([]);

      // 4: the guard passes: the re-check reopens the mailbox and the same run syncs it.
      answers.set("imap.x.test", "93.184.216.34");
      clock = at(10 * MINUTE);
      await job.run();
      expect(await mailbox()).toMatchObject({
        status: "active",
        status_changed_at: at(10 * MINUTE),
        last_synced_at: at(10 * MINUTE),
      });
      expect(await auditCount(trx, mailboxId, "mailbox.host_allowed")).toBe(1);

      // 5: the notice is outdated; no late-sync notice, no new block notice.
      await notices(at(11 * MINUTE));
      found = await outboxRows(trx, created.orgId, "host_blocked");
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ status: "failed", error_code: "outdated" });
      expect(await outboxRows(trx, created.orgId, "sync_stale")).toEqual([]);

      // 6: no log line holds a host name or an address.
      for (const hidden of ["imap.x.test", "smtp.x.test", "10.0.0.7", "93.184.216.34"]) {
        expect(lines.some((line) => line.includes(hidden))).toBe(false);
      }
    });
  });
});
