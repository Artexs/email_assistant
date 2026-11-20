import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { noticeKinds } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../src/platform/db";
import { checkMigrationSql } from "../../src/scripts/lib/check-migrations-rules";

import { createOrgWithMailbox, insertAction, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertMailboxProfile, insertReplyRequest } from "./reply-fixtures";

// The migration `20261117130001_reply_drafts.sql` (tables, constraints, RLS, the three notice kinds). The connection is
// the `app` role. The Down and Up sections no longer run here: the Up part reads a column that a later migration dropped.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const RLS = "42501";

const migrations = join(import.meta.dir, "../../../../db/migrations");
const file = readFileSync(join(migrations, "20261117130001_reply_drafts.sql"), "utf8");
const [upPart = ""] = file.split("-- migrate:down");

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

// A Postgres error aborts the transaction: the savepoint lets the test go on after it.
async function expectSqlState(trx: Trx, run: () => Promise<unknown>, code: string): Promise<void> {
  await sql`savepoint f115_case`.execute(trx);
  let state: string | undefined;
  try {
    await run();
  } catch (error) {
    state = sqlState(error);
  }
  expect(state).toBe(code);
  await sql`rollback to savepoint f115_case`.execute(trx);
}

async function scopeLocal(trx: Trx, orgId: string): Promise<void> {
  await sql`select set_config('app.org_id', ${orgId}, true)`.execute(trx);
}

async function mailOf(trx: Trx, o: { orgId: string; mailboxId: string }) {
  return insertTestEmail(trx, o, o.mailboxId);
}

describe("reply_requests: constraints", () => {
  test("1: a second auto request for one mail is refused; a second tap, redraft or sample is allowed", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const emailId = await mailOf(trx, o);
      await insertReplyRequest(trx, o, o.mailboxId, emailId, { trigger: "auto" });
      await expectSqlState(trx, () => insertReplyRequest(trx, o, o.mailboxId, emailId, { trigger: "auto" }), UNIQUE);
      await insertReplyRequest(trx, o, o.mailboxId, emailId, { trigger: "tap" });
      await insertReplyRequest(trx, o, o.mailboxId, emailId, { trigger: "tap" });
      await insertReplyRequest(trx, o, o.mailboxId, emailId, { trigger: "redraft" });
      await insertReplyRequest(trx, o, o.mailboxId, emailId, { trigger: "sample" });
      // Another mail has its own automatic request.
      await insertReplyRequest(trx, o, o.mailboxId, await mailOf(trx, o), { trigger: "auto" });
    });
  });

  test("2: the trigger and the status lists refuse an unknown value; every listed value passes", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const emailId = await mailOf(trx, o);
      await expectSqlState(trx, () => insertReplyRequest(trx, o, o.mailboxId, emailId, { trigger: "manual" }), CHECK);
      await expectSqlState(trx, () => insertReplyRequest(trx, o, o.mailboxId, emailId, { status: "open" }), CHECK);
      for (const status of ["pending", "drafting", "done", "no_draft", "failed", "cancelled", "superseded"]) {
        await insertReplyRequest(trx, o, o.mailboxId, emailId, { trigger: "tap", status });
      }
    });
  });

  test("3: the instruction holds at most 300 characters, the sample body 2000, attempts are not negative", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const emailId = await mailOf(trx, o);
      const tap = { trigger: "tap" };
      await insertReplyRequest(trx, o, o.mailboxId, emailId, { ...tap, instruction: "ą".repeat(300) });
      await expectSqlState(
        trx,
        () => insertReplyRequest(trx, o, o.mailboxId, emailId, { ...tap, instruction: "a".repeat(301) }),
        CHECK
      );
      await insertReplyRequest(trx, o, o.mailboxId, emailId, { trigger: "sample", sample_body: "b".repeat(2000) });
      await expectSqlState(
        trx,
        () => insertReplyRequest(trx, o, o.mailboxId, emailId, { trigger: "sample", sample_body: "b".repeat(2001) }),
        CHECK
      );
      await expectSqlState(
        trx,
        () => insertReplyRequest(trx, o, o.mailboxId, emailId, { ...tap, attempts: -1 }),
        CHECK
      );
    });
  });

  test("3b: the reason code is a code: lower-case letters, digits and underscore, 1 to 40 characters; a text reason is refused", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const emailId = await mailOf(trx, o);
      const tap = { trigger: "tap" };
      for (const code of ["needs_facts", "llm_cap", "r".repeat(40), "a", "oauth_mailbox", "k3"]) {
        await insertReplyRequest(trx, o, o.mailboxId, emailId, { ...tap, reason_code: code });
      }
      await insertReplyRequest(trx, o, o.mailboxId, emailId, { ...tap, reason_code: null });
      const refused = [
        "r".repeat(41),
        "",
        "The customer asks for a quote",
        "needs facts",
        "Needs_facts",
        "needs-facts",
        "needs_facts\n",
        "żądanie",
        "jan@firma.test",
      ];
      for (const code of refused) {
        await expectSqlState(
          trx,
          () => insertReplyRequest(trx, o, o.mailboxId, emailId, { ...tap, reason_code: code }),
          CHECK
        );
      }
    });
  });

  test("4: the defaults make a pending request that is due now", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const id = await insertReplyRequest(trx, o, o.mailboxId, await mailOf(trx, o));
      const row = await trx.selectFrom("reply_requests").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(0);
      expect(row.locked_at).toBeNull();
      expect(row.instruction).toBeNull();
      expect(row.next_attempt_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });
  });
});

