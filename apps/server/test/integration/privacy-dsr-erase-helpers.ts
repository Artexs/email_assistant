import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { eraseSubjectData, type DsrEraseResult } from "../../src/modules/privacy";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { type Db } from "../../src/platform/db";
import { waitFor } from "../wait-for";

import { insertAction, insertDelegate, insertDelegation, insertTestEmail, testCapabilities } from "./fixtures";

export const KEY = Buffer.alloc(32, 7).toString("base64");

export interface World {
  orgId: string;
  orgName: string;
  person: string;
  own: string;
  ownerEmail: string;
  boxId: string;
  goes: string[]; // ids of the mails that go
  goesKeys: string[]; // their dedup keys
  k1: string; // kept mail that names the person everywhere
  k2: string; // kept mail that does not name the person
  g1Action: string; // an action of a mail that goes
  chain: string[]; // C1 (kept mail k1, depends on g1Action), C2 (k2, depends on C1), C3 (k2, reverses C2)
  keptAction: string; // an unrelated action of k2
  delegation: string; // a delegation of k2 whose send action is C2
  delegateId: string;
  ruleId: string;
}

export const unique = () => `p-${randomUUID().slice(0, 8)}@x.test`;

export function makeDsrKit(db: Db) {
  const orgIds: string[] = [];
  const userIds: string[] = [];

  async function cleanup() {
    if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
    if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
    orgIds.length = 0;
    userIds.length = 0;
  }

  // Org with the mailboxes `own` and `own2` and the member `owner`. Mails that go: `g1` (from the person) with a triage
  // result, an applied action, an outbox row, headers and an audit row; `g2` (own to own2 and the person). Kept mails: `k1`
  // names the person in every kind of column, `k2` does not. A chain over three levels (see `World`), one delegation that
  // the chain removes, one delegate and one sender rule of the person.
  async function seedOrg(person: string): Promise<World> {
    const suffix = randomUUID().slice(0, 8);
    const at = (name: string) => `${name}-${suffix}@x.test`;
    const world = await db.transaction().execute(async (trx): Promise<World> => {
      const orgName = `Org ${suffix}`;
      const { orgId, userId } = await createOrganizationWithOwner(trx, {
        orgName,
        timezone: "Europe/Warsaw",
        email: at("owner"),
        displayName: "Owner",
        locale: "en",
      });
      userIds.push(userId);
      const ctx = { orgId };
      const boxes: string[] = [];
      for (const address of [at("own"), at("own2")]) {
        const id = randomUUID();
        boxes.push(id);
        await insertMailbox(trx, ctx, {
          id,
          address,
          imapHost: "imap.x.test",
          imapPort: 993,
          smtpHost: "smtp.x.test",
          smtpPort: 465,
          capabilities: testCapabilities,
          folderMap: {},
        });
        await insertInboxFolder(trx, ctx, id);
      }
      const box = boxes[0] as string;
      const goesKeys = [`mid:<g1-${suffix}@x.test>:h1`, `mid:<g2-${suffix}@x.test>:h1`];
      const g1 = await insertTestEmail(trx, ctx, box, {
        dedup_key: goesKeys[0],
        from_address: person,
        to_addresses: [at("own")],
        subject: "hello",
        body_text: "body of the first mail",
      });
      const g2 = await insertTestEmail(trx, ctx, box, {
        dedup_key: goesKeys[1],
        from_address: at("own"),
        to_addresses: [at("own2"), person],
      });
      const k1 = await insertTestEmail(trx, ctx, box, {
        from_address: at("r"),
        to_addresses: [person, at("q")],
        cc_addresses: [person.toUpperCase()],
        subject: `re ${person}`,
        body_text: `write ${person}.`,
      });
      const k2 = await insertTestEmail(trx, ctx, box, { from_address: at("s"), to_addresses: [at("own")] });

      await trx
        .insertInto("triage_results")
        .values({
          org_id: orgId,
          email_id: g1,
          category: "info",
          confidence: 0.9,
          reason_code: "test",
          fields: JSON.stringify({}),
        })
        .execute();
      await trx
        .insertInto("triage_results")
        .values({
          org_id: orgId,
          email_id: k1,
          category: "info",
          confidence: 0.9,
          reason_code: "test",
          reason: `asked ${person}`,
          fields: JSON.stringify({ to: [person], note: `Regards\n${person}` }),
        })
        .execute();
      await trx
        .insertInto("email_headers")
        .values({
          email_id: k1,
          org_id: orgId,
          from_name: person,
          reply_to: [at("q"), person],
          return_path: person,
          auth_results: `spf=pass smtp.mailfrom=${person}`,
          attachments: JSON.stringify([{ filename: `forward from ${person} (copy).eml`, size: 12 }]),
          parts_known: true,
          captured_at: new Date(),
        })
        .execute();
      await trx
        .insertInto("email_headers")
        .values({ email_id: g1, org_id: orgId, from_name: person, parts_known: true, captured_at: new Date() })
        .execute();
      await recordAudit(trx, ctx, { emailId: g1, actor: "system", event: "test.mail_note", data: { note: "n" } });

      const g1Action = await insertAction(trx, ctx, g1, { type: "move", status: "applied" });
      const c1 = await insertAction(trx, ctx, k1, { type: "move", status: "ready", dependsOnActionId: g1Action });
      const c2 = await insertAction(trx, ctx, k2, { type: "move", status: "ready", dependsOnActionId: c1 });
      const c3 = await insertAction(trx, ctx, k2, { type: "move", status: "undone", reversesActionId: c2 });
      const keptAction = await insertAction(trx, ctx, k2, { type: "create_draft", status: "applied" });
      await insertAction(trx, ctx, k1, {
        type: "send",
        status: "applied",
        approvedAt: new Date(),
        payload: { to: [person], body: `Hi\n${person}\nbye` },
        lastError: `rejected ${person}`,
        providerResult: { rcpt: [person] },
      });
      const delegateId = await insertDelegate(trx, ctx, { email: person, name: "Pat" });
      const other = await insertDelegate(trx, ctx, { email: at("d2") });
      const delegation = await insertDelegation(trx, ctx, {
        mailboxId: box,
        emailId: k2,
        delegateId: other,
        draftActionId: keptAction,
        sendActionId: c2,
        taskSummary: "Prepare the offer",
      });
      const rule = await trx
        .insertInto("sender_rules")
        .values({ org_id: orgId, pattern: person, kind: "blocklist" })
        .returning("id")
        .executeTakeFirstOrThrow();
      const member = await trx
        .selectFrom("memberships")
        .select("user_id")
        .where("org_id", "=", orgId)
        .executeTakeFirstOrThrow();
      const outbox = (email: string, key: string, text: string, view: object) =>
        trx
          .insertInto("outbox")
          .values({
            org_id: orgId,
            user_id: member.user_id,
            kind: "urgent",
            dedup_key: key,
            email_id: email,
            text,
            view: JSON.stringify(view),
            status: "sent",
            created_at: new Date(),
            next_attempt_at: new Date(),
            sent_at: new Date(),
          })
          .execute();
      await outbox(g1, `urgent:g1:${suffix}`, `Mail from ${person}`, { from: person });
      await outbox(k1, `urgent:k1:${suffix}`, `Mail from ${person} to us`, { from: person, n: 1 });
      return {
        orgId,
        orgName,
        person,
        own: at("own"),
        ownerEmail: at("owner"),
        boxId: box,
        goes: [g1, g2],
        goesKeys,
        k1,
        k2,
        g1Action,
        chain: [c1, c2, c3],
        keptAction,
        delegation,
        delegateId,
        ruleId: rule.id,
      };
    });
    orgIds.push(world.orgId);
    return world;
  }

  // One md5 per table of every table with an `org_id` column: a change to any row of the organization shows.
  async function snapshot(orgId: string): Promise<Record<string, string>> {
    const tables = await sql<{ table_name: string }>`
      select c.table_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'org_id' and t.table_type = 'BASE TABLE'
      order by 1`.execute(db);
    const out: Record<string, string> = {};
    for (const { table_name } of tables.rows) {
      const rows = await sql<{ h: string }>`
        select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text), '')) as h
        from ${sql.table(table_name)} as t where org_id = ${orgId}::uuid`.execute(db);
      out[table_name] = rows.rows[0]?.h ?? "";
    }
    return out;
  }

  async function count(table: string, orgId: string): Promise<number> {
    const rows = await sql<{ n: string }>`
      select count(*)::text as n from ${sql.table(table)} where org_id = ${orgId}::uuid`.execute(db);
    return Number(rows.rows[0]?.n);
  }

  async function erase(w: World, extra: Partial<Parameters<typeof eraseSubjectData>[1]> = {}): Promise<DsrEraseResult> {
    return eraseSubjectData(db, {
      orgId: w.orgId,
      address: w.person,
      confirm: w.person,
      credentialsKey: KEY,
      ...extra,
    });
  }

  async function erased(w: World, extra: Partial<Parameters<typeof eraseSubjectData>[1]> = {}) {
    const result = await erase(w, extra);
    if (result.kind !== "erased") throw new Error(`erase answered ${result.kind}`);
    return result;
  }

  async function eraseAudit(orgId: string) {
    return db
      .selectFrom("audit_log")
      .select(["actor", "data"])
      .where("org_id", "=", orgId)
      .where("event", "=", auditEvents.dsrErase)
      .execute();
  }

  // Polls until a backend waits on a lock while its query text holds `fragment`, or `done()` is true.
  async function waitBlocked(fragment: string, done: () => boolean): Promise<void> {
    let waiting = false;
    await waitFor(() => {
      void db
        .selectFrom(sql<{ n: string }>`pg_stat_activity`.as("a"))
        .select(sql<boolean>`true`.as("x"))
        .where(
          sql<boolean>`a.wait_event_type = 'Lock' and a.query like ${`%${fragment}%`} and a.pid <> pg_backend_pid()`
        )
        .execute()
        .then((rows) => {
          waiting = rows.length > 0;
        });
      return waiting || done();
    }, `the erase waits on a lock (${fragment}) or finishes`);
  }

  return { orgIds, userIds, cleanup, seedOrg, snapshot, count, erase, erased, eraseAudit, waitBlocked };
}
