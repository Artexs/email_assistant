import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { noticeKinds } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { createDb, type DB } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// F116 stage 11: the notice kind `loop_consent` (migration `20261115190001_outbox_loop_consent.sql`).
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-20T13:00:00Z");
const file = readFileSync(
  join(import.meta.dir, "../../../../db/migrations/20261115190001_outbox_loop_consent.sql"),
  "utf8"
);
const [upPart = "", downPart = ""] = file.split("-- migrate:down");
const up = upPart.replace("-- migrate:up", "");

async function expectCode(trx: Transaction<DB>, name: string, run: () => Promise<unknown>, code: string) {
  await sql`savepoint ${sql.id(name)}`.execute(trx);
  await expect(run()).rejects.toMatchObject({ code });
  await sql`rollback to savepoint ${sql.id(name)}`.execute(trx);
}

const insertRow = (trx: Transaction<DB>, orgId: string, userId: string, kind: string, mailboxId?: string) =>
  trx
    .insertInto("outbox")
    .values({
      org_id: orgId,
      user_id: userId,
      kind,
      dedup_key: `test:${randomUUID()}`,
      text: "x",
      next_attempt_at: now,
      created_at: now,
      ...(mailboxId === undefined ? {} : { mailbox_id: mailboxId }),
    })
    .execute();

describe("F116 stage 11 schema: the kind loop_consent", () => {
  test("the list has the kind; a row needs no mail, no loop and no mailbox; an unknown kind is refused", async () => {
    expect(noticeKinds).toContain("loop_consent");
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      await insertRow(trx, orgId, userId, "loop_consent");
      await expectCode(trx, "unknown", () => insertRow(trx, orgId, userId, "loop_consent2"), "23514");
    });
  });

  test("Down deletes the loop_consent rows, keeps the other kinds and refuses the kind; Up adds it again", async () => {
    const url = process.env.MIGRATOR_DATABASE_URL;
    if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the Down section");
    const owner = createDb(url);
    try {
      expect(downPart).toContain("DELETE FROM outbox WHERE kind = 'loop_consent'");
      await withRollback(owner, async (trx) => {
        const o = await createOrgWithMailbox(trx);
        await insertRow(trx, o.orgId, o.userId, "loop_consent");
        await insertRow(trx, o.orgId, o.userId, "sent_missing", o.mailboxId);
        await sql.raw(downPart).execute(trx);
        const kinds = await trx
          .selectFrom("outbox")
          .select("kind")
          .where("org_id", "=", o.orgId)
          .orderBy("kind")
          .execute();
        expect(kinds.map((row) => row.kind)).not.toContain("loop_consent");
        expect(kinds.map((row) => row.kind)).toContain("sent_missing");
        await expectCode(trx, "old_list", () => insertRow(trx, o.orgId, o.userId, "loop_consent"), "23514");
        await sql.raw(up).execute(trx);
        await insertRow(trx, o.orgId, o.userId, "loop_consent");
      });
    } finally {
      await owner.destroy();
    }
  });
});