describe("reply_requests and mailbox_profiles: keys", () => {
  test("5: the mail and the mailbox must belong to the organization of the row", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const mailOfB = await mailOf(trx, b);
      await expectSqlState(trx, () => insertReplyRequest(trx, a, a.mailboxId, mailOfB), FOREIGN_KEY);
      const mailOfA = await mailOf(trx, a);
      await expectSqlState(trx, () => insertReplyRequest(trx, a, b.mailboxId, mailOfA), FOREIGN_KEY);
      await expectSqlState(trx, () => insertMailboxProfile(trx, a, b.mailboxId), FOREIGN_KEY);
    });
  });

  test("6: a profile is one row for a mailbox", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await insertMailboxProfile(trx, o, o.mailboxId, { display_name: "Jan" });
      await expectSqlState(trx, () => insertMailboxProfile(trx, o, o.mailboxId), UNIQUE);
    });
  });

  test("7: the profile texts hold 100, 1000 and 1000 characters at most", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await insertMailboxProfile(trx, o, o.mailboxId, {
        display_name: "n".repeat(100),
        signature: "s".repeat(1000),
        writing_style: "w".repeat(1000),
      });
      await trx.deleteFrom("mailbox_profiles").where("mailbox_id", "=", o.mailboxId).execute();
      await expectSqlState(
        trx,
        () => insertMailboxProfile(trx, o, o.mailboxId, { display_name: "n".repeat(101) }),
        CHECK
      );
      await expectSqlState(
        trx,
        () => insertMailboxProfile(trx, o, o.mailboxId, { signature: "s".repeat(1001) }),
        CHECK
      );
      await expectSqlState(
        trx,
        () => insertMailboxProfile(trx, o, o.mailboxId, { writing_style: "w".repeat(1001) }),
        CHECK
      );
    });
  });

  test("8: a request goes with its mail and with its mailbox; a profile goes with its mailbox", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const mailA = await mailOf(trx, o);
      const mailB = await mailOf(trx, o);
      const a = await insertReplyRequest(trx, o, o.mailboxId, mailA);
      await insertReplyRequest(trx, o, o.mailboxId, mailB);
      await insertMailboxProfile(trx, o, o.mailboxId, { signature: "Jan" });
      await trx.deleteFrom("emails").where("id", "=", mailA).execute();
      const left = await trx.selectFrom("reply_requests").select("id").where("org_id", "=", o.orgId).execute();
      expect(left.map((row) => row.id)).not.toContain(a);
      expect(left).toHaveLength(1);
      await sql`select delete_mailbox(${o.orgId}::uuid, ${o.mailboxId}::uuid)`.execute(trx);
      expect(await trx.selectFrom("reply_requests").select("id").where("org_id", "=", o.orgId).execute()).toEqual([]);
      expect(await trx.selectFrom("mailbox_profiles").select("org_id").where("org_id", "=", o.orgId).execute()).toEqual(
        []
      );
    });
  });

  test("9: a deleted action clears only its own column of the request; org_id stays", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const emailId = await mailOf(trx, o);
      const previous = await insertAction(trx, o, emailId, { type: "create_draft", status: "applied" });
      const made = await insertAction(trx, o, emailId, { type: "send", status: "awaiting_approval" });
      const id = await insertReplyRequest(trx, o, o.mailboxId, emailId, {
        trigger: "redraft",
        previous_send_id: previous,
        send_action_id: made,
      });
      await trx.deleteFrom("actions").where("id", "=", previous).execute();
      let row = await trx.selectFrom("reply_requests").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      expect(row.previous_send_id).toBeNull();
      expect(row.send_action_id).toBe(made);
      expect(row.org_id).toBe(o.orgId);
      await trx.deleteFrom("actions").where("id", "=", made).execute();
      row = await trx.selectFrom("reply_requests").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      expect(row.send_action_id).toBeNull();
      expect(row.org_id).toBe(o.orgId);
    });
  });

  test("10: a deleted user clears requested_by and updated_by", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const member = await createOrgWithMailbox(trx);
      const id = await insertReplyRequest(trx, o, o.mailboxId, await mailOf(trx, o), {
        trigger: "tap",
        requested_by: member.userId,
      });
      await insertMailboxProfile(trx, o, o.mailboxId, { updated_by: member.userId });
      await sql`delete from memberships where user_id = ${member.userId}::uuid`.execute(trx);
      await trx.deleteFrom("users").where("id", "=", member.userId).execute();
      const row = await trx.selectFrom("reply_requests").select("requested_by").where("id", "=", id).executeTakeFirst();
      expect(row?.requested_by).toBeNull();
      const profile = await trx
        .selectFrom("mailbox_profiles")
        .select("updated_by")
        .where("mailbox_id", "=", o.mailboxId)
        .executeTakeFirstOrThrow();
      expect(profile.updated_by).toBeNull();
    });
  });
});

