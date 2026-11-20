import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { HOUR_MS } from "@ea/core";
import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { setSentSync } from "../../src/modules/mail";
import {
  deleteSentEmails,
  getSentSyncState,
  insertSentEmails,
  lockSentSyncState,
  type NewSentEmail,
} from "../../src/modules/mail/repo";
import { syncSentHeaders } from "../../src/modules/mail/sent-sync";
import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";

import { insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { ago, depsOf, newOrg, NOW, put, rowsOf, siblingMailbox, stateOf, type Org } from "./mail-sent-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

beforeEach(() => {
  configureFeatures({ off: [] });
});

const AT = new Date("2026-11-20T10:00:00Z");
const ACTOR = "user-1";

function on(trx: Transaction<DB>, org: Org, at = AT) {
  return setSentSync(trx, org.ctx, org.mailboxId, { enabled: true, actor: ACTOR, at });
}
function off(trx: Transaction<DB>, org: Org, at = AT) {
  return setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: ACTOR, at });
}

async function auditRows(trx: Transaction<DB> | typeof db, orgId: string) {
  return trx
    .selectFrom("audit_log")
    .select(["actor", "data", "created_at"])
    .where("org_id", "=", orgId)
    .where("event", "=", "mailbox.sent_sync_changed")
    .orderBy("id")
    .execute();
}

// The mailbox has no state row yet: an older mailbox from before the Sent read.
function oldMailbox(trx: Transaction<DB>, opts: { flag?: boolean } = {}) {
  return newOrg(trx, { switchOn: false, flag: opts.flag });
}

