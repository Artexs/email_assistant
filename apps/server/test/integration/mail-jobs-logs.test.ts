import { format } from "node:util";

import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { type Transaction } from "kysely";

import { MailAuthError } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createMailSyncJob } from "../../src/modules/mail/jobs";
import type { DB } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";

import { pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { addBox, type Box, jobFor, mailboxRow, NOW, type Opened, openers, secrets, seed } from "./mail-jobs-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("mail sync job: log lines are events without server text", () => {
  const MARKER = "MARKER-ADDR@x.test";
  const MARKER_SUBJECT = "MARKER-SUBJECT canary-1b7e";

  function captureLines(): { lines: string[]; restore(): void } {
    const lines: string[] = [];
    const spies = (["log", "warn", "error"] as const).map((name) =>
      spyOn(console, name).mockImplementation((...args: unknown[]) => void lines.push(format(...args)))
    );
    return { lines, restore: () => spies.forEach((spy) => spy.mockRestore()) };
  }

  async function runWith(
    trx: Transaction<DB>,
    box: Box,
    prepare: (o: Opened) => void,
    makeJob: (o: Opened) => { run(): Promise<void> } = (o) => jobFor(trx, o)
  ): Promise<string[]> {
    const o = openers();
    prepare(o);
    const capture = captureLines();
    try {
      await makeJob(o).run();
    } finally {
      capture.restore();
    }
    // The canary check reads every captured line, also a line without the ids (a free-text line next to an event).
    expect(capture.lines.join("\n")).not.toContain("MARKER");
    const mine = `org_id=${box.orgId} mailbox_id=${box.mailboxId}`;
    return capture.lines.filter((line) => line.includes(mine));
  }

  const withMail = (box: Box) => (o: Opened) => {
    const fake = createFakeMailProvider({ uidValidity: 7 });
    fake.deliver("INBOX", { ...seed(1), subject: MARKER_SUBJECT }, { internalDate: new Date(NOW.getTime() - HOUR_MS) });
    o.fakes.set(box.address, fake);
  };

  test("a good run writes sync_done with the folder count and the four sums, and no subject", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);

      const lines = await runWith(trx, box, withMail(box));

      expect(lines).toContain(
        `[mail] sync_done org_id=${box.orgId} mailbox_id=${box.mailboxId} folder_count=1 fetched=1 stored=1 uid_updated=0 returned=0`
      );
      expect(lines.join("\n")).not.toContain("MARKER");
    });
  });

  test("a SoftError with an address in its text writes sync_soft_error with the error name only", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);

      const lines = await runWith(trx, box, (o) => {
        const fake = createFakeMailProvider({ uidValidity: 7 });
        fake.failOn("folderStatus", new SoftError(`connection lost for ${MARKER}`));
        o.fakes.set(box.address, fake);
      });

      expect(lines).toEqual([`[mail] sync_soft_error org_id=${box.orgId} mailbox_id=${box.mailboxId} error=SoftError`]);
    });
  });

  test("a failure that is not soft writes sync_failed; an address in its code is dropped, never logged", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const mine = `[mail] sync_failed org_id=${box.orgId} mailbox_id=${box.mailboxId}`;

      const plain = await runWith(trx, box, (o) => {
        o.failures.set(box.address, new Error(`NO [AUTHENTICATIONFAILED] ${MARKER}`));
      });
      expect(plain).toEqual([`${mine} error=Error`]);

      const coded = await runWith(trx, box, (o) => {
        o.failures.set(box.address, Object.assign(new Error(`NO ${MARKER}`), { code: MARKER }));
      });
      expect(coded).toEqual([`${mine} error=Error dropped_fields=1`]);

      const known = await runWith(trx, box, (o) => {
        o.failures.set(box.address, Object.assign(new Error(`NO ${MARKER}`), { code: "ECONNRESET" }));
      });
      expect(known).toEqual([`${mine} error=Error error_code=ECONNRESET`]);
    });
  });

  test("a login error writes sync_auth_error and sets the status", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);

      const lines = await runWith(trx, box, (o) => {
        o.failures.set(box.address, new MailAuthError(`login failed for ${MARKER}`));
      });

      expect(lines).toEqual([`[mail] sync_auth_error org_id=${box.orgId} mailbox_id=${box.mailboxId}`]);
      expect((await mailboxRow(trx, box.mailboxId)).status).toBe("auth_error");
    });
  });

  test("a login error whose status write fails writes sync_auth_error_save_failed without the database text", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const broken = new Proxy(trx, {
        get(target, prop) {
          if (prop === "updateTable") {
            return (table: string) => {
              if (table === "mailboxes") {
                throw Object.assign(new Error(`write failed ${MARKER}`), { code: "23514", detail: MARKER });
              }
              return (target.updateTable as (name: string) => unknown)(table);
            };
          }
          const value: unknown = Reflect.get(target, prop, target);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });

      const lines = await runWith(
        trx,
        box,
        (o) => o.failures.set(box.address, new MailAuthError(`login failed for ${MARKER}`)),
        (o) =>
          createMailSyncJob({
            db: broken,
            secrets,
            openProvider: o.openProvider,
            isOwnActionId: async () => false,
            sentOriginOf: async () => null,
            now: () => NOW,
          })
      );

      expect(lines).toEqual([
        `[mail] sync_auth_error_save_failed org_id=${box.orgId} mailbox_id=${box.mailboxId} error=Error error_code=23514`,
      ]);
    });
  });

  test("a close that rejects with an address writes imap_close_failed with the error name only", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);

      const lines = await runWith(trx, box, (o) => {
        withMail(box)(o);
        const fake = o.fakes.get(box.address) as FakeMailProvider;
        o.fakes.set(box.address, {
          ...fake,
          close: async () => {
            throw Object.assign(new Error(`close failed ${MARKER}`), { code: "EPIPE" });
          },
        });
      });

      expect(lines).toContain(
        `[mail] imap_close_failed org_id=${box.orgId} mailbox_id=${box.mailboxId} error=Error error_code=EPIPE`
      );
      expect(lines.join("\n")).not.toContain("MARKER");
    });
  });

  test("a folder that fails three runs in a row writes sync_folder_failing with the folder key and the count", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await trx
        .insertInto("mailbox_folders")
        .values({
          org_id: box.orgId,
          mailbox_id: box.mailboxId,
          key: "offers",
          path: "Oferty",
          role: "sort",
          enabled: true,
          uidvalidity: 1,
          last_uid: 0,
        })
        .execute();
      const o = openers();
      const fake = createFakeMailProvider({ uidValidity: 7 });
      await fake.ensureFolder("Oferty");
      o.fakes.set(box.address, {
        ...fake,
        fetchAbove: async (folder, lastUid) => {
          if (folder === "Oferty") throw new SoftError(`lost connection ${MARKER}`);
          return fake.fetchAbove(folder, lastUid);
        },
      });
      const job = jobFor(trx, o);
      const capture = captureLines();
      try {
        await job.run();
        await job.run();
        await job.run();
      } finally {
        capture.restore();
      }

      const mine = capture.lines.filter((line) => line.includes(box.mailboxId));
      expect(mine.filter((line) => line.includes("sync_folder_failing"))).toEqual([
        `[mail] sync_folder_failing org_id=${box.orgId} mailbox_id=${box.mailboxId} folder_key=offers failed_runs=3`,
      ]);
      expect(mine.filter((line) => line.includes("sync_folder_soft_error"))).toHaveLength(3);
      expect(capture.lines.join("\n")).not.toContain("MARKER");
    });
  });
});
