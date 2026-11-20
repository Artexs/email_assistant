import { createHash, randomUUID } from "node:crypto";

import { DAY_MS, HOUR_MS } from "@ea/core";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { MailFolderMissingError } from "../../src/modules/mail";
import { getSentSyncState, setFolderMapEntry, updateSentCursor, writeSentSwitch } from "../../src/modules/mail/repo";
import { renderSeedMessage } from "../../src/modules/mail/seed";
import { syncSentHeaders, type SentSyncDeps } from "../../src/modules/mail/sent-sync";
import { baseDedupKey, contentHash, normalizeMessageId } from "../../src/modules/mail/sync-rules";
import { configureFeatures } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";

import { insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { ago, depsOf, mail, newOrg, NOW, put, rowOf, rowsOf, stateOf, type Org } from "./mail-sent-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

beforeEach(() => {
  configureFeatures({ off: [] });
});

describe("syncSentHeaders", () => {
  test("1: flag off gives flag_off, no provider call, no row, no pass time", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { flag: false });
      put(org, 1, ago(DAY_MS));
      const result = await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(result).toEqual({ status: "flag_off", mode: null, fetched: 0, stored: 0, system: 0, tooOld: 0 });
      expect(org.provider.calls).toEqual([]);
      expect(await rowsOf(trx, org)).toEqual([]);
      expect((await stateOf(trx, org)).lastPassAt).toBeNull();
    });
  });

  test("2: no state row, or a switch that is off, gives off and no provider call", async () => {
    await withRollback(db, async (trx) => {
      const none = await newOrg(trx, { switchOn: false });
      put(none, 1, ago(DAY_MS));
      expect((await syncSentHeaders(depsOf(trx, none), none.ctx, none.mailboxId)).status).toBe("off");
      expect(none.provider.calls).toEqual([]);
      expect(await getSentSyncState(trx, none.ctx, none.mailboxId)).toBeUndefined();

      const off = await newOrg(trx);
      await writeSentSwitch(trx, off.ctx, off.mailboxId, { enabled: false });
      put(off, 1, ago(DAY_MS));
      expect((await syncSentHeaders(depsOf(trx, off), off.ctx, off.mailboxId)).status).toBe("off");
      expect(off.provider.calls).toEqual([]);
      expect(await rowsOf(trx, off)).toEqual([]);
    });
  });

  test("3: no sent key gives no_folder; a folder that appears later starts a first pass", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { sentPath: null });
      put(org, 1, ago(DAY_MS));
      const first = await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(first.status).toBe("no_folder");
      expect(org.provider.calls).toEqual([]);
      const state = await stateOf(trx, org);
      expect(state.lastErrorCode).toBe("no_folder");
      expect(state.lastPassAt?.getTime()).toBe(NOW.getTime());

      await setFolderMapEntry(trx, org.ctx, org.mailboxId, "sent", "Sent");
      const second = await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(second).toMatchObject({ status: "done", mode: "initial", stored: 1 });
      expect((await stateOf(trx, org)).lastErrorCode).toBeNull();
    });
  });

  // A: user mail 1 d old. B: 20 d. C: 40 d. D: a draft whose send is applied. G: a draft whose send waits.
  async function firstPass(trx: Transaction<DB>) {
    const org = await newOrg(trx);
    const approved = { userId: org.userId, at: ago(2 * DAY_MS) };
    const applied = await insertDraftAndSend(trx, org.ctx, org.mailboxId, { sendStatus: "applied", approved });
    const waiting = await insertDraftAndSend(trx, org.ctx, org.mailboxId, { sendStatus: "awaiting_approval" });
    put(org, 1, ago(DAY_MS));
    put(org, 2, ago(20 * DAY_MS));
    put(org, 3, ago(40 * DAY_MS));
    put(org, 4, ago(2 * DAY_MS), { headers: { "X-EA-Action-Id": applied.draftId } });
    put(org, 5, ago(3 * DAY_MS), { headers: { "X-EA-Action-Id": waiting.draftId } });
    // The last mail is outside the header window: the cursor still ends at the last UID of the folder.
    put(org, 6, ago(40 * DAY_MS));
    const result = await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
    return { org, result, waiting };
  }

  test("4: the first pass stores 30 days, links system sends and keeps own drafts as user mail", async () => {
    await withRollback(db, async (trx) => {
      const { org, result, waiting } = await firstPass(trx);
      expect(result).toEqual({ status: "done", mode: "initial", fetched: 4, stored: 4, system: 1, tooOld: 0 });
      const a = await rowOf(trx, org, "Subject 1");
      expect([a.origin, a.content, a.action_id]).toEqual(["user", "pending", null]);
      const b = await rowOf(trx, org, "Subject 2");
      expect([b.origin, b.content]).toEqual(["user", "headers_only"]);
      const d = await rowOf(trx, org, "Subject 4");
      expect([d.origin, d.content]).toEqual(["system", "headers_only"]);
      const g = await rowOf(trx, org, "Subject 5");
      expect([g.origin, g.content, g.action_id]).toEqual(["user", "pending", waiting.draftId]);
      expect((await rowsOf(trx, org)).some((row) => row.subject === "Subject 3")).toBe(false);
      const state = await stateOf(trx, org);
      const { uidNext } = await org.provider.folderStatus("Sent");
      expect(state).toMatchObject({ path: "Sent", uidValidity: 1, lastUid: uidNext - 1, lastErrorCode: null });
      expect(state.lastUid).toBe(6);
      expect(state.firstPassAt?.getTime()).toBe(NOW.getTime());
      expect(state.lastPassAt?.getTime()).toBe(NOW.getTime());
    });
  });

  test("5: parent, thread root, lower case addresses and the Date header are stored", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(2 * HOUR_MS), {
        date: ago(3 * HOUR_MS),
        inReplyTo: "<in-1@x.test>",
        references: ["<root@x.test>", "<in-1@x.test>"],
        to: ["Anna@X.test"],
        cc: ["b@x.test", "B@x.test"],
      });
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      const row = await rowOf(trx, org, "Subject 1");
      expect(row.parent_message_id).toBe("<in-1@x.test>");
      expect(row.thread_key).toBe("<root@x.test>");
      expect(row.to_addresses).toEqual(["anna@x.test"]);
      expect(row.cc_addresses).toEqual(["b@x.test"]);
      expect(row.sent_at.getTime()).toBe(ago(3 * HOUR_MS).getTime());
      expect(row.internal_date.getTime()).toBe(ago(2 * HOUR_MS).getTime());
    });
  });

  test("6: later passes are incremental; a mail below the header window only moves the cursor", async () => {
    await withRollback(db, async (trx) => {
      const { org } = await firstPass(trx);
      const e = put(org, 6, ago(HOUR_MS));
      const second = await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(second).toEqual({ status: "done", mode: "incremental", fetched: 1, stored: 1, system: 0, tooOld: 0 });
      expect((await stateOf(trx, org)).lastUid).toBe(e);

      const third = await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(third).toMatchObject({ mode: "incremental", fetched: 0, stored: 0 });
      expect((await stateOf(trx, org)).lastUid).toBe(e);

      const f = put(org, 7, ago(40 * DAY_MS));
      const fourth = await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(fourth).toMatchObject({ status: "done", mode: "incremental", fetched: 1, stored: 0, tooOld: 1 });
      expect((await stateOf(trx, org)).lastUid).toBe(f);
      expect(await rowsOf(trx, org)).toHaveLength(5);
    });
  });

  test("7: a new UIDVALIDITY rescans, moves the rows and keeps the first pass time", async () => {
    await withRollback(db, async (trx) => {
      const { org } = await firstPass(trx);
      org.provider.remove("Sent", 3);
      org.provider.resetUidValidity(900, "Sent");
      const later = new Date(NOW.getTime() + HOUR_MS);
      const result = await syncSentHeaders(depsOf(trx, org, { now: () => later }), org.ctx, org.mailboxId);
      expect(result).toMatchObject({ status: "done", mode: "rescan", stored: 0 });
      const rows = await rowsOf(trx, org);
      expect(rows).toHaveLength(4);
      expect(rows.map((row) => [row.uidvalidity, row.uid])).toEqual([
        ["900", "1"],
        ["900", "2"],
        ["900", "3"],
        ["900", "4"],
      ]);
      const state = await stateOf(trx, org);
      expect(state).toMatchObject({ uidValidity: 900, lastUid: 5 });
      expect(state.firstPassAt?.getTime()).toBe(NOW.getTime());
      expect(state.lastPassAt?.getTime()).toBe(later.getTime());
    });
  });

  test("8: the same mail twice gives one row, also with chunk size 1", async () => {
    for (const chunkSize of [undefined, 1]) {
      await withRollback(db, async (trx) => {
        const org = await newOrg(trx);
        put(org, 1, ago(DAY_MS));
        put(org, 1, ago(DAY_MS));
        const result = await syncSentHeaders(depsOf(trx, org, { chunkSize }), org.ctx, org.mailboxId);
        expect(result).toMatchObject({ status: "done", fetched: 2, stored: 1 });
        const rows = await rowsOf(trx, org);
        expect(rows.map((row) => row.uid)).toEqual(["1"]);
      });
    }
  });

  test("9: the pass only reads: four methods on Sent and no flag changes", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await org.provider.ensureFolder("Sent");
      const append = async (n: number, flags: string[]) =>
        (
          await org.provider.appendMessage(
            "Sent",
            Buffer.from(renderSeedMessage(mail(n, ago(HOUR_MS)))),
            flags,
            ago(HOUR_MS)
          )
        ).uid;
      const seen = await append(1, ["\\Seen"]);
      const unseen = await append(2, []);
      const flagsOf = async () =>
        (await org.provider.fetchFlagsIn("Sent", [seen as number, unseen as number])).map((m) => m.flags);
      const before = await flagsOf();

      const calls = org.provider.folderCalls.length;
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      const third = await append(3, ["\\Seen"]);
      const incremental = await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(incremental).toMatchObject({ mode: "incremental", stored: 1 });
      expect(third).toBeGreaterThan(2);

      const methods = org.provider.folderCalls
        .slice(calls)
        .filter((call) => call.folder === "Sent" && call.method !== "appendMessage")
        .map((call) => call.method);
      expect(new Set(methods)).toEqual(new Set(["folderStatus", "searchSinceIn", "fetchByUidsIn", "fetchAbove"]));
      expect(await flagsOf()).toEqual(before);
      expect(before).toEqual([["\\Seen"], []]);
    });
  });

  test("10: a new path starts a first pass there; the old rows keep their path", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(DAY_MS));
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      put(org, 2, ago(2 * DAY_MS), {}, "Wysłane");
      put(org, 3, ago(3 * DAY_MS), {}, "Wysłane");
      await setFolderMapEntry(trx, org.ctx, org.mailboxId, "sent", "Wysłane");
      const later = new Date(NOW.getTime() + DAY_MS);
      const result = await syncSentHeaders(depsOf(trx, org, { now: () => later }), org.ctx, org.mailboxId);
      expect(result).toMatchObject({ status: "done", mode: "initial", stored: 2 });
      const rows = await rowsOf(trx, org);
      expect(rows.map((row) => [row.subject, row.path])).toEqual([
        ["Subject 1", "Sent"],
        ["Subject 2", "Wysłane"],
        ["Subject 3", "Wysłane"],
      ]);
      const state = await stateOf(trx, org);
      expect(state.path).toBe("Wysłane");
      expect(state.firstPassAt?.getTime()).toBe(later.getTime());
    });
  });

  test("11: a folder that is gone, at the status call or later, gives folder_missing", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { sentPath: "Gone" });
      const result = await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(result.status).toBe("folder_missing");
      expect((await stateOf(trx, org)).lastErrorCode).toBe("folder_missing");
      expect(await rowsOf(trx, org)).toEqual([]);

      const later = await newOrg(trx);
      put(later, 1, ago(DAY_MS));
      later.provider.failOn("searchSinceIn", new MailFolderMissingError());
      expect((await syncSentHeaders(depsOf(trx, later), later.ctx, later.mailboxId)).status).toBe("folder_missing");
      expect((await stateOf(trx, later)).lastErrorCode).toBe("folder_missing");
      expect(await rowsOf(trx, later)).toEqual([]);
    });
  });

  test("12: a switch that goes off, or off and on, during the pass writes nothing", async () => {
    for (const again of [false, true]) {
      await withRollback(db, async (trx) => {
        const org = await newOrg(trx);
        put(org, 1, ago(DAY_MS), { headers: { "X-EA-Action-Id": randomUUID() } });
        let hooked = 0;
        const hook: SentSyncDeps["sentOriginOf"] = async (ctx, mailboxId) => {
          hooked += 1;
          await writeSentSwitch(trx, ctx, mailboxId, { enabled: false });
          if (again) await writeSentSwitch(trx, ctx, mailboxId, { enabled: true, at: new Date(NOW.getTime() + 1000) });
          return null;
        };
        const result = await syncSentHeaders(depsOf(trx, org, { sentOriginOf: hook }), org.ctx, org.mailboxId);
        expect(hooked).toBe(1);
        expect(result).toMatchObject({ status: "cursor_moved", stored: 0 });
        expect(await rowsOf(trx, org)).toEqual([]);
        const state = await stateOf(trx, org);
        expect(state).toMatchObject({
          enabled: again,
          path: null,
          uidValidity: null,
          lastUid: null,
          firstPassAt: null,
        });
        if (!again) expect(state.lastPassAt).toBeNull();
      });
    }
  });

  const restoreState = (trx: Transaction<DB>, org: Org) =>
    sql`update mailbox_sent_sync set path = 'Sent', uidvalidity = 1, last_uid = 0 where mailbox_id = ${org.mailboxId}::uuid`.execute(
      trx
    );

  test("12b: a cursor, numbering or path that another run changes during the pass stops the write", async () => {
    const moves: Record<string, (trx: Transaction<DB>, org: Org) => Promise<unknown>> = {
      lastUid: (trx, org) => updateSentCursor(trx, org.ctx, org.mailboxId, { uidValidity: 1, lastUid: 99 }),
      uidValidity: (trx, org) => updateSentCursor(trx, org.ctx, org.mailboxId, { uidValidity: 77, lastUid: 0 }),
      // The switch ends and starts again, and the state returns to the place that the pass read: only `enabled_at` differs.
      enabledAt: async (trx, org) => {
        await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: false });
        await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: true, at: new Date(NOW.getTime() + 1000) });
        await restoreState(trx, org);
      },
      path: (trx, org) =>
        sql`update mailbox_sent_sync set path = 'Other' where mailbox_id = ${org.mailboxId}::uuid`.execute(trx),
    };
    for (const [field, move] of Object.entries(moves)) {
      await withRollback(db, async (trx) => {
        const org = await newOrg(trx);
        await org.provider.ensureFolder("Sent");
        await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
        put(org, 1, ago(HOUR_MS), { headers: { "X-EA-Action-Id": randomUUID() } });
        const hook: SentSyncDeps["sentOriginOf"] = async () => {
          await move(trx, org);
          return null;
        };
        const result = await syncSentHeaders(depsOf(trx, org, { sentOriginOf: hook }), org.ctx, org.mailboxId);
        expect({ field, status: result.status, stored: result.stored }).toEqual({
          field,
          status: "cursor_moved",
          stored: 0,
        });
        expect(await rowsOf(trx, org)).toEqual([]);
      });
    }
  });

  test("13: an error in chunk 2 keeps chunk 1 and its cursor; the next call goes on", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await org.provider.ensureFolder("Sent");
      expect((await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId)).mode).toBe("initial");
      for (let n = 1; n <= 5; n += 1) {
        put(org, n, ago((6 - n) * HOUR_MS), n === 3 ? { headers: { "X-EA-Action-Id": randomUUID() } } : {});
      }
      const failing: SentSyncDeps["sentOriginOf"] = async () => {
        throw new SoftError("origin lookup failed");
      };
      await expect(
        syncSentHeaders(depsOf(trx, org, { sentOriginOf: failing, chunkSize: 2 }), org.ctx, org.mailboxId)
      ).rejects.toBeInstanceOf(SoftError);
      expect((await rowsOf(trx, org)).map((row) => row.uid)).toEqual(["1", "2"]);
      expect((await stateOf(trx, org)).lastUid).toBe(2);

      const next = await syncSentHeaders(depsOf(trx, org, { chunkSize: 2 }), org.ctx, org.mailboxId);
      expect(next).toMatchObject({ status: "done", mode: "incremental", stored: 3 });
      expect((await rowsOf(trx, org)).map((row) => row.uid)).toEqual(["1", "2", "3", "4", "5"]);
      expect((await stateOf(trx, org)).lastUid).toBe(5);
    });
  });

  test("14: a pass writes only rows of its organization; another organization's mailbox is off", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      put(a, 1, ago(DAY_MS));
      put(b, 2, ago(DAY_MS));
      put(b, 3, ago(2 * DAY_MS));
      expect((await syncSentHeaders(depsOf(trx, b), b.ctx, b.mailboxId)).stored).toBe(2);
      expect(await rowsOf(trx, a)).toEqual([]);
      expect((await rowsOf(trx, b)).map((row) => row.org_id)).toEqual([b.ctx.orgId, b.ctx.orgId]);

      const calls = a.provider.calls.length;
      const cross = await syncSentHeaders(depsOf(trx, a), b.ctx, a.mailboxId);
      expect(cross.status).toBe("off");
      expect(a.provider.calls.length).toBe(calls);
      expect(await rowsOf(trx, a)).toEqual([]);
      expect((await syncSentHeaders(depsOf(trx, a), a.ctx, a.mailboxId)).stored).toBe(1);
    });
  });

  test("15: a header that is no uuid, or an action of another mailbox, gives a user row without a link", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const foreign = await insertDraftAndSend(trx, b.ctx, b.mailboxId, {
        sendStatus: "applied",
        approved: { userId: b.userId, at: ago(DAY_MS) },
      });
      put(a, 1, ago(DAY_MS), { headers: { "X-EA-Action-Id": "not-a-uuid" } });
      put(a, 2, ago(DAY_MS), { headers: { "X-EA-Action-Id": foreign.draftId } });
      await syncSentHeaders(depsOf(trx, a), a.ctx, a.mailboxId);
      const rows = await rowsOf(trx, a);
      expect(rows.map((row) => [row.origin, row.action_id, row.content])).toEqual([
        ["user", null, "pending"],
        ["user", null, "pending"],
      ]);
    });
  });

  test("16: the text window is the retention of the organization when that is shorter", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await sql`update organizations set data_retention_days = 3 where id = ${org.ctx.orgId}::uuid`.execute(trx);
      put(org, 1, ago(5 * DAY_MS));
      put(org, 2, ago(2 * DAY_MS));
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      expect((await rowOf(trx, org, "Subject 1")).content).toBe("headers_only");
      expect((await rowOf(trx, org, "Subject 2")).content).toBe("pending");
    });
  });

  test("17: a tombstoned mail gives no row and no error; the cursor passes it", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await org.provider.ensureFolder("Sent");
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      const erased = put(org, 1, ago(HOUR_MS));
      const kept = put(org, 2, ago(2 * HOUR_MS));
      const [meta] = await org.provider.fetchByUidsIn("Sent", [erased]);
      const key = baseDedupKey(normalizeMessageId(meta?.messageId), contentHash(meta as NonNullable<typeof meta>));
      const hash = createHash("sha256").update(key).digest("hex");
      await sql`insert into dsr_tombstones (org_id, key_hash) values (${org.ctx.orgId}::uuid, ${hash})`.execute(trx);

      const result = await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(result).toMatchObject({ status: "done", mode: "incremental", fetched: 2, stored: 1 });
      expect((await rowsOf(trx, org)).map((row) => row.subject)).toEqual(["Subject 2"]);
      expect((await stateOf(trx, org)).lastUid).toBe(Math.max(erased, kept));
    });
  });

  test("sent-sync.ts takes the reader type and no mail provider", async () => {
    const source = await Bun.file(new URL("../../src/modules/mail/sent-sync.ts", import.meta.url)).text();
    expect(source.includes("MailProvider")).toBe(false);
    expect(source.includes("SentFolderReader")).toBe(true);
  });
});