describe("setSentSync", () => {
  test("1: no state row, on: changed, enabled_at is AT, one audit row with the actor", async () => {
    await withRollback(db, async (trx) => {
      const org = await oldMailbox(trx);
      expect(await on(trx, org)).toEqual({ result: "changed", deleted: 0 });
      const state = await stateOf(trx, org);
      expect(state).toMatchObject({ enabled: true, path: null, lastUid: null, firstPassAt: null });
      expect(state.enabledAt?.getTime()).toBe(AT.getTime());
      const rows = await auditRows(trx, org.ctx.orgId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actor: ACTOR, data: { mailbox_id: org.mailboxId, enabled: true, count: 0 } });
      expect(rows[0]?.created_at.getTime()).toBe(AT.getTime());
    });
  });

  test("2: the same value again: same, no second audit row, no new first pass", async () => {
    await withRollback(db, async (trx) => {
      const org = await oldMailbox(trx);
      await on(trx, org);
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      const before = await stateOf(trx, org);
      expect(await on(trx, org, new Date(AT.getTime() + HOUR_MS))).toEqual({ result: "same", deleted: 0 });
      expect(await stateOf(trx, org)).toEqual(before);
      expect(await auditRows(trx, org.ctx.orgId)).toHaveLength(1);

      // Off over a mailbox that has no row: the row appears as off, and nothing else changes.
      const none = await oldMailbox(trx);
      expect(await off(trx, none)).toEqual({ result: "same", deleted: 0 });
      expect(await auditRows(trx, none.ctx.orgId)).toEqual([]);
    });
  });

  test("3: off deletes the sent rows of this mailbox only, resets the state and audits the count", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const sibling = await newOrg(trx);
      for (const target of [org, sibling]) {
        put(target, 1, ago(3 * HOUR_MS));
        put(target, 2, ago(2 * HOUR_MS));
        put(target, 3, ago(HOUR_MS));
        expect((await syncSentHeaders(depsOf(trx, target), target.ctx, target.mailboxId)).stored).toBe(3);
      }
      // Received mail of the same mailbox, and a second mailbox of the same organization.
      const receivedId = await insertTestEmail(trx, org.ctx, org.mailboxId, { subject: "received" });
      expect((await stateOf(trx, org)).lastUid).toBe(3);

      expect(await off(trx, org)).toEqual({ result: "changed", deleted: 3 });
      expect(await rowsOf(trx, org)).toEqual([]);
      expect(await stateOf(trx, org)).toMatchObject({
        enabled: false,
        enabledAt: null,
        path: null,
        uidValidity: null,
        lastUid: null,
        firstPassAt: null,
        lastPassAt: null,
        lastErrorCode: null,
      });
      const [row] = await auditRows(trx, org.ctx.orgId);
      expect(row).toMatchObject({ actor: ACTOR, data: { mailbox_id: org.mailboxId, enabled: false, count: 3 } });

      // Nothing else went: the received mail, and the other organization's sent rows and state.
      const received = await trx.selectFrom("emails").select("id").where("id", "=", receivedId).execute();
      expect(received).toHaveLength(1);
      expect(await rowsOf(trx, sibling)).toHaveLength(3);
      expect((await stateOf(trx, sibling)).enabled).toBe(true);
    });
  });

  test("3b: a second mailbox of the same organization keeps its rows and state", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(HOUR_MS));
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      const second = await siblingMailbox(trx, org);
      put(second, 2, ago(HOUR_MS));
      await syncSentHeaders(depsOf(trx, second), second.ctx, second.mailboxId);

      expect(await off(trx, org)).toEqual({ result: "changed", deleted: 1 });
      expect(await rowsOf(trx, second)).toHaveLength(1);
      expect((await stateOf(trx, second)).enabled).toBe(true);
    });
  });

  test("4: off then on later: enabled_at moves, the cursor is empty, the next pass is initial", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(2 * HOUR_MS));
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      await off(trx, org);
      const later = new Date(AT.getTime() + HOUR_MS);
      expect(await on(trx, org, later)).toEqual({ result: "changed", deleted: 0 });
      const state = await stateOf(trx, org);
      expect(state).toMatchObject({ enabled: true, uidValidity: null, lastUid: null, path: null });
      expect(state.enabledAt?.getTime()).toBe(later.getTime());

      const result = await syncSentHeaders(depsOf(trx, org, { now: () => later }), org.ctx, org.mailboxId);
      expect(result).toMatchObject({ status: "done", mode: "initial", stored: 1 });
    });
  });

  test("5: flag off: on gives flag_off and writes nothing; off still works and deletes", async () => {
    await withRollback(db, async (trx) => {
      const none = await oldMailbox(trx, { flag: false });
      expect(await on(trx, none)).toEqual({ result: "flag_off", deleted: 0 });
      expect(await getSentSyncState(trx, none.ctx, none.mailboxId)).toBeUndefined();
      expect(await auditRows(trx, none.ctx.orgId)).toEqual([]);

      const org = await newOrg(trx);
      put(org, 1, ago(2 * HOUR_MS));
      put(org, 2, ago(HOUR_MS));
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      await upsertOrgFeature(trx, org.ctx, { flag: "sent_sync", enabled: false, setBy: "test", setAt: NOW });
      expect(await off(trx, org)).toEqual({ result: "changed", deleted: 2 });
      expect(await rowsOf(trx, org)).toEqual([]);
      expect((await stateOf(trx, org)).enabled).toBe(false);
      expect(await auditRows(trx, org.ctx.orgId)).toHaveLength(1);
    });
  });

  test("5b: a flag that FEATURES_OFF kills gives flag_off for on and leaves off working", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(HOUR_MS));
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      configureFeatures({ off: ["sent_sync"] });
      const none = await oldMailbox(trx);
      expect(await on(trx, none)).toEqual({ result: "flag_off", deleted: 0 });
      expect(await off(trx, org)).toEqual({ result: "changed", deleted: 1 });
    });
  });

  test("6: an unknown id, and the mailbox of org A in the context of org B: not_found, org A unchanged", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      put(a, 1, ago(HOUR_MS));
      await syncSentHeaders(depsOf(trx, a), a.ctx, a.mailboxId);
      const stateBefore = await stateOf(trx, a);
      const unknown = randomUUID();
      for (const enabled of [true, false]) {
        expect(await setSentSync(trx, a.ctx, unknown, { enabled, actor: ACTOR, at: AT })).toEqual({
          result: "not_found",
          deleted: 0,
        });
        expect(await setSentSync(trx, b.ctx, a.mailboxId, { enabled, actor: ACTOR, at: AT })).toEqual({
          result: "not_found",
          deleted: 0,
        });
      }
      // The delete itself filters by organization: the context of org B removes no row of org A.
      expect(await deleteSentEmails(trx, b.ctx, a.mailboxId)).toBe(0);
      expect(await stateOf(trx, a)).toEqual(stateBefore);
      expect(await rowsOf(trx, a)).toHaveLength(1);
      expect(await auditRows(trx, a.ctx.orgId)).toEqual([]);
      expect(await auditRows(trx, b.ctx.orgId)).toEqual([]);
      expect(await getSentSyncState(trx, b.ctx, a.mailboxId)).toBeUndefined();
    });
  });

  test("6b: org B turning off its own mailbox leaves the sent rows of org A", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      for (const org of [a, b]) {
        put(org, 1, ago(HOUR_MS));
        await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      }
      expect(await off(trx, b)).toEqual({ result: "changed", deleted: 1 });
      expect(await rowsOf(trx, a)).toHaveLength(1);
      expect((await stateOf(trx, a)).enabled).toBe(true);
      expect(await auditRows(trx, a.ctx.orgId)).toEqual([]);
    });
  });

  test("7: a pass whose origin hook turns the switch off returns cursor_moved and stores nothing", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(HOUR_MS), { headers: { "X-EA-Action-Id": randomUUID() } });
      const hook = async () => {
        await off(trx, org);
        return null;
      };
      const result = await syncSentHeaders(depsOf(trx, org, { sentOriginOf: hook }), org.ctx, org.mailboxId);
      expect(result.status).toBe("cursor_moved");
      expect(await rowsOf(trx, org)).toEqual([]);
      expect((await stateOf(trx, org)).enabled).toBe(false);
    });
  });

  test("8: no console line and no audit field holds mail data: canary subject, body and address", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const canary = `canary-${randomUUID()}`;
      put(org, 1, ago(HOUR_MS), { subject: canary, text: canary, to: [`${canary}@x.test`] });
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      await trx
        .updateTable("sent_emails")
        .set({ content: "stored", body_text: canary })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();

      const lines: string[] = [];
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
        spyOn(console, method).mockImplementation((...args: unknown[]) => {
          lines.push(format(...args));
        })
      );
      try {
        expect(await off(trx, org)).toEqual({ result: "changed", deleted: 1 });
        await on(trx, org);
        await off(trx, org);
        await setSentSync(trx, org.ctx, randomUUID(), { enabled: true, actor: ACTOR, at: AT });
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
      expect(lines).toEqual([]);
      expect(JSON.stringify(await auditRows(trx, org.ctx.orgId))).not.toContain("canary");
    });
  });
});

