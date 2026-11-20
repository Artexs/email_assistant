import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { DAY_MS, HOUR_MS } from "@ea/core";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { MailFolderMissingError, type SentFolderReader } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { expireSentTexts, setFolderMapEntry, writeSentSwitch } from "../../src/modules/mail/repo";
import { SENT_TEXT_WINDOW_MS } from "../../src/modules/mail/sent-rules";
import {
  syncSentFolder,
  syncSentHeaders,
  type SentPassStatus,
  type SentSyncDeps,
} from "../../src/modules/mail/sent-sync";
import { fetchSentTexts, SENT_BODY_TEXT_LIMIT } from "../../src/modules/mail/sent-texts";
import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";

import { insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { ago, depsOf, newOrg, NOW, put, rowOf, rowsOf, siblingMailbox, stateOf, type Org } from "./mail-sent-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

beforeEach(() => {
  configureFeatures({ off: [] });
});

const WINDOW = SENT_TEXT_WINDOW_MS;
const FIVE = ["folderStatus", "fetchAbove", "fetchContent", "searchSinceIn", "fetchByUidsIn"];

function textCalls(org: Org, from = 0): number {
  return org.provider.calls.slice(from).filter((method) => method === "fetchContent").length;
}

// The path and numbering that the header step left in the state row.
async function inputOf(trx: Transaction<DB>, org: Org, extra: { limit?: number } = {}) {
  const state = await stateOf(trx, org);
  return { path: state.path as string, uidValidity: state.uidValidity as number, textWindowMs: WINDOW, ...extra };
}

describe("fetchSentTexts and syncSentFolder", () => {
  test("1: the first pass stores the text of the text window only; old and system mail stay headers_only", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const applied = await insertDraftAndSend(trx, org.ctx, org.mailboxId, {
        sendStatus: "applied",
        approved: { userId: org.userId, at: ago(2 * DAY_MS) },
      });
      put(org, 1, ago(DAY_MS), { text: "Offer by Friday", headers: { "Auto-Submitted": "no" } });
      put(org, 2, ago(20 * DAY_MS));
      put(org, 4, ago(2 * DAY_MS), { headers: { "X-EA-Action-Id": applied.draftId } });

      const result = await syncSentFolder(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(result).toMatchObject({ status: "done", mode: "initial", stored: 3, system: 1 });
      expect(result.texts).toEqual({ stored: 1, gone: 0, expired: 0 });

      const a = await rowOf(trx, org, "Subject 1");
      expect(a.content).toBe("stored");
      expect(a.body_text).toBe("Offer by Friday");
      expect(a.auto_submitted).toBe("no");
      expect(a.has_calendar).toBe(false);
      for (const subject of ["Subject 2", "Subject 4"]) {
        const row = await rowOf(trx, org, subject);
        expect([row.content, row.body_text, row.auto_submitted]).toEqual(["headers_only", null, null]);
      }
      expect(textCalls(org)).toBe(1);
    });
  });

  test("2: the capture markers list_id and precedence are stored", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(DAY_MS), { headers: { "List-Id": "<team.x.test>", Precedence: "bulk" } });
      const result = await syncSentFolder(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(result.texts.stored).toBe(1);
      const row = await rowOf(trx, org, "Subject 1");
      expect(row.list_id).toBe("<team.x.test>");
      expect(row.precedence).toBe("bulk");
      expect(row.auto_submitted).toBeNull();
    });
  });

  test("3: a mail over the size limit is stored without text and with its markers", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      org.provider = createFakeMailProvider({ bodyLimitBytes: 1000 });
      org.provider.deliver(
        "Sent",
        {
          messageId: "<big@x.test>",
          from: "me@corp.test",
          to: ["to@x.test"],
          subject: "Big",
          date: ago(DAY_MS),
          text: "x".repeat(5000),
          headers: { "Auto-Submitted": "auto-generated" },
        },
        { internalDate: ago(DAY_MS), size: 5000 }
      );
      const result = await syncSentFolder(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(result.texts).toEqual({ stored: 1, gone: 0, expired: 0 });
      const row = await rowOf(trx, org, "Big");
      expect([row.content, row.body_text, row.auto_submitted]).toEqual(["stored", null, "auto-generated"]);
    });
  });

  test("4: the limit takes the oldest pending rows first; the next call takes the rest", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(3 * DAY_MS));
      put(org, 2, ago(2 * DAY_MS));
      put(org, 3, ago(DAY_MS));
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      const input = await inputOf(trx, org, { limit: 2 });

      expect(await fetchSentTexts(depsOf(trx, org), org.ctx, org.mailboxId, input)).toEqual({
        stored: 2,
        gone: 0,
        expired: 0,
      });
      expect((await rowsOf(trx, org)).map((row) => row.content)).toEqual(["stored", "stored", "pending"]);
      expect(await fetchSentTexts(depsOf(trx, org), org.ctx, org.mailboxId, input)).toEqual({
        stored: 1,
        gone: 0,
        expired: 0,
      });
      expect((await rowsOf(trx, org)).map((row) => row.content)).toEqual(["stored", "stored", "stored"]);
    });
  });

  test("5: a pending row whose mail is gone from the folder becomes gone", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const first = put(org, 1, ago(2 * DAY_MS));
      put(org, 2, ago(DAY_MS));
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      org.provider.remove("Sent", first);
      const result = await fetchSentTexts(depsOf(trx, org), org.ctx, org.mailboxId, await inputOf(trx, org));
      expect(result).toEqual({ stored: 1, gone: 1, expired: 0 });
      const gone = await rowOf(trx, org, "Subject 1");
      expect([gone.content, gone.body_text]).toEqual(["gone", null]);
      expect((await rowOf(trx, org, "Subject 2")).content).toBe("stored");
    });
  });

  test("6: a row that waited past the text window turns headers_only without a fetch", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(13 * DAY_MS));
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      expect((await rowOf(trx, org, "Subject 1")).content).toBe("pending");

      const later = new Date(NOW.getTime() + 2 * DAY_MS);
      const calls = org.provider.calls.length;
      const result = await fetchSentTexts(
        depsOf(trx, org, { now: () => later }),
        org.ctx,
        org.mailboxId,
        await inputOf(trx, org)
      );
      expect(result).toEqual({ stored: 0, gone: 0, expired: 1 });
      const row = await rowOf(trx, org, "Subject 1");
      expect([row.content, row.body_text]).toEqual(["headers_only", null]);
      expect(textCalls(org, calls)).toBe(0);
    });
  });

  test("7: a text over the limit is cut to 100000 characters", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(DAY_MS), { text: "y".repeat(150_000) });
      await syncSentFolder(depsOf(trx, org), org.ctx, org.mailboxId);
      const row = await rowOf(trx, org, "Subject 1");
      expect(row.body_text).toHaveLength(SENT_BODY_TEXT_LIMIT);
      expect(SENT_BODY_TEXT_LIMIT).toBe(100_000);
    });
  });

  test("8: an error of fetchContent ends the call and goes up; earlier rows stay stored; the next call finishes", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(3 * DAY_MS));
      put(org, 2, ago(2 * DAY_MS));
      put(org, 3, ago(DAY_MS));
      const plain: SentFolderReader = org.provider;
      let count = 0;
      const failing: SentFolderReader = {
        folderStatus: (path) => plain.folderStatus(path),
        fetchAbove: (path, uid) => plain.fetchAbove(path, uid),
        searchSinceIn: (path, since) => plain.searchSinceIn(path, since),
        fetchByUidsIn: (path, uids) => plain.fetchByUidsIn(path, uids),
        fetchContent: async (path, uid) => {
          count += 1;
          if (count === 2) throw new SoftError("timeout");
          return plain.fetchContent(path, uid);
        },
      };
      await expect(syncSentFolder(depsOf(trx, org, { provider: failing }), org.ctx, org.mailboxId)).rejects.toThrow(
        SoftError
      );
      expect(count).toBe(2);
      expect((await rowsOf(trx, org)).map((row) => row.content)).toEqual(["stored", "pending", "pending"]);

      const next = await syncSentFolder(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(next).toMatchObject({ status: "done", mode: "incremental", stored: 0 });
      expect(next.texts).toEqual({ stored: 2, gone: 0, expired: 0 });
      expect((await rowsOf(trx, org)).map((row) => row.content)).toEqual(["stored", "stored", "stored"]);
    });
  });

  test("9: a header status other than done makes no fetchContent call and gives zero texts", async () => {
    const cases: {
      status: SentPassStatus;
      stop: (trx: Transaction<DB>, org: Org) => Promise<Partial<SentSyncDeps>>;
    }[] = [
      {
        status: "flag_off",
        stop: async (trx, org) => {
          await upsertOrgFeature(trx, org.ctx, { flag: "sent_sync", enabled: false, setBy: "test", setAt: NOW });
          return {};
        },
      },
      {
        status: "off",
        stop: async (trx, org) => {
          await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: false });
          return {};
        },
      },
      {
        status: "no_folder",
        stop: async (trx, org) => {
          await setFolderMapEntry(trx, org.ctx, org.mailboxId, "sent", "");
          return {};
        },
      },
      {
        status: "folder_missing",
        stop: async (_trx, org) => {
          org.provider.failOn("folderStatus", new MailFolderMissingError());
          return {};
        },
      },
      {
        status: "cursor_moved",
        stop: async (trx, org) => {
          put(org, 9, ago(HOUR_MS), { headers: { "X-EA-Action-Id": randomUUID() } });
          return {
            sentOriginOf: async (ctx, mailboxId) => {
              await writeSentSwitch(trx, ctx, mailboxId, { enabled: false });
              return null;
            },
          };
        },
      },
    ];
    for (const { status, stop } of cases) {
      await withRollback(db, async (trx) => {
        const org = await newOrg(trx);
        put(org, 1, ago(DAY_MS));
        await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
        expect((await rowOf(trx, org, "Subject 1")).content).toBe("pending");

        const extra = await stop(trx, org);
        const calls = org.provider.calls.length;
        const result = await syncSentFolder(depsOf(trx, org, extra), org.ctx, org.mailboxId);
        expect({ status, got: result.status, texts: result.texts }).toEqual({
          status,
          got: status,
          texts: { stored: 0, gone: 0, expired: 0 },
        });
        expect({ status, fetches: textCalls(org, calls) }).toEqual({ status, fetches: 0 });
        expect({ status, content: (await rowOf(trx, org, "Subject 1")).content }).toEqual({
          status,
          content: "pending",
        });
      });
    }
  });

  test("10: the folder Sent gets only the five read calls", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(2 * DAY_MS));
      const calls = org.provider.folderCalls.length;
      await syncSentFolder(depsOf(trx, org), org.ctx, org.mailboxId);
      put(org, 2, ago(DAY_MS));
      await syncSentFolder(depsOf(trx, org), org.ctx, org.mailboxId);
      const methods = new Set(
        org.provider.folderCalls
          .slice(calls)
          .filter((call) => call.folder === "Sent")
          .map((call) => call.method)
      );
      expect(methods.has("fetchContent")).toBe(true);
      expect([...methods].filter((method) => !FIVE.includes(method))).toEqual([]);
    });
  });

  test("11: after a path change only the texts of the new folder are read; old pending rows expire", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      // Two pending rows of "Sent", read by the header step only.
      put(org, 1, ago(3 * DAY_MS), { text: "old one" });
      put(org, 2, ago(2 * DAY_MS), { text: "old two" });
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      // "Wysłane" holds two other mails with the same UIDs.
      put(org, 3, ago(3 * DAY_MS), { text: "new three" }, "Wysłane");
      put(org, 4, ago(2 * DAY_MS), { text: "new four" }, "Wysłane");
      await setFolderMapEntry(trx, org.ctx, org.mailboxId, "sent", "Wysłane");

      const calls = org.provider.calls.length;
      const result = await syncSentFolder(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(result.texts).toEqual({ stored: 2, gone: 0, expired: 0 });
      // Only the two mails of the new folder are fetched (the old rows are not asked for).
      expect(textCalls(org, calls)).toBe(2);
      // Both folders use the UIDs 1 and 2: order by subject.
      const bySubject = async () =>
        (await rowsOf(trx, org)).sort((a, b) => (a.subject ?? "").localeCompare(b.subject ?? ""));
      expect((await bySubject()).map((row) => [row.subject, row.path, row.content, row.body_text])).toEqual([
        ["Subject 1", "Sent", "pending", null],
        ["Subject 2", "Sent", "pending", null],
        ["Subject 3", "Wysłane", "stored", "new three"],
        ["Subject 4", "Wysłane", "stored", "new four"],
      ]);

      const later = new Date(NOW.getTime() + 15 * DAY_MS);
      const expired = await syncSentFolder(depsOf(trx, org, { now: () => later }), org.ctx, org.mailboxId);
      expect(expired.texts.expired).toBe(2);
      expect((await bySubject()).map((row) => row.content)).toEqual([
        "headers_only",
        "headers_only",
        "stored",
        "stored",
      ]);
    });
  });

  test("12: a short retention expires a pending row that is older than the retention", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(5 * DAY_MS));
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      expect((await rowOf(trx, org, "Subject 1")).content).toBe("pending");
      await trx.updateTable("organizations").set({ data_retention_days: 3 }).where("id", "=", org.ctx.orgId).execute();

      const calls = org.provider.calls.length;
      const result = await syncSentFolder(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(result.texts).toEqual({ stored: 0, gone: 0, expired: 1 });
      expect((await rowOf(trx, org, "Subject 1")).content).toBe("headers_only");
      expect(textCalls(org, calls)).toBe(0);
    });
  });

  test("13: another organization's pending rows are not read or changed", async () => {
    await withRollback(db, async (trx) => {
      const mine = await newOrg(trx);
      const other = await newOrg(trx);
      put(mine, 1, ago(DAY_MS));
      put(other, 1, ago(DAY_MS));
      await syncSentHeaders(depsOf(trx, mine), mine.ctx, mine.mailboxId);
      await syncSentHeaders(depsOf(trx, other), other.ctx, other.mailboxId);

      // The mailbox id of the other organization with this organization's context: no row matches.
      const crossed = await fetchSentTexts(depsOf(trx, mine), mine.ctx, other.mailboxId, await inputOf(trx, other));
      expect(crossed).toEqual({ stored: 0, gone: 0, expired: 0 });
      expect((await rowOf(trx, other, "Subject 1")).content).toBe("pending");
      expect(textCalls(mine)).toBe(0);

      const result = await fetchSentTexts(depsOf(trx, mine), mine.ctx, mine.mailboxId, await inputOf(trx, mine));
      expect(result.stored).toBe(1);
      expect((await rowOf(trx, other, "Subject 1")).content).toBe("pending");
    });
  });

  test("15: the oldest pending row goes first, also when the UID order differs from the date order", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      // The highest UID holds the oldest mail; the lowest UID holds the newest.
      put(org, 1, ago(DAY_MS));
      put(org, 2, ago(2 * DAY_MS));
      put(org, 3, ago(3 * DAY_MS));
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      // The partial index on pending rows returns the date order by itself; a table scan returns the order of the inserts (the UID order).
      // Without the ORDER BY of the query, this transaction would read the UID order.
      await sql`SET LOCAL enable_indexscan = off`.execute(trx);
      await sql`SET LOCAL enable_bitmapscan = off`.execute(trx);
      await sql`SET LOCAL enable_indexonlyscan = off`.execute(trx);
      const input = await inputOf(trx, org, { limit: 2 });
      expect(await fetchSentTexts(depsOf(trx, org), org.ctx, org.mailboxId, input)).toMatchObject({ stored: 2 });
      const byUid = (await rowsOf(trx, org)).map((row) => [row.subject, row.content]);
      expect(byUid).toEqual([
        ["Subject 1", "pending"],
        ["Subject 2", "stored"],
        ["Subject 3", "stored"],
      ]);
    });
  });

  test("16: the expiry of one mailbox changes only its own rows and counts them", async () => {
    await withRollback(db, async (trx) => {
      const first = await newOrg(trx);
      const second = await siblingMailbox(trx, first);
      put(first, 1, ago(13 * DAY_MS));
      put(first, 2, ago(12 * DAY_MS));
      put(second, 3, ago(13 * DAY_MS));
      await syncSentHeaders(depsOf(trx, first), first.ctx, first.mailboxId);
      await syncSentHeaders(depsOf(trx, second), second.ctx, second.mailboxId);

      const before = new Date(NOW.getTime() - DAY_MS);
      expect(
        await expireSentTexts(trx, first.ctx, first.mailboxId, { before: new Date(NOW.getTime() - 11 * DAY_MS) })
      ).toBe(2);
      expect(await expireSentTexts(trx, first.ctx, first.mailboxId, { before })).toBe(0);
      expect((await rowsOf(trx, first)).map((row) => row.content)).toEqual(["headers_only", "headers_only"]);
      expect((await rowsOf(trx, second)).map((row) => row.content)).toEqual(["pending"]);
    });
  });

  test("17: a pass that rethrows a fetchContent error writes no console line with the path, uid or subject", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const uid = put(org, 1, ago(DAY_MS));
      const plain: SentFolderReader = org.provider;
      const failing: SentFolderReader = {
        folderStatus: (path) => plain.folderStatus(path),
        fetchAbove: (path, from) => plain.fetchAbove(path, from),
        searchSinceIn: (path, since) => plain.searchSinceIn(path, since),
        fetchByUidsIn: (path, uids) => plain.fetchByUidsIn(path, uids),
        fetchContent: async () => {
          throw new SoftError("timeout");
        },
      };
      /* eslint-disable no-console -- the test replaces the console to capture it */
      const lines: string[] = [];
      const methods = ["log", "info", "warn", "error", "debug"] as const;
      const saved = methods.map((method) => console[method]);
      for (const method of methods) console[method] = (...args: unknown[]) => void lines.push(format(...args));
      const stdout = process.stdout.write.bind(process.stdout);
      const stderr = process.stderr.write.bind(process.stderr);
      process.stdout.write = ((chunk: unknown) => (lines.push(String(chunk)), true)) as typeof process.stdout.write;
      process.stderr.write = ((chunk: unknown) => (lines.push(String(chunk)), true)) as typeof process.stderr.write;
      try {
        await expect(syncSentFolder(depsOf(trx, org, { provider: failing }), org.ctx, org.mailboxId)).rejects.toThrow(
          SoftError
        );
      } finally {
        methods.forEach((method, i) => (console[method] = saved[i] as never));
        process.stdout.write = stdout;
        process.stderr.write = stderr;
      }
      /* eslint-enable no-console */
      const text = lines.join("\n");
      expect(text).not.toContain("Sent");
      expect(text).not.toContain("Subject 1");
      expect(text).not.toContain(`uid ${uid}`);
    });
  });

  // The row changes while the mail server call runs: the write finds a row that is not at the place that was read.
  const MOVES: { name: string; change: (trx: Transaction<DB>, org: Org) => Promise<unknown> }[] = [
    {
      name: "uid",
      change: (trx, org) =>
        trx.updateTable("sent_emails").set({ uid: "77" }).where("mailbox_id", "=", org.mailboxId).execute(),
    },
    {
      name: "uidvalidity",
      change: (trx, org) =>
        trx.updateTable("sent_emails").set({ uidvalidity: "9" }).where("mailbox_id", "=", org.mailboxId).execute(),
    },
    {
      name: "path",
      change: (trx, org) =>
        trx.updateTable("sent_emails").set({ path: "Other" }).where("mailbox_id", "=", org.mailboxId).execute(),
    },
    {
      name: "erased",
      change: (trx, org) => trx.deleteFrom("sent_emails").where("mailbox_id", "=", org.mailboxId).execute(),
    },
    {
      name: "already stored",
      change: (trx, org) =>
        trx
          .updateTable("sent_emails")
          .set({ content: "headers_only" })
          .where("mailbox_id", "=", org.mailboxId)
          .execute(),
    },
  ];

  for (const [move, mailGone] of MOVES.flatMap(
    (entry) =>
      [
        [entry, false],
        [entry, true],
      ] as const
  )) {
    test(`14: a row that changed (${move.name}, mail ${mailGone ? "gone" : "present"}) during the fetch gets no text and does not count`, async () => {
      await withRollback(db, async (trx) => {
        const org = await newOrg(trx);
        const uid = put(org, 1, ago(DAY_MS), { text: "Offer by Friday" });
        await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
        if (mailGone) org.provider.remove("Sent", uid);
        const plain: SentFolderReader = org.provider;
        const changing: SentFolderReader = {
          folderStatus: (path) => plain.folderStatus(path),
          fetchAbove: (path, uid) => plain.fetchAbove(path, uid),
          searchSinceIn: (path, since) => plain.searchSinceIn(path, since),
          fetchByUidsIn: (path, uids) => plain.fetchByUidsIn(path, uids),
          fetchContent: async (path, uid) => {
            const content = await plain.fetchContent(path, uid);
            await move.change(trx, org);
            return content;
          },
        };
        const result = await fetchSentTexts(
          depsOf(trx, org, { provider: changing }),
          org.ctx,
          org.mailboxId,
          await inputOf(trx, org)
        );
        expect(result).toEqual({ stored: 0, gone: 0, expired: 0 });
        const rows = await rowsOf(trx, org);
        expect(rows.every((row) => row.body_text === null)).toBe(true);
        expect(rows.length).toBe(move.name === "erased" ? 0 : 1);
      });
    });
  }
});
