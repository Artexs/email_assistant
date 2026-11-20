// The import of the demo seed: a new org, the guards of a replace and the failing cases.
// The shared fixture of these tests is in `lab-demo-seed-helpers.ts`.
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { DEMO_TABLES, IMPORT_ORG_NAME, importDemo } from "../../src/modules/lab";
import { PLACEHOLDER_SECRET, TABLE_SPECS } from "../../src/modules/lab/demo-seed";
import { insertMailbox } from "../../src/modules/mail/repo";
import { addMember, createOrganizationWithOwner } from "../../src/modules/tenancy";

import { testCapabilities } from "./fixtures";
import {
  db,
  MARK,
  NOW,
  SEND_OFF,
  orgIds,
  removeDemoOrgs,
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
  test("4: a seed from another database makes a NEW org; every id is new, the counts match, every key points into the new org, JSON ids are mapped", async () => {
    const fx = await buildFixture();
    const third = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const sourceBefore = await idsOf(fx.orgId);
    const thirdBefore = await idsOf(third.orgId);
    const email = owner();

    const result = await importDemo(db, seed, { ownerEmail: email, replace: false, sendScope: SEND_OFF, now: NOW });
    expect(result.orgId).not.toBe(fx.orgId);
    // The outbox row that was not sent is dropped; the others keep their count.
    expect(result.rows).toEqual({ ...FIXTURE_COUNTS, outbox: 1 });
    const after = await rowCounts(result.orgId);
    for (const table of DEMO_TABLES) expect(after[table], table).toBe(result.rows[table]);
    expect(await rowCounts(result.orgId)).toMatchObject({ mailbox_credentials: 1, memberships: 1, chat_links: 0 });

    // Every id of the new org is new: none is in the file, and none is a row of the source org (the file's ids are the source's).
    const fileText = JSON.stringify(seed);
    const fileIds = new Set(fileText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g));
    const newIds = await idsOf(result.orgId);
    for (const [table, ids] of Object.entries(newIds)) {
      for (const id of ids) expect(fileIds.has(id), `${table} ${id}`).toBe(false);
    }
    // The foreign keys: each one points at a row of the same new org.
    for (const table of DEMO_TABLES) {
      const spec = TABLE_SPECS[table];
      for (const [column, parent] of [
        ...Object.entries(spec.refs),
        ...(spec.selfRefs ?? []).map((c) => [c, table] as const),
      ]) {
        const parentKey = "id";
        const broken = await sql<{ n: string }>`
          select count(*) as n from ${sql.table(table)} c
          where c.org_id = ${result.orgId}::uuid and c.${sql.ref(column)} is not null
            and not exists (select 1 from ${sql.table(parent)} p where p.${sql.ref(parentKey)} = c.${sql.ref(column)} and p.org_id = ${result.orgId}::uuid)`.execute(
          db
        );
        expect(Number(broken.rows[0]?.n), `${table}.${column}`).toBe(0);
      }
      for (const column of spec.userRefs ?? []) {
        const wrong = await sql<{ n: string }>`
          select count(*) as n from ${sql.table(table)} where org_id = ${result.orgId}::uuid and ${sql.ref(column)} is not null and ${sql.ref(column)} <> (select id from users where email = ${email})`.execute(
          db
        );
        expect(Number(wrong.rows[0]?.n), `${table}.${column}`).toBe(0);
      }
    }
    // JSON and key columns: the ids that the M7 reader and the delegation links use are the new ones.
    const mailbox = await db
      .selectFrom("mailboxes")
      .select("id")
      .where("org_id", "=", result.orgId)
      .executeTakeFirstOrThrow();
    const newDelegation = await db
      .selectFrom("delegations")
      .select(["id", "send_action_id"])
      .where("org_id", "=", result.orgId)
      .executeTakeFirstOrThrow();
    const audit = await sql<{
      id: string;
    }>`select data->>'mailbox_id' as id from audit_log where org_id = ${result.orgId}::uuid and data ? 'mailbox_id'`.execute(
      db
    );
    expect(audit.rows.map((row) => row.id)).toEqual([mailbox.id]);
    const payloads = await sql<{
      id: string;
    }>`select payload->>'delegation_id' as id from actions where org_id = ${result.orgId}::uuid`.execute(db);
    expect(payloads.rows.map((row) => row.id)).toEqual([newDelegation.id, newDelegation.id]);
    const approval = await db
      .selectFrom("outbox")
      .select("dedup_key")
      .where("org_id", "=", result.orgId)
      .executeTakeFirstOrThrow();
    expect(approval.dedup_key).toBe(`approval:${newDelegation.send_action_id}`);
    const approvedAudit = await sql<{
      a: string;
    }>`select data->>'action_id' as a, actor from audit_log where org_id = ${result.orgId}::uuid and event = 'action.approved'`.execute(
      db
    );
    expect(approvedAudit.rows[0]?.a).toBe(newDelegation.send_action_id);
    // The token counts came along.
    const tokens = await db
      .selectFrom("triage_results")
      .select(["tokens_in", "tokens_out"])
      .where("org_id", "=", result.orgId)
      .execute();
    expect(tokens.every((row) => row.tokens_in === 11 && row.tokens_out === 7)).toBe(true);

    // The source org and the third org are the same.
    expect(await idsOf(fx.orgId)).toEqual(sourceBefore);
    expect(await idsOf(third.orgId)).toEqual(thirdBefore);
  });

  test("5: the imported org never syncs or sends: the open action is expired, the mailbox is paused, no chat link, no real secret", async () => {
    const fx = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const email = owner();
    const { orgId } = await importDemo(db, seed, { ownerEmail: email, replace: false, sendScope: SEND_OFF, now: NOW });

    const org = await db
      .selectFrom("organizations")
      .select(["name", "plan", "trial_ends_at"])
      .where("id", "=", orgId)
      .executeTakeFirstOrThrow();
    expect(org).toMatchObject({ name: IMPORT_ORG_NAME, plan: "active", trial_ends_at: null });
    const actions = await db
      .selectFrom("actions")
      .select(["type", "status", "status_reason", "locked_at"])
      .where("org_id", "=", orgId)
      .orderBy("type")
      .execute();
    expect(actions.map((row) => [row.type, row.status])).toEqual([
      ["create_draft", "applied"],
      ["send", "expired"],
    ]);
    expect(actions[1]?.status_reason).toBe("demo_import");
    const mailbox = await db
      .selectFrom("mailboxes")
      .select(["status", "address", "auth_reason", "send_via"])
      .where("org_id", "=", orgId)
      .executeTakeFirstOrThrow();
    expect(mailbox).toMatchObject({ status: "paused", address: fx.address, auth_reason: null });
    const credentials = await db
      .selectFrom("mailbox_credentials")
      .select(["encrypted_secret", "secret_kind"])
      .where("org_id", "=", orgId)
      .execute();
    expect(credentials).toEqual([{ encrypted_secret: "demo-import-no-secret", secret_kind: "password" }]);
    expect(JSON.stringify(await rowCounts(orgId))).toContain('"chat_links":0');
    const links = await sql<{ n: string }>`select count(*) as n from chat_links where org_id = ${orgId}::uuid`.execute(
      db
    );
    expect(Number(links.rows[0]?.n)).toBe(0);
    const tokens = await sql<{
      n: string;
    }>`select count(*) as n from chat_link_tokens where org_id = ${orgId}::uuid`.execute(db);
    expect(Number(tokens.rows[0]?.n)).toBe(0);
    // The mail that was still pending is skipped, so no worker takes it.
    const open = await db
      .selectFrom("emails")
      .select("status")
      .where("org_id", "=", orgId)
      .where("status", "in", ["pending", "processing"])
      .execute();
    expect(open).toEqual([]);
    // One member: the owner with the email of the call, a new user.
    const members = await sql<{
      email: string;
      role: string;
    }>`select u.email, m.role from memberships m join users u on u.id = m.user_id where m.org_id = ${orgId}::uuid`.execute(
      db
    );
    expect(members.rows).toEqual([{ email, role: "owner" }]);
    // No outbox row waits to be sent.
    const waiting = await db
      .selectFrom("outbox")
      .select("status")
      .where("org_id", "=", orgId)
      .where("status", "not in", ["sent", "failed"])
      .execute();
    expect(waiting).toEqual([]);
  });

  test("5b: an existing user becomes the owner; no second user is made", async () => {
    const fx = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const before = await snapshot();
    const { orgId } = await importDemo(db, seed, {
      ownerEmail: fx.ownerEmail,
      replace: false,
      sendScope: SEND_OFF,
      now: NOW,
    });
    expect((await snapshot()).users).toBe(before.users);
    const members = await sql<{
      id: string;
    }>`select user_id as id from memberships where org_id = ${orgId}::uuid`.execute(db);
    expect(members.rows).toEqual([{ id: fx.userId }]);
    // The source org still has its owner and all rows.
    expect((await rowCounts(fx.orgId)).memberships).toBe(1);
  });

  test("6: a second import is refused; with replace it is replaced and one import org is left", async () => {
    const fx = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const email = owner();
    const first = await importDemo(db, seed, { ownerEmail: email, replace: false, sendScope: SEND_OFF, now: NOW });
    const before = await snapshot();
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email })).code).toBe("import_exists");
    expect(await snapshot()).toEqual(before);

    const second = await importDemo(db, elsewhere(seed), {
      ownerEmail: email,
      replace: true,
      sendScope: SEND_OFF,
      now: NOW,
    });
    expect(second.orgId).not.toBe(first.orgId);
    expect((await rowCounts(first.orgId)).organizations).toBe(0);
    expect(Object.values(await rowCounts(first.orgId)).every((n) => n === 0)).toBe(true);
    const named = await sql<{ id: string }>`select id from organizations where name = ${IMPORT_ORG_NAME}`.execute(db);
    expect(named.rows).toEqual([{ id: second.orgId }]);
    // One user for the owner email, not two.
    const users = await sql<{ n: string }>`select count(*) as n from users where email = ${email}`.execute(db);
    expect(Number(users.rows[0]?.n)).toBe(1);
  });

  test("6b: replace deletes only a clear earlier import: another member, another mailbox or two orgs with the name refuse, and nothing is deleted", async () => {
    const fx = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const email = owner();
    const first = await importDemo(db, seed, { ownerEmail: email, replace: false, sendScope: SEND_OFF, now: NOW });
    const before = await snapshot();

    // Another member in the org that carries the import name: it may be a real org.
    const added = await addMember(
      db,
      { orgId: first.orgId },
      {
        email: `${MARK}-real-${randomUUID()}@x.test`,
        displayName: "Real",
        role: "assistant",
        locale: "en",
        actor: "test",
        now: NOW,
      }
    );
    if (added.kind !== "added") throw new Error("the member was not added");
    const withMember = await snapshot();
    expect(withMember.users).toBe(before.users + 1);
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_refused");
    expect(await snapshot()).toEqual(withMember);
    await db.deleteFrom("memberships").where("org_id", "=", first.orgId).where("user_id", "=", added.userId).execute();

    // A mailbox that is not one of the seed.
    const extra = randomUUID();
    await insertMailbox(
      db,
      { orgId: first.orgId },
      {
        id: extra,
        address: `real-${randomUUID()}@realcompany.example`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      }
    );
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_refused");
    await db.deleteFrom("mailboxes").where("id", "=", extra).execute();
    expect(await snapshot()).toEqual(withMember);

    // Another owner email.
    expect((await importRefusal(elsewhere(seed), { ownerEmail: owner(), replace: true })).code).toBe("replace_refused");
    expect(await snapshot()).toEqual(withMember);

    // Two orgs with the name.
    const twin = await buildFixture(IMPORT_ORG_NAME);
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_ambiguous");
    expect((await rowCounts(first.orgId)).organizations).toBe(1);
    expect((await rowCounts(twin.orgId)).organizations).toBe(1);
  });

  // Only an org that looks like an import (every mailbox paused with the placeholder secret) is replaced.
  test("6c: replace refuses an org with the import name and no mailbox, a mailbox that is active, or a mailbox with a real secret", async () => {
    const fx = await buildFixture();
    const seed = elsewhere(await exportOf(fx));
    const email = owner();

    // A real org renamed to the import name: owner = the --email user, no mailbox row.
    const { orgId: bare } = await createOrganizationWithOwner(db, {
      orgName: IMPORT_ORG_NAME,
      timezone: "Europe/Warsaw",
      email,
      displayName: "Real owner",
      locale: "en",
      plan: { kind: "active" },
    });
    orgIds.push(bare);
    const before = await snapshot();
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_refused");
    expect(await snapshot()).toEqual(before);
    expect((await rowCounts(bare)).organizations).toBe(1);
    await db.deleteFrom("organizations").where("id", "=", bare).execute();

    // A real import is replaced; the same org with one changed mailbox is not.
    const first = await importDemo(db, elsewhere(seed), {
      ownerEmail: email,
      replace: false,
      sendScope: SEND_OFF,
      now: NOW,
    });
    const withFirst = await snapshot();
    await db.updateTable("mailboxes").set({ status: "active" }).where("org_id", "=", first.orgId).execute();
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_refused");
    await db.updateTable("mailboxes").set({ status: "paused" }).where("org_id", "=", first.orgId).execute();
    await db
      .updateTable("mailbox_credentials")
      .set({ encrypted_secret: "v1:real-looking-secret" })
      .where("org_id", "=", first.orgId)
      .execute();
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_refused");
    await db.deleteFrom("mailbox_credentials").where("org_id", "=", first.orgId).execute();
    expect((await importRefusal(elsewhere(seed), { ownerEmail: email, replace: true })).code).toBe("replace_refused");
    expect(await snapshot()).toEqual(withFirst);
    expect((await rowCounts(first.orgId)).organizations).toBe(1);

    // The unchanged import is replaced.
    await db
      .insertInto("mailbox_credentials")
      .values({
        mailbox_id: (
          await db.selectFrom("mailboxes").select("id").where("org_id", "=", first.orgId).executeTakeFirstOrThrow()
        ).id,
        org_id: first.orgId,
        secret_kind: "password",
        encrypted_secret: PLACEHOLDER_SECRET,
        key_version: 1,
      })
      .execute();
    const second = await importDemo(db, elsewhere(seed), {
      ownerEmail: email,
      replace: true,
      sendScope: SEND_OFF,
      now: NOW,
    });
    expect((await rowCounts(first.orgId)).organizations).toBe(0);
    expect((await rowCounts(second.orgId)).organizations).toBe(1);
  });
});