describe("reply_requests: indexes", () => {
  const indexes = async () => {
    const { rows } = await sql<{ name: string; def: string }>`
      select indexname as name, indexdef as def from pg_indexes
      where schemaname = 'public' and tablename = 'reply_requests'`.execute(db);
    return new Map(rows.map((row) => [row.name, row.def]));
  };

  test("5b: the queue index is partial: one mailbox by due time, only pending and drafting rows", async () => {
    const def = (await indexes()).get("reply_requests_queue_idx");
    expect(def).toBeDefined();
    expect(def).toContain("USING btree (mailbox_id, next_attempt_at)");
    expect(def).toMatch(/WHERE \(status = ANY \(ARRAY\['pending'::text, 'drafting'::text\]\)\)$/);
    expect(def).not.toContain("org_id");
  });

  test("5c: the table has exactly these indexes (no org-level queue index, no other partial one)", async () => {
    expect([...(await indexes()).keys()].sort()).toEqual([
      "reply_requests_auto_key",
      "reply_requests_email_idx",
      "reply_requests_mailbox_idx",
      "reply_requests_pkey",
      "reply_requests_previous_send_idx",
      "reply_requests_queue_idx",
      "reply_requests_send_action_idx",
    ]);
  });
});

describe("reply_requests and mailbox_profiles: row-level security", () => {
  test("11: under the scope of organization B, A's requests and profiles are not visible, and none can be written for A", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const mailA = await mailOf(trx, a);
      const mailB = await mailOf(trx, b);
      await insertReplyRequest(trx, a, a.mailboxId, mailA, { trigger: "tap", instruction: "secret of A" });
      await insertReplyRequest(trx, b, b.mailboxId, mailB, { trigger: "tap" });
      await insertMailboxProfile(trx, a, a.mailboxId, { signature: "A" });
      await insertMailboxProfile(trx, b, b.mailboxId, { signature: "B" });
      await scopeLocal(trx, b.orgId);
      const requests = await trx.selectFrom("reply_requests").select("org_id").execute();
      expect(requests.map((row) => row.org_id)).toEqual([b.orgId]);
      const profiles = await trx.selectFrom("mailbox_profiles").select("org_id").execute();
      expect(profiles.map((row) => row.org_id)).toEqual([b.orgId]);
      await expectSqlState(trx, () => insertReplyRequest(trx, a, a.mailboxId, mailA, { trigger: "tap" }), RLS);
      await expectSqlState(trx, () => insertMailboxProfile(trx, a, a.mailboxId), RLS);
      const changed = await trx
        .updateTable("reply_requests")
        .set({ instruction: "changed" })
        .where("org_id", "=", a.orgId)
        .executeTakeFirst();
      expect(changed.numUpdatedRows).toBe(0n);
    });
  });
});

