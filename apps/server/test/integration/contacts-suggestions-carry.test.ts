import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { insertSenderRule } from "../../src/modules/config/repo";
import { refreshMailboxProfiles } from "../../src/modules/contacts";
import type { DB } from "../../src/platform/db";
import { createDb } from "../../src/platform/db";

import {
  KEY,
  mails,
  NO_TEST,
  NOW,
  openOf,
  refresh,
  rescuedMails,
  seed,
  spamMails,
  suggestOrg,
  summary,
  withSentCoverage,
  type Org,
} from "./contacts-fixtures";
import { testDb, withRollback } from "./helpers";

// Carry-over tests of the stage 05 re-review: the safety net of the suggestion INSERT skips the CHECK error only, and a block
// rule for one address does not protect its domain.
const db = testDb();
const orgIds: string[] = [];
const userIds: string[] = [];
afterEach(async () => {
  if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});
afterAll(async () => {
  await db.destroy();
});

const pass = (org: Org) =>
  refreshMailboxProfiles({ db, credentialsKey: KEY, testMail: NO_TEST }, org.ctx, org.mailboxId, { now: NOW });

// An organization with Sent coverage, committed (a trigger of the owner role works on committed rows only).
async function committedOrg(build: (trx: Transaction<DB>, org: Org) => Promise<void>): Promise<Org> {
  const { org, userId } = await db.transaction().execute(async (trx) => {
    const created = await suggestOrg(trx);
    await withSentCoverage(trx, created);
    await build(trx, created);
    const owner = await trx
      .selectFrom("memberships")
      .select("user_id")
      .where("org_id", "=", created.ctx.orgId)
      .executeTakeFirstOrThrow();
    return { org: created, userId: owner.user_id };
  });
  orgIds.push(org.ctx.orgId);
  userIds.push(userId);
  return org;
}

describe("the safety net of the suggestion INSERT", () => {
  test("TG-1 an INSERT error that is not a CHECK violation (22023) stops the pass and keeps no suggestion row", async () => {
    const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
    if (ownerUrl === undefined) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role makes the trigger");
    const owner = createDb(ownerUrl);
    const org = await committedOrg(async (trx, created) => {
      await seed(trx, created, "refused@acme.pl", rescuedMails());
      await seed(trx, created, "a@acmea.pl", mails(8, 6));
    });
    const fn = `fail_pattern_${org.mailboxId.replaceAll("-", "")}`;
    let error: unknown;
    try {
      await sql
        .raw(
          `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
             IF NEW.pattern = 'refused@acme.pl' THEN
               RAISE EXCEPTION 'broken' USING ERRCODE = '22023';
             END IF;
             RETURN NEW;
           END $f$`
        )
        .execute(owner);
      await sql
        .raw(
          `CREATE TRIGGER ${fn} BEFORE INSERT ON sender_suggestions FOR EACH ROW
           WHEN (NEW.org_id = '${org.ctx.orgId}') EXECUTE FUNCTION ${fn}()`
        )
        .execute(owner);
      error = await pass(org).then(
        () => undefined,
        (caught: unknown) => caught
      );
    } finally {
      await sql.raw(`DROP TRIGGER IF EXISTS ${fn} ON sender_suggestions`).execute(owner);
      await sql.raw(`DROP FUNCTION IF EXISTS ${fn}()`).execute(owner);
      await owner.destroy();
    }
    expect((error as { code?: string } | undefined)?.code).toBe("22023");
    // The pass is one transaction: the error undoes the profile writes and every suggestion row of the pass.
    const rows = await db
      .selectFrom("sender_suggestions")
      .select("id")
      .where("mailbox_id", "=", org.mailboxId)
      .execute();
    const profiles = await db
      .selectFrom("sender_profiles")
      .select("id")
      .where("mailbox_id", "=", org.mailboxId)
      .execute();
    expect(rows).toEqual([]);
    expect(profiles).toEqual([]);
  });
});

describe("a block rule for one address does not protect its domain", () => {
  test("TG-2 a block rule for x@acme.pl leaves the domain blocklist row for two other spammers of acme.pl", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "x@acme.pl", kind: "blocklist" });
      for (const address of ["a@acme.pl", "b@acme.pl"]) await seed(trx, org, address, spamMails());
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual(["open:blocklist:domain:@acme.pl"]);
    });
  });
});
