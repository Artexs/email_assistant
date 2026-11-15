import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../src/platform/db";
import { createRetentionJob } from "../../src/retention";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// F117 stage 03: the schema of mailbox OAuth (`secret_kind`, `send_via`, `oauth_provider`, `auth_reason`,
// `mailbox_oauth_states`). The connection is the `app` role. Times are set by SQL, not by the clock of the test.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

// A statement that must fail aborts the transaction: run it in a savepoint and roll back to it.
async function expectCode(trx: Trx, run: () => Promise<unknown>, code: string, constraint: string): Promise<void> {
  await sql`savepoint probe`.execute(trx);
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  await sql`rollback to savepoint probe`.execute(trx);
  expect(error).toMatchObject({ code, constraint });
}

const hashOf = (): string => createHash("sha256").update(randomUUID()).digest("hex");

async function insertCredential(trx: Trx, orgId: string, mailboxId: string, secretKind: string): Promise<void> {
  await trx
    .insertInto("mailbox_credentials")
    .values({
      mailbox_id: mailboxId,
      org_id: orgId,
      encrypted_secret: "ciphertext",
      secret_kind: secretKind,
      key_version: 1,
    })
    .execute();
}

async function insertState(
  trx: Trx,
  org: { orgId: string; userId: string },
  opts?: { mailboxId?: string | null; stateHash?: string; provider?: string }
): Promise<string> {
  const row = await trx
    .insertInto("mailbox_oauth_states")
    .values({
      org_id: org.orgId,
      user_id: org.userId,
      provider: opts?.provider ?? "microsoft",
      mailbox_id: opts?.mailboxId ?? null,
      state_hash: opts?.stateHash ?? hashOf(),
      encrypted_verifier: "ciphertext",
      key_version: 1,
      expires_at: sql<Date>`now() + interval '10 minutes'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

describe("mailbox OAuth schema", () => {
  test("1. the secret kind `oauth` inserts; an unknown kind is a CHECK error", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      await insertCredential(trx, a.orgId, a.mailboxId, "oauth");
      const kind = await trx
        .selectFrom("mailbox_credentials")
        .select("secret_kind")
        .where("mailbox_id", "=", a.mailboxId)
        .executeTakeFirstOrThrow();
      expect(kind.secret_kind).toBe("oauth");

      await trx.deleteFrom("mailbox_credentials").where("mailbox_id", "=", a.mailboxId).execute();
      await expectCode(
        trx,
        () => insertCredential(trx, a.orgId, a.mailboxId, "token"),
        CHECK_VIOLATION,
        "mailbox_credentials_secret_kind_check"
      );
    });
  });

  test("2. an existing mailbox gets the defaults; `graph` needs the provider `microsoft`", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const row = await trx
        .selectFrom("mailboxes")
        .select(["send_via", "oauth_provider", "auth_reason", "status"])
        .where("id", "=", a.mailboxId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ send_via: "smtp", oauth_provider: null, auth_reason: null, status: "active" });

      const update = (values: { send_via?: string; oauth_provider?: string | null }) =>
        trx.updateTable("mailboxes").set(values).where("id", "=", a.mailboxId).execute();
      await expectCode(
        trx,
        () => update({ send_via: "graph", oauth_provider: "google" }),
        CHECK_VIOLATION,
        "mailboxes_send_via_provider_check"
      );
      await expectCode(trx, () => update({ send_via: "graph" }), CHECK_VIOLATION, "mailboxes_send_via_provider_check");
      await expectCode(trx, () => update({ send_via: "http" }), CHECK_VIOLATION, "mailboxes_send_via_check");
      await expectCode(
        trx,
        () => update({ oauth_provider: "yahoo" }),
        CHECK_VIOLATION,
        "mailboxes_oauth_provider_check"
      );

      await update({ send_via: "graph", oauth_provider: "microsoft" });
      const after = await trx
        .selectFrom("mailboxes")
        .select(["send_via", "oauth_provider"])
        .where("id", "=", a.mailboxId)
        .executeTakeFirstOrThrow();
      expect(after).toEqual({ send_via: "graph", oauth_provider: "microsoft" });
    });
  });

  test("3. a reason needs `auth_error` and a provider; each reason code is checked", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const update = (values: { status?: string; oauth_provider?: string | null; auth_reason?: string | null }) =>
        trx.updateTable("mailboxes").set(values).where("id", "=", a.mailboxId).execute();

      await expectCode(
        trx,
        () => update({ auth_reason: "oauth_expired" }),
        CHECK_VIOLATION,
        "mailboxes_auth_reason_status_check"
      );
      await expectCode(
        trx,
        () => update({ status: "auth_error", auth_reason: "oauth_expired" }),
        CHECK_VIOLATION,
        "mailboxes_auth_reason_status_check"
      );
      await expectCode(
        trx,
        () => update({ status: "auth_error", oauth_provider: "google", auth_reason: "other" }),
        CHECK_VIOLATION,
        "mailboxes_auth_reason_check"
      );

      await update({ status: "auth_error", oauth_provider: "google", auth_reason: "oauth_expired" });
      // The status leaves `auth_error` only together with the reason.
      await expectCode(trx, () => update({ status: "active" }), CHECK_VIOLATION, "mailboxes_auth_reason_status_check");
      await update({ status: "active", auth_reason: null });

      // A password mailbox in `auth_error` stays valid.
      await update({ status: "auth_error", oauth_provider: null });
      const row = await trx
        .selectFrom("mailboxes")
        .select(["status", "auth_reason"])
        .where("id", "=", a.mailboxId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ status: "auth_error", auth_reason: null });
    });
  });

  test("4. two states with one `state_hash` are a unique error; the other columns are checked", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const stateHash = hashOf();
      await insertState(trx, a, { stateHash });
      await expectCode(
        trx,
        () => insertState(trx, a, { stateHash }),
        UNIQUE_VIOLATION,
        "mailbox_oauth_states_state_hash_key"
      );
      await expectCode(
        trx,
        () => insertState(trx, a, { provider: "yahoo" }),
        CHECK_VIOLATION,
        "mailbox_oauth_states_provider_check"
      );
      await expectCode(
        trx,
        () =>
          trx
            .insertInto("mailbox_oauth_states")
            .values({
              org_id: a.orgId,
              user_id: a.userId,
              provider: "google",
              state_hash: hashOf(),
              encrypted_verifier: "ciphertext",
              key_version: 0,
              expires_at: sql<Date>`now()`,
            })
            .execute(),
        CHECK_VIOLATION,
        "mailbox_oauth_states_key_version_check"
      );
    });
  });

  test("5. a state with a mailbox must name a mailbox of the same organization", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await insertState(trx, a, { mailboxId: a.mailboxId });
      await sql`savepoint probe`.execute(trx);
      await expect(insertState(trx, a, { mailboxId: b.mailboxId })).rejects.toMatchObject({ code: "23503" });
      await sql`rollback to savepoint probe`.execute(trx);
    });
  });

  test("6. deleting the mailbox deletes its Reconnect states; deleting the user deletes their states", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const reconnect = await insertState(trx, a, { mailboxId: a.mailboxId });
      const connect = await insertState(trx, a);
      const idsOf = async () =>
        (await trx.selectFrom("mailbox_oauth_states").select("id").where("org_id", "=", a.orgId).execute()).map(
          (row) => row.id
        );
      expect((await idsOf()).sort()).toEqual([reconnect, connect].sort());

      await trx.deleteFrom("mailboxes").where("id", "=", a.mailboxId).execute();
      expect(await idsOf()).toEqual([connect]);

      await trx.deleteFrom("users").where("id", "=", a.userId).execute();
      expect(await idsOf()).toEqual([]);
    });
  });

  test("7. with `app.org_id` set to organization B, a state of organization A is not visible or writable", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const stateA = await insertState(trx, a);
      const stateB = await insertState(trx, b);
      const visible = async () =>
        (await trx.selectFrom("mailbox_oauth_states").select("id").execute()).map((row) => row.id).sort();

      expect(await visible()).toEqual([stateA, stateB].sort());
      await sql`select set_config('app.org_id', ${b.orgId}, true)`.execute(trx);
      expect(await visible()).toEqual([stateB]);

      await sql`savepoint probe`.execute(trx);
      await expect(insertState(trx, a)).rejects.toMatchObject({ code: "42501" });
      await sql`rollback to savepoint probe`.execute(trx);
      const removed = await trx.deleteFrom("mailbox_oauth_states").where("id", "=", stateA).executeTakeFirst();
      expect(removed.numDeletedRows).toBe(0n);
    });
  });

  test("8. retention: a state that expired 2 h ago goes, one that expired 30 min ago stays; the count joins `tokens`", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const old = await insertState(trx, a);
      const recent = await insertState(trx, a);
      const future = await insertState(trx, a);
      const otherOrg = await insertState(trx, b);
      const expireAt = (id: string, interval: string) =>
        sql`update mailbox_oauth_states set expires_at = now() - ${interval}::interval where id = ${id}::uuid`.execute(
          trx
        );
      await expireAt(old, "2 hours");
      await expireAt(recent, "30 minutes");
      await expireAt(otherOrg, "2 hours");
      const idsOf = async (orgId: string) =>
        (await trx.selectFrom("mailbox_oauth_states").select("id").where("org_id", "=", orgId).execute())
          .map((row) => row.id)
          .sort();

      const job = createRetentionJob({ db: trx, now: () => new Date() });
      const counts = await job.runOrg({ id: a.orgId, dataRetentionDays: 30 }, new Date());
      expect(counts.tokens).toBe(1);
      expect(await idsOf(a.orgId)).toEqual([recent, future].sort());
      expect(await idsOf(b.orgId)).toEqual([otherOrg]);

      expect((await job.runOrg({ id: a.orgId, dataRetentionDays: 30 }, new Date())).tokens).toBe(0);
    });
  });
});