describe("outbox: the kinds replies_ready, reply_prompt and reply_result", () => {
  const insertRow = (trx: Trx, o: { orgId: string; userId: string }, kind: string, emailId?: string) =>
    trx
      .insertInto("outbox")
      .values({
        org_id: o.orgId,
        user_id: o.userId,
        kind,
        dedup_key: `test:${randomUUID()}`,
        text: "x",
        next_attempt_at: new Date("2026-11-20T10:00:00Z"),
        created_at: new Date("2026-11-20T10:00:00Z"),
        ...(emailId === undefined ? {} : { email_id: emailId }),
      })
      .execute();

  test("12: the code list has the three kinds; replies_ready needs no mail, the other two need one", async () => {
    expect(noticeKinds).toEqual(expect.arrayContaining(["replies_ready", "reply_prompt", "reply_result"]));
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const emailId = await mailOf(trx, o);
      await insertRow(trx, o, "replies_ready");
      for (const kind of ["reply_prompt", "reply_result"]) {
        await expectSqlState(trx, () => insertRow(trx, o, kind), CHECK);
        await insertRow(trx, o, kind, emailId);
      }
      await expectSqlState(trx, () => insertRow(trx, o, "reply_results"), CHECK);
      // The older kinds are not changed: the mail kinds still need a mail, the others still need none.
      await expectSqlState(trx, () => insertRow(trx, o, "approval"), CHECK);
      await insertRow(trx, o, "loop_consent");
    });
  });
});

describe("the migration file", () => {
  const previous = readFileSync(join(migrations, "20261115190001_outbox_loop_consent.sql"), "utf8");
  const listOf = (text: string, constraint: string): string[] => {
    const part = text.split("-- migrate:down")[0] ?? "";
    const match = new RegExp(`${constraint}[^;]*?\\(\\s*kind (?:NOT )?IN \\(([^)]*)\\)`).exec(part);
    return [...(match?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? "");
  };

  test("15: both kind lists only grow, by exactly the three new kinds (an expand step)", () => {
    const old = listOf(previous, "ADD CONSTRAINT outbox_kind_check");
    const next = listOf(file, "ADD CONSTRAINT outbox_kind_check");
    expect(old.length).toBeGreaterThan(10);
    expect(next.slice(0, old.length)).toEqual(old);
    expect(next.slice(old.length)).toEqual(["replies_ready", "reply_prompt", "reply_result"]);
    expect([...next].sort()).toEqual([...noticeKinds].sort());
    const oldMail = listOf(
      readFileSync(join(migrations, "20261115170001_action_loop_anchor.sql"), "utf8"),
      "ADD CONSTRAINT outbox_email_kind_check"
    );
    const nextMail = listOf(file, "ADD CONSTRAINT outbox_email_kind_check");
    expect(oldMail.length).toBe(6);
    expect(nextMail).toEqual([...oldMail, "reply_prompt", "reply_result"]);
  });

  test("16: db:check-migrations finds nothing in the file, and the file has no contract line", () => {
    expect(checkMigrationSql(file)).toEqual([]);
    expect(upPart).not.toContain("-- contract:");
  });

  test("17: the file creates no index on emails and drops none (the thread index belongs to the open-loops migration)", () => {
    const statements = file
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/emails_thread_received_idx/);
    expect(statements).not.toMatch(/ON emails\b/i);
  });
});