// These tests commit their data and use more than one connection: a row lock only waits between two connections.
describe("setSentSync with two connections", () => {
  async function committed() {
    const created = await db.transaction().execute(async (trx) => {
      const org = await newOrg(trx);
      for (const n of [1, 2]) put(org, n, ago(n * HOUR_MS));
      await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId);
      return { orgId: org.ctx.orgId, userId: org.userId, mailboxId: org.mailboxId };
    });
    return { ...created, ctx: { orgId: created.orgId } as TenantContext };
  }

  async function cleanup(org: { orgId: string; userId: string }) {
    await db.deleteFrom("organizations").where("id", "=", org.orgId).execute();
    await db.deleteFrom("users").where("id", "=", org.userId).execute();
  }

  async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
    return Promise.race([
      promise.then(
        () => true,
        () => true
      ),
      new Promise<boolean>((done) => setTimeout(() => done(false), ms)),
    ]);
  }

  test("off waits for the state row lock of another transaction, then deletes also what that transaction wrote", async () => {
    const org = await committed();
    try {
      let release!: () => void;
      const released = new Promise<void>((done) => {
        release = done;
      });
      let locked!: () => void;
      const lockTaken = new Promise<void>((done) => {
        locked = done;
      });
      // The other transaction plays a Sent pass: it holds the lock and writes one more sent row.
      const pass = db.transaction().execute(async (trx) => {
        await lockSentSyncState(trx, org.ctx, org.mailboxId);
        const row: NewSentEmail = {
          mailboxId: org.mailboxId,
          dedupKey: `lock:${randomUUID()}`,
          path: "Sent",
          uidValidity: 1,
          uid: 99,
          messageId: null,
          parentMessageId: null,
          referencesIds: [],
          threadKey: `lock:${randomUUID()}`,
          fromAddress: "me@corp.test",
          toAddresses: ["a@x.test"],
          ccAddresses: [],
          subject: "late",
          sentAt: ago(HOUR_MS),
          internalDate: ago(HOUR_MS),
          origin: "user",
          actionId: null,
          content: "headers_only",
        };
        await insertSentEmails(trx, org.ctx, [row]);
        locked();
        await released;
      });
      await lockTaken;

      const setter = setSentSync(db, org.ctx, org.mailboxId, { enabled: false, actor: ACTOR, at: AT });
      expect(await settledWithin(setter, 400)).toBe(false);
      expect(
        await db.selectFrom("sent_emails").select("uid").where("mailbox_id", "=", org.mailboxId).execute()
      ).toHaveLength(2);
      release();
      await pass;
      expect(await setter).toEqual({ result: "changed", deleted: 3 });
      expect(
        await db.selectFrom("sent_emails").select("uid").where("mailbox_id", "=", org.mailboxId).execute()
      ).toEqual([]);
    } finally {
      await cleanup(org);
    }
  });

  test("two switches at once on a mailbox without a row: one changed, one same, one audit row", async () => {
    const org = await db.transaction().execute(async (trx) => {
      const created = await oldMailbox(trx);
      return { orgId: created.ctx.orgId, userId: created.userId, mailboxId: created.mailboxId };
    });
    const ctx: TenantContext = { orgId: org.orgId };
    try {
      const results = await Promise.all([
        setSentSync(db, ctx, org.mailboxId, { enabled: true, actor: ACTOR, at: AT }),
        setSentSync(db, ctx, org.mailboxId, { enabled: true, actor: ACTOR, at: AT }),
      ]);
      expect(results.map((entry) => entry.result).sort()).toEqual(["changed", "same"]);
      expect(await auditRows(db, org.orgId)).toHaveLength(1);
    } finally {
      await cleanup(org);
    }
  });
});
