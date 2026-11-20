import { randomUUID } from "node:crypto";

import { HOUR_MS } from "@ea/core";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { getSentSyncState, lockSentSyncState, setFolderMapEntry, writeSentSwitch } from "../../src/modules/mail/repo";
import { syncSentHeaders, type SentSyncDeps } from "../../src/modules/mail/sent-sync";
import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";
import type { TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";

// These tests commit their data and use more than one connection: a row lock only waits between two connections.
// Each test removes its organization and its user in `finally`.

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

beforeEach(() => {
  configureFeatures({ off: [] });
});

const NOW = new Date("2026-11-20T10:00:00Z");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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

// A committed organization with the flag on, the switch on at NOW - 1 h, folder_map.sent = "Sent" and an empty "Sent" folder.
async function setup() {
  const created = await db.transaction().execute(async (trx) => {
    const org = await createOrgWithMailbox(trx);
    const ctx: TenantContext = { orgId: org.orgId };
    await upsertOrgFeature(trx, ctx, { flag: "sent_sync", enabled: true, setBy: "test", setAt: NOW });
    await writeSentSwitch(trx, ctx, org.mailboxId, { enabled: true, at: new Date(NOW.getTime() - HOUR_MS) });
    await setFolderMapEntry(trx, ctx, org.mailboxId, "sent", "Sent");
    return org;
  });
  const provider = createFakeMailProvider();
  await provider.ensureFolder("Sent");
  return { ...created, ctx: { orgId: created.orgId } as TenantContext, provider };
}

async function cleanup(org: { orgId: string; userId: string }) {
  await db.deleteFrom("organizations").where("id", "=", org.orgId).execute();
  await db.deleteFrom("users").where("id", "=", org.userId).execute();
}

async function sentRows(mailboxId: string) {
  return db.selectFrom("sent_emails").select("uid").where("mailbox_id", "=", mailboxId).execute();
}

describe("syncSentHeaders with two connections", () => {
  for (const restart of [true, false]) {
    test(`a state row that another transaction holds ${restart ? "and restarts the switch" : "and leaves as it is"} blocks the write`, async () => {
      const org = await setup();
      try {
        const deps = (sentOriginOf: SentSyncDeps["sentOriginOf"] = async () => null): SentSyncDeps => ({
          db,
          provider: org.provider,
          sentOriginOf,
          now: () => NOW,
        });
        expect((await syncSentHeaders(deps(), org.ctx, org.mailboxId)).mode).toBe("initial");
        org.provider.deliver(
          "Sent",
          {
            messageId: `<lock-${randomUUID()}@x.test>`,
            from: "me@corp.test",
            to: ["a@x.test"],
            subject: "Subject",
            date: NOW,
            text: "Body",
            headers: { "X-EA-Action-Id": randomUUID() },
          },
          { internalDate: new Date(NOW.getTime() - HOUR_MS) }
        );

        // The hook runs while the pass plans its chunk. It starts a second transaction that locks the state row,
        // changes it (or not) and keeps the lock until the test releases it.
        const locked = deferred();
        const release = deferred();
        let other: Promise<void> | undefined;
        const hook: SentSyncDeps["sentOriginOf"] = async () => {
          other = db.transaction().execute(async (trx) => {
            await lockSentSyncState(trx, org.ctx, org.mailboxId);
            if (restart) {
              await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: false });
              await writeSentSwitch(trx, org.ctx, org.mailboxId, {
                enabled: true,
                at: new Date(NOW.getTime() + 1000),
              });
            }
            locked.resolve();
            await release.promise;
          });
          await locked.promise;
          return null;
        };
        const pass = syncSentHeaders(deps(hook), org.ctx, org.mailboxId);
        expect(await settledWithin(pass, 400)).toBe(false);
        release.resolve();
        await other;
        const result = await pass;

        const state = await getSentSyncState(db, org.ctx, org.mailboxId);
        if (restart) {
          expect(result).toMatchObject({ status: "cursor_moved", stored: 0 });
          expect(await sentRows(org.mailboxId)).toEqual([]);
          expect(state).toMatchObject({ enabled: true, path: null, uidValidity: null, lastUid: null });
        } else {
          expect(result).toMatchObject({ status: "done", stored: 1 });
          expect(await sentRows(org.mailboxId)).toHaveLength(1);
          expect(state?.lastUid).toBe(1);
        }
      } finally {
        await cleanup(org);
      }
    });
  }

  test("a path that another run sets between the reset and the second read stops the pass", async () => {
    const org = await setup();
    try {
      org.provider.deliver(
        "Sent",
        {
          messageId: `<path-${randomUUID()}@x.test>`,
          from: "me@corp.test",
          to: ["a@x.test"],
          subject: "Subject",
          date: NOW,
          text: "Body",
        },
        { internalDate: new Date(NOW.getTime() - HOUR_MS) }
      );
      // The first write transaction of the pass is the reset of the path. Another run then sets another path.
      let writes = 0;
      const racing = new Proxy(db, {
        get(target, property) {
          // Kysely classes keep private fields: read and bind on the real object, not on the proxy.
          if (property !== "transaction") {
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          }
          return () => ({
            execute: async <T>(run: Parameters<ReturnType<typeof target.transaction>["execute"]>[0]) => {
              const value = (await target.transaction().execute(run)) as T;
              writes += 1;
              if (writes === 1) {
                await sql`update mailbox_sent_sync set path = 'Other' where mailbox_id = ${org.mailboxId}::uuid`.execute(
                  target
                );
              }
              return value;
            },
          });
        },
      });
      const result = await syncSentHeaders(
        { db: racing, provider: org.provider, sentOriginOf: async () => null, now: () => NOW },
        org.ctx,
        org.mailboxId
      );
      expect(result).toMatchObject({ status: "cursor_moved", stored: 0 });
      expect(await sentRows(org.mailboxId)).toEqual([]);
      expect(await getSentSyncState(db, org.ctx, org.mailboxId)).toMatchObject({
        path: "Other",
        uidValidity: null,
        lastUid: null,
      });
    } finally {
      await cleanup(org);
    }
  });
});
