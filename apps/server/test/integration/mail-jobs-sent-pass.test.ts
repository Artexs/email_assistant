import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { HOUR_MS } from "@ea/core";
import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { MailAuthError, type SeedMessage } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createMailSyncJob } from "../../src/modules/mail/jobs";
import { getSentSyncState, lockSentSyncState, setFolderMapEntry, writeSentSwitch } from "../../src/modules/mail/repo";
import { CursorMovedError } from "../../src/modules/mail/sync";
import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";

import { pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  addBox,
  type Box,
  emailCount,
  jobFor,
  mailboxRow,
  NOW,
  type Opened,
  openers,
  secrets,
  seed,
} from "./mail-jobs-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("the Sent pass in the sync job", () => {
  const CANARY = "canary-detail-9f3a@secret.test";
  const SENT_SUBJECT = "Sent subject canary-5c1d";
  const UUID_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  beforeEach(() => {
    configureFeatures({ off: [] });
  });

  // Every console call as one string (util.format shows the fields of an error object that is logged raw).
  function captureConsole() {
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(format(...args)))
    );
    return {
      lines,
      restore: () => spies.forEach((spy) => spy.mockRestore()),
    };
  }

  async function enableSent(
    trx: Transaction<DB>,
    box: Box,
    opts: { flag?: boolean; switchOn?: boolean } = {}
  ): Promise<void> {
    const ctx = { orgId: box.orgId };
    if (opts.flag !== false) {
      await upsertOrgFeature(trx, ctx, { flag: "sent_sync", enabled: true, setBy: "test", setAt: NOW });
    }
    if (opts.switchOn !== false) {
      await writeSentSwitch(trx, ctx, box.mailboxId, { enabled: true, at: new Date(NOW.getTime() - HOUR_MS) });
    }
    await setFolderMapEntry(trx, ctx, box.mailboxId, "sent", "Sent");
  }

  function sentSeed(n: number, extra: Partial<SeedMessage> = {}): SeedMessage {
    return {
      messageId: `<sent${n}@x.test>`,
      from: "me@corp.test",
      to: [`to${n}@x.test`],
      subject: SENT_SUBJECT,
      date: new Date(NOW.getTime() - HOUR_MS),
      text: "Sent body canary-77aa",
      ...extra,
    };
  }

  async function fakeWithMail(box: Box, o: Opened, sent: boolean): Promise<FakeMailProvider> {
    const fake = createFakeMailProvider({ uidValidity: 7 });
    fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
    if (sent) fake.deliver("Sent", sentSeed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
    o.fakes.set(box.address, fake);
    return fake;
  }

  async function sentRows(trx: Transaction<DB>, mailboxId: string) {
    return trx
      .selectFrom("sent_emails")
      .select(["uid", "content", "body_text"])
      .where("mailbox_id", "=", mailboxId)
      .execute();
  }

  test("1: flag and switch on: the INBOX mail goes to emails, the Sent mail to sent_emails, and the log holds ids and counts", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await enableSent(trx, box);
      const o = openers();
      const fake = await fakeWithMail(box, o, true);

      const capture = captureConsole();
      try {
        await jobFor(trx, o).run();
      } finally {
        capture.restore();
      }

      // The Sent pass runs after the INBOX sync, never before it.
      const folders = fake.folderCalls.map((call) => call.folder);
      expect(folders.indexOf("INBOX")).toBeGreaterThanOrEqual(0);
      expect(folders.indexOf("Sent")).toBeGreaterThan(folders.lastIndexOf("INBOX"));
      expect(await emailCount(trx, box.mailboxId)).toBe(1);
      expect(await sentRows(trx, box.mailboxId)).toEqual([
        { uid: expect.anything(), content: "stored", body_text: "Sent body canary-77aa" },
      ]);
      expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toEqual(NOW);
      const state = await getSentSyncState(trx, { orgId: box.orgId }, box.mailboxId);
      expect(state?.lastPassAt).toEqual(NOW);
      expect(state?.lastErrorCode).toBeNull();

      const done = capture.lines.filter((line) => line.includes("sent_sync_done"));
      expect(done).toHaveLength(1);
      expect(done[0]).toContain(box.mailboxId);
      expect(done[0]).toMatch(/ status=done /);
      expect(done[0]).toMatch(/ duration_ms=\d+$/);
      expect(capture.lines.filter((line) => line.includes("sent_texts_done"))).toHaveLength(1);
      expect(box.mailboxId).toMatch(UUID_LOWER);
      const all = capture.lines.join("\n");
      for (const secret of [SENT_SUBJECT, "canary-77aa", "to1@x.test", "me@corp.test", box.address, "Sent"]) {
        expect(all).not.toContain(secret);
      }
    });
  });

  test("1b: a Sent fetchContent that never returns: the run ends near the budget, the log says budget, the connection closes, no error code", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await enableSent(trx, box);
      const o = openers();
      const fake = await fakeWithMail(box, o, true);
      let contentCalls = 0;
      const inboxContent = fake.fetchContent.bind(fake);
      fake.fetchContent = (folder, uid) => {
        if (folder !== "Sent") return inboxContent(folder, uid);
        contentCalls += 1;
        return new Promise(() => undefined);
      };

      const capture = captureConsole();
      const started = performance.now();
      try {
        await createMailSyncJob({
          db: trx,
          secrets,
          openProvider: o.openProvider,
          isOwnActionId: async () => false,
          sentOriginOf: async () => null,
          now: () => NOW,
          sentBudgetMs: 50,
        }).run();
      } finally {
        capture.restore();
      }

      expect(performance.now() - started).toBeLessThan(2_000);
      expect(contentCalls).toBe(1);
      expect(fake.closed).toBe(true);
      const done = capture.lines.filter((line) => line.includes("sent_sync_done"));
      expect(done).toHaveLength(1);
      expect(done[0]).toMatch(/ status=budget /);
      // The budget is 50 ms: the pass took at least that long (a late start or a constant 0 fails here).
      expect(Number(/ duration_ms=(\d+)$/.exec(done[0] ?? "")?.[1])).toBeGreaterThanOrEqual(40);
      expect(capture.lines.filter((line) => line.includes("sent_sync_failed"))).toEqual([]);
      const state = await getSentSyncState(trx, { orgId: box.orgId }, box.mailboxId);
      expect(state?.lastPassAt).toEqual(NOW);
      expect(state?.lastErrorCode).toBeNull();
    });
  });

  test("2: flag off, or switch off: no sent row, no read of the Sent folder, no sent log line", async () => {
    for (const opts of [{ flag: false }, { switchOn: false }]) {
      await withRollback(db, async (trx) => {
        await pauseOtherMailboxes(trx);
        const box = await addBox(trx);
        await enableSent(trx, box, opts);
        const o = openers();
        const fake = await fakeWithMail(box, o, true);

        const capture = captureConsole();
        try {
          await jobFor(trx, o).run();
        } finally {
          capture.restore();
        }

        expect(await emailCount(trx, box.mailboxId)).toBe(1);
        expect(await sentRows(trx, box.mailboxId)).toEqual([]);
        expect(fake.folderCalls.filter((call) => call.folder === "Sent")).toEqual([]);
        expect(capture.lines.filter((line) => line.includes("sent_"))).toEqual([]);
      });
    }
  });

  test("2b: when the INBOX sync fails, the Sent pass does not run", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await enableSent(trx, box);
      const o = openers();
      const fake = await fakeWithMail(box, o, true);
      fake.failOn("folderStatus", new CursorMovedError("cursor moved"));

      const capture = captureConsole();
      try {
        await jobFor(trx, o).run();
      } finally {
        capture.restore();
      }

      expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toBeNull();
      expect(fake.folderCalls.filter((call) => call.folder === "Sent")).toEqual([]);
      expect(await sentRows(trx, box.mailboxId)).toEqual([]);
      expect(capture.lines.filter((line) => line.includes("sent_"))).toEqual([]);
    });
  });

  test("3: a Sent pass that throws is caught; the INBOX mail is stored, the error is marked and logged with fields only", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const first = await addBox(trx);
      const second = await addBox(trx);
      // The failing mailbox syncs first: the test shows that the run goes on with the next mailbox.
      await trx
        .updateTable("mailboxes")
        .set({ created_at: sql`now() + interval '1 minute'` })
        .where("id", "=", second.mailboxId)
        .execute();
      await enableSent(trx, first);
      const o = openers();
      const fake = createFakeMailProvider({ uidValidity: 7 });
      fake.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
      fake.deliver("Sent", sentSeed(1, { headers: { "X-EA-Action-Id": randomUUID() } }), {
        internalDate: new Date(NOW.getTime() - HOUR_MS),
      });
      o.fakes.set(first.address, fake);
      const other = createFakeMailProvider({ uidValidity: 7 });
      other.deliver("INBOX", seed(2), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
      o.fakes.set(second.address, other);
      // A database-like error: a code, and a detail that holds mail data.
      const failure = Object.assign(new HardError(`check failed for ${CANARY}`), {
        code: "23514",
        detail: `Failing row contains (${CANARY}, ${SENT_SUBJECT})`,
      });

      const capture = captureConsole();
      try {
        await jobFor(trx, o, async () => {
          throw failure;
        }).run();
      } finally {
        capture.restore();
      }

      expect(await emailCount(trx, first.mailboxId)).toBe(1);
      expect(await emailCount(trx, second.mailboxId)).toBe(1);
      expect((await mailboxRow(trx, first.mailboxId)).last_synced_at).toEqual(NOW);
      expect((await mailboxRow(trx, first.mailboxId)).status).toBe("active");
      expect(await sentRows(trx, first.mailboxId)).toEqual([]);
      const state = await getSentSyncState(trx, { orgId: first.orgId }, first.mailboxId);
      expect(state?.lastErrorCode).toBe("failed");
      expect(state?.lastPassAt).toEqual(NOW);
      expect(fake.closed).toBe(true);

      const failed = capture.lines.filter((line) => line.includes("sent_sync_failed"));
      expect(failed).toHaveLength(1);
      expect(failed[0]).toContain(first.mailboxId);
      expect(failed[0]).toContain("23514");
      expect(capture.lines.filter((line) => line.includes("sent_sync_done"))).toEqual([]);
      const all = capture.lines.join("\n");
      for (const secret of [CANARY, SENT_SUBJECT, "Failing row", "check failed"]) expect(all).not.toContain(secret);
    });
  });

  test("4: a login error in the Sent pass is only logged: the status stays active", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await enableSent(trx, box);
      const o = openers();
      const fake = await fakeWithMail(box, o, false);
      fake.deliver("Sent", sentSeed(1, { headers: { "X-EA-Action-Id": randomUUID() } }), {
        internalDate: new Date(NOW.getTime() - HOUR_MS),
      });

      const capture = captureConsole();
      try {
        await jobFor(trx, o, async () => {
          throw new MailAuthError(`login failed for ${CANARY}`);
        }).run();
      } finally {
        capture.restore();
      }

      const row = await mailboxRow(trx, box.mailboxId);
      expect(row.status).toBe("active");
      expect(row.last_synced_at).toEqual(NOW);
      expect(capture.lines.filter((line) => line.includes("sent_sync_failed"))).toHaveLength(1);
      expect(capture.lines.join("\n")).not.toContain(CANARY);
    });
  });

  test("5: when marking the failure fails too, the run goes on and logs sent_sync_mark_failed without the detail", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await enableSent(trx, box);
      const o = openers();
      await fakeWithMail(box, o, true);
      // Every write to the state row fails with a detail that holds mail data.
      const broken = new Proxy(trx, {
        get(target, prop) {
          if (prop === "updateTable") {
            return (table: string) => {
              if (table === "mailbox_sent_sync") {
                throw Object.assign(new Error(`write failed ${CANARY}`), { code: "23514", detail: CANARY });
              }
              return (target.updateTable as (name: string) => unknown)(table);
            };
          }
          const value: unknown = Reflect.get(target, prop, target);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      const job = createMailSyncJob({
        db: broken,
        secrets,
        openProvider: o.openProvider,
        isOwnActionId: async () => false,
        sentOriginOf: async () => null,
        now: () => NOW,
      });

      const capture = captureConsole();
      try {
        await job.run();
      } finally {
        capture.restore();
      }

      expect(await emailCount(trx, box.mailboxId)).toBe(1);
      expect((await mailboxRow(trx, box.mailboxId)).last_synced_at).toEqual(NOW);
      expect(capture.lines.filter((line) => line.includes("sent_sync_failed"))).toHaveLength(1);
      expect(capture.lines.filter((line) => line.includes("sent_sync_mark_failed"))).toHaveLength(1);
      expect(capture.lines.join("\n")).not.toContain(CANARY);
    });
  });

  // This test commits its data: a row lock only blocks a second connection.
  test("6: no IMAP call of the Sent pass runs inside a lock of the state row", async () => {
    const created = await db.transaction().execute(async (trx) => {
      const box = await addBox(trx);
      await enableSent(trx, box);
      return box;
    });
    try {
      const o = openers();
      const real = createFakeMailProvider({ uidValidity: 7 });
      real.deliver("INBOX", seed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
      real.deliver("Sent", sentSeed(1), { internalDate: new Date(NOW.getTime() - HOUR_MS) });
      // Before each call on the Sent folder, a second connection asks for the state row lock. A held lock times out.
      const probes: boolean[] = [];
      const probe = async (): Promise<void> => {
        try {
          await db.transaction().execute(async (other) => {
            await sql`set local lock_timeout = '400ms'`.execute(other);
            await lockSentSyncState(other, { orgId: created.orgId }, created.mailboxId);
          });
          probes.push(true);
        } catch {
          probes.push(false);
        }
      };
      const sentOnly = async (folder: string): Promise<void> => {
        if (folder === "Sent") await probe();
      };
      const probing: FakeMailProvider = {
        ...real,
        folderStatus: async (folder) => {
          await sentOnly(folder);
          return real.folderStatus(folder);
        },
        fetchAbove: async (folder, uid) => {
          await sentOnly(folder);
          return real.fetchAbove(folder, uid);
        },
        searchSinceIn: async (folder, since) => {
          await sentOnly(folder);
          return real.searchSinceIn(folder, since);
        },
        fetchContent: async (folder, uid) => {
          await sentOnly(folder);
          return real.fetchContent(folder, uid);
        },
        fetchByUidsIn: async (folder, uids) => {
          await sentOnly(folder);
          return real.fetchByUidsIn(folder, uids);
        },
      };
      o.fakes.set(created.address, probing);
      const job = createMailSyncJob({
        db,
        secrets,
        openProvider: o.openProvider,
        isOwnActionId: async () => false,
        sentOriginOf: async () => null,
        now: () => NOW,
      });

      const capture = captureConsole();
      try {
        await job.run();
      } finally {
        capture.restore();
      }

      const rows = await db
        .selectFrom("sent_emails")
        .select("content")
        .where("mailbox_id", "=", created.mailboxId)
        .execute();
      expect(rows).toEqual([{ content: "stored" }]);
      // folderStatus, the since search, and the text fetch.
      expect(probes.length).toBeGreaterThanOrEqual(3);
      expect(probes.every(Boolean)).toBe(true);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
    }
  });
});

// Every line of the sync job is an event with ids, codes and counts. A server reply, an address or a subject never reaches a line.
