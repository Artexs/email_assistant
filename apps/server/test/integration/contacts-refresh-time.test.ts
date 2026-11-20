import { randomUUID } from "node:crypto";

import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { refreshMailboxProfiles } from "../../src/modules/contacts";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createDb } from "../../src/platform/db";

import { KEY, NO_TEST, NOW } from "./contacts-fixtures";
import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";

// The time bound of the profile pass on a mailbox of the size that the plan names: 5,000 mails from 500 senders, 2,000 Sent mails,
// flags and feedback. The data is COMMITTED and the planner statistics are fresh (`ANALYZE` by the migrator role: the app
// role cannot analyze): inside a rolled-back transaction the planner sees no rows and a plan that proves nothing. The
// organization and its user are deleted at the end.
const BOUND_MS = 15_000;
const MAILS = 5000;
const SENDERS = 500;
const SENT = 2000;

const app = testDb();
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (ownerUrl === undefined) throw new Error("MIGRATOR_DATABASE_URL is missing: the migrator role runs ANALYZE");
const owner = createDb(ownerUrl);

let orgId: string | undefined;
let userId: string | undefined;
afterAll(async () => {
  if (orgId !== undefined) await app.deleteFrom("organizations").where("id", "=", orgId).execute();
  if (userId !== undefined) await app.deleteFrom("users").where("id", "=", userId).execute();
  await Promise.all([app.destroy(), owner.destroy()]);
});

// Set-based seed: one statement for each table.
async function seed(): Promise<{ orgId: string; mailboxId: string }> {
  const created = await app.transaction().execute(async (trx) => {
    const base = await createOrgWithMailbox(trx);
    await setOrgFeature(trx, { orgId: base.orgId }, { flag: "sender_context", enabled: true, actor: "cli", now: NOW });
    // Paused: a job test in the same run lists the active mailboxes of the whole database and must not meet this one.
    await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", base.mailboxId).execute();
    const run = randomUUID();
    const senders = sql.lit(SENDERS);
    const now = sql`${NOW.toISOString()}::timestamptz`;
    await sql`
      INSERT INTO emails (org_id, mailbox_id, dedup_key, thread_key, content_hash, uid, received_at, status,
        from_address, message_id_header, subject)
      SELECT ${base.orgId}, ${base.mailboxId}, 'time:' || ${run} || ':' || i, 'time:' || ${run} || ':' || i, 'h', i,
        ${now} - (i % 80) * interval '1 day' - (i % 24) * interval '1 hour', 'triaged',
        's' || (i % ${senders}) || '@t' || (i % 50) || '.test', '<time-' || i || '-' || ${run} || '@x.test>', 'subject ' || i
      FROM generate_series(1, ${sql.lit(MAILS)}) AS i
    `.execute(trx);
    await sql`
      INSERT INTO triage_results (org_id, email_id, category, confidence, reason_code, suspicious_reasons, created_at)
      SELECT org_id, id, (ARRAY['needs_reply', 'info', 'notification', 'spam'])[1 + uid % 4], 0.9, 'direct_request',
        '{}', received_at
      FROM emails WHERE mailbox_id = ${base.mailboxId}
    `.execute(trx);
    await sql`
      INSERT INTO email_flags (email_id, org_id, seen, answered, flagged, checked_at)
      SELECT id, org_id, uid % 3 <> 0, uid % 4 = 0, uid % 11 = 0, received_at
      FROM emails WHERE mailbox_id = ${base.mailboxId} AND uid % 2 = 0
    `.execute(trx);
    await sql`
      INSERT INTO triage_feedback (org_id, email_id, verdict, true_category, source, created_at)
      SELECT org_id, id, 'wrong', 'spam', 'web', received_at + interval '1 minute'
      FROM emails WHERE mailbox_id = ${base.mailboxId} AND uid % 10 = 0
    `.execute(trx);
    await sql`
      INSERT INTO sent_emails (org_id, mailbox_id, dedup_key, path, uidvalidity, uid, message_id, parent_message_id,
        thread_key, to_addresses, cc_addresses, origin, content, sent_at, internal_date)
      SELECT ${base.orgId}, ${base.mailboxId}, 'mid:' || ${run} || ':' || i, 'Sent', '7', i,
        '<sent-' || i || '-' || ${run} || '@x.test>', '<time-' || i || '-' || ${run} || '@x.test>',
        'time:' || ${run} || ':s' || i,
        ARRAY['s' || (i % ${senders}) || '@t' || (i % 50) || '.test'], '{}', 'user', 'headers_only',
        ${now} - (i % 80) * interval '1 day' + interval '3 hours', ${now} - (i % 80) * interval '1 day' + interval '3 hours'
      FROM generate_series(1, ${sql.lit(SENT)}) AS i
    `.execute(trx);
    return base;
  });
  orgId = created.orgId;
  userId = created.userId;
  return created;
}

describe("the profile pass on 5,000 mails from 500 senders", () => {
  test(
    `1 committed data and fresh statistics: one pass finishes in ${BOUND_MS / 1000} s, a repeat pass writes no row`,
    async () => {
      const { orgId: org, mailboxId } = await seed();
      for (const table of [
        "emails",
        "triage_results",
        "email_flags",
        "triage_feedback",
        "sent_emails",
        "email_headers",
        "sender_profiles",
        "delegations",
      ])
        await sql`ANALYZE ${sql.table(table)}`.execute(owner);

      const deps = { db: app, credentialsKey: KEY, testMail: NO_TEST };
      const pass = async () => {
        const started = performance.now();
        const result = await refreshMailboxProfiles(deps, { orgId: org }, mailboxId, { now: NOW });
        return { result, ms: Math.round(performance.now() - started) };
      };
      const first = await pass();
      const second = await pass();
      // The measured times go to the test output, for the report of the stage.
      process.stdout.write(`contacts time test: first pass ${first.ms} ms, repeat pass ${second.ms} ms\n`);

      expect(first.result.skipped).toBe(false);
      expect(first.result.written).toBe(SENDERS);
      expect(first.ms).toBeLessThan(BOUND_MS);
      // The repeat pass reads the same rows and changes none.
      expect(second.result).toEqual({ written: 0, unchanged: SENDERS, zeroed: 0, skipped: false });
      expect(second.ms).toBeLessThan(BOUND_MS);
      const { rows } = await sql<{ n: string }>`
      SELECT count(*) AS n FROM sender_profiles WHERE mailbox_id = ${mailboxId}
    `.execute(app);
      expect(Number(rows[0]?.n)).toBe(SENDERS);
    },
    MINUTE_MS
  );
});
