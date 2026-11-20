import { DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { clearSentBodies, clearSentHeaders } from "../../src/modules/mail";
import type { TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";

// These tests commit their data and use two connections: a row lock only shows between two connections.
// Each test removes its organization and its user in `finally`.

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-12T03:00:00Z");
const OLD = new Date(NOW.getTime() - 100 * DAY_MS);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup() {
  return db.transaction().execute(async (trx) => {
    const org = await createOrgWithMailbox(trx);
    const row = await trx
      .insertInto("sent_emails")
      .values({
        org_id: org.orgId,
        mailbox_id: org.mailboxId,
        dedup_key: "dedup-locked",
        path: "Sent",
        uidvalidity: "1",
        uid: "1",
        thread_key: "thread-locked",
        from_address: "me@x.test",
        subject: "Subject",
        body_text: "Body text",
        origin: "user",
        content: "stored",
        sent_at: OLD,
        internal_date: OLD,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { ...org, ctx: { orgId: org.orgId } as TenantContext, rowId: row.id };
  });
}

async function cleanup(org: { orgId: string; userId: string }) {
  await db.deleteFrom("organizations").where("id", "=", org.orgId).execute();
  await db.deleteFrom("users").where("id", "=", org.userId).execute();
}

describe("the Sent clear functions with two connections", () => {
  const cases = [
    { name: "clearSentBodies", run: (ctx: TenantContext) => clearSentBodies(db, ctx, { before: NOW }) },
    { name: "clearSentHeaders", run: (ctx: TenantContext) => clearSentHeaders(db, ctx, { before: NOW }) },
  ];
  for (const { name, run } of cases) {
    test(`${name} skips a row that another transaction holds locked, then clears it`, async () => {
      const org = await setup();
      try {
        const locked = deferred();
        const release = deferred();
        const holder = db.transaction().execute(async (trx) => {
          await trx.selectFrom("sent_emails").select("id").where("id", "=", org.rowId).forUpdate().execute();
          locked.resolve();
          await release.promise;
        });
        await locked.promise;
        expect(await run(org.ctx)).toBe(0);
        release.resolve();
        await holder;
        expect(await run(org.ctx)).toBe(1);
      } finally {
        await cleanup(org);
      }
    });
  }
});
