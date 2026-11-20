// The import of the demo seed: refused and failing imports, and the source org after an import.
// The shared fixture of these tests is in `lab-demo-seed-helpers.ts`.
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import {
  DemoSeedError,
  IMPORT_ORG_NAME,
  importDemo,
  type DemoSeed,
  type DemoSeedErrorCode,
} from "../../src/modules/lab";

import {
  db,
  NOW,
  SEND_OFF,
  removeDemoOrgs,
  SECRET,
  buildFixture,
  FIXTURE_COUNTS,
  exportOf,
  rowCounts,
  idsOf,
  elsewhere,
  owner,
  snapshot,
  importRefusal,
} from "./lab-demo-seed-helpers";

afterEach(removeDemoOrgs);
afterAll(async () => {
  await db.destroy();
});

describe("importDemo (F113 stage 15)", () => {
  test("7: SEND_SCOPE=all is refused with nothing written, also with replace", async () => {
    const fx = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const before = await snapshot();
    const email = owner();
    expect((await importRefusal(seed, { ownerEmail: email, sendScope: "all" })).code).toBe(
      "import_needs_safe_send_scope"
    );
    expect((await importRefusal(seed, { ownerEmail: email, sendScope: "all", replace: true })).code).toBe(
      "import_needs_safe_send_scope"
    );
    expect(await snapshot()).toEqual(before);
    const users = await sql<{ n: string }>`select count(*) as n from users where email = ${email}`.execute(db);
    expect(Number(users.rows[0]?.n)).toBe(0);
    for (const sendScope of ["off", "self"]) {
      const ok = await importDemo(db, elsewhere(seed), { ownerEmail: email, replace: true, sendScope, now: NOW });
      expect(ok.orgId).toBeDefined();
    }
  });

  test("8: an import that fails in the middle (a bad row) leaves no new org, no new user, no row; with replace the earlier import is gone", async () => {
    const fx = await buildFixture();
    const good = elsewhere(await exportOf(fx));
    const bad = elsewhere(good);
    // The shape is fine; the database refuses the value (confidence is between 0 and 1) after the org, the mailbox and the mails are in.
    (bad.tables.triage_results[3] as Record<string, unknown>).confidence = 5;
    const before = await snapshot();
    const email = owner();
    await expect(
      importDemo(db, bad, { ownerEmail: email, replace: false, sendScope: SEND_OFF, now: NOW })
    ).rejects.not.toBeInstanceOf(DemoSeedError);
    expect(await snapshot()).toEqual(before);
    const named = await sql<{
      n: string;
    }>`select count(*) as n from organizations where name = ${IMPORT_ORG_NAME}`.execute(db);
    expect(Number(named.rows[0]?.n)).toBe(0);
    const users = await sql<{ n: string }>`select count(*) as n from users where email = ${email}`.execute(db);
    expect(Number(users.rows[0]?.n)).toBe(0);

    // With replace the delete is its own transaction: the old import is gone, the failed import leaves none.
    const first = await importDemo(db, elsewhere(good), {
      ownerEmail: email,
      replace: false,
      sendScope: SEND_OFF,
      now: NOW,
    });
    await expect(
      importDemo(db, elsewhere(bad), { ownerEmail: email, replace: true, sendScope: SEND_OFF, now: NOW })
    ).rejects.not.toBeInstanceOf(DemoSeedError);
    expect((await rowCounts(first.orgId)).organizations).toBe(0);
    const left = await sql<{
      n: string;
    }>`select count(*) as n from organizations where name = ${IMPORT_ORG_NAME}`.execute(db);
    expect(Number(left.rows[0]?.n)).toBe(0);
  });

  test("9: the source org and a third org are the same after an import: ids, counts of every org_id table", async () => {
    const fx = await buildFixture();
    const third = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const before = {
      source: await rowCounts(fx.orgId),
      third: await rowCounts(third.orgId),
      ids: [await idsOf(fx.orgId), await idsOf(third.orgId)],
    };
    const email = owner();
    const imported = await importDemo(db, seed, { ownerEmail: email, replace: false, sendScope: SEND_OFF, now: NOW });
    await importDemo(db, elsewhere(seed), { ownerEmail: email, replace: true, sendScope: SEND_OFF, now: NOW });
    expect(await rowCounts(fx.orgId)).toEqual(before.source);
    expect(await rowCounts(third.orgId)).toEqual(before.third);
    expect([await idsOf(fx.orgId), await idsOf(third.orgId)]).toEqual(before.ids);
    expect((await rowCounts(imported.orgId)).organizations).toBe(0);
  });

  test("10: refusals, each with nothing written: an org id that exists, a real host, a real address, a secret column, a table of users, a row of another org, a bad file", async () => {
    const fx = await buildFixture();
    const third = await buildFixture();
    const seed = await exportOf(fx);
    const before = await snapshot();
    const refuse = async (mutate: (copy: DemoSeed) => void, code: DemoSeedErrorCode, where?: [string, string?]) => {
      const copy = elsewhere(seed);
      mutate(copy);
      const error = await importRefusal(copy);
      expect(error.code).toBe(code);
      if (where !== undefined) expect([error.table, error.column]).toEqual(where);
      expect(await snapshot()).toEqual(before);
    };

    // The file names an org id that this database holds: refused, and the source org is untouched.
    const same = await importRefusal(seed);
    expect([same.code, same.table, same.column]).toEqual(["org_id_exists", "organizations", "id"]);
    expect(await snapshot()).toEqual(before);

    await refuse(
      (copy) => ((copy.tables.mailboxes[0] as Record<string, unknown>).imap_host = "imap.gmail.com"),
      "real_host",
      ["mailboxes", "imap_host"]
    );
    await refuse(
      (copy) => ((copy.tables.mailboxes[0] as Record<string, unknown>).smtp_host = "smtp.example.com"),
      "real_host",
      ["mailboxes", "smtp_host"]
    );
    await refuse(
      (copy) => ((copy.tables.emails[0] as Record<string, unknown>).body_text = "mail me: boss@gmail.com"),
      "non_test_address",
      ["emails", "body_text"]
    );
    // A crafted file can carry the forms too; the import scan refuses them.
    for (const body of [
      'write to "john"@gmail.com',
      "write to john@[10.0.0.1]",
      "john＠gmail.com",
      "john%40gmail.com",
    ]) {
      await refuse(
        (copy) => ((copy.tables.emails[0] as Record<string, unknown>).body_text = body),
        "non_test_address",
        ["emails", "body_text"]
      );
    }
    await refuse(
      (copy) => ((copy.tables.actions[0] as Record<string, unknown>).payload = { to: ["x@y.org"] }),
      "non_test_address",
      ["actions", "payload"]
    );
    await refuse(
      (copy) => ((copy.tables.mailboxes[0] as Record<string, unknown>).encrypted_secret = SECRET),
      "bad_seed",
      ["mailboxes", "encrypted_secret"]
    );
    await refuse(
      (copy) => ((copy.tables.emails[0] as Record<string, unknown>).from_address_lower = "a@x.test"),
      "bad_seed",
      ["emails", "from_address_lower"]
    );
    await refuse(
      (copy) => ((copy.tables as Record<string, unknown>).users = [{ id: randomUUID(), email: "a@x.test" }]),
      "bad_seed",
      ["users"]
    );
    await refuse((copy) => ((copy.tables as Record<string, unknown>).mailbox_credentials = []), "bad_seed", [
      "mailbox_credentials",
    ]);
    // A row that names another organization (the third org's id): refused, not imported into the new org.
    await refuse(
      (copy) => ((copy.tables.delegates[0] as Record<string, unknown>).org_id = third.orgId),
      "foreign_org_row",
      ["delegates", "org_id"]
    );
    await refuse((copy) => (copy.format = "ea-org-export" as never), "bad_format");
    await refuse(
      (copy) => ((copy.tables.email_headers[0] as Record<string, unknown>).email_id = randomUUID()),
      "bad_seed",
      ["email_headers", "email_id"]
    );
    await refuse((copy) => ((copy.tables.organizations[0] as Record<string, unknown>).id = "not-a-uuid"), "bad_seed", [
      "organizations",
      "id",
    ]);
    // The source org is whole.
    expect((await rowCounts(fx.orgId)).emails).toBe(5);
    expect(FIXTURE_COUNTS.emails).toBe(5);
  });

  test("10b: the unchanged file imports once the source org is gone (the file came from another database)", async () => {
    const fx = await buildFixture();
    const seed = await exportOf(fx);
    await db.deleteFrom("organizations").where("id", "=", fx.orgId).execute();
    const result = await importDemo(db, seed, { ownerEmail: owner(), replace: false, sendScope: SEND_OFF, now: NOW });
    expect(result.orgId).not.toBe(fx.orgId);
    expect(result.rows).toEqual({ ...FIXTURE_COUNTS, outbox: 1 });
  });
});
