import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { backfillRefusal } from "../../src/scripts/mailbox-backfill-gate";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/mailbox-backfill.ts");

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

describe("mailbox:backfill gate", () => {
  test("a suspended organization: the CLI exits 1 and changes no row", async () => {
    // Committed, so the spawned script sees it; the `afterEach` deletes it.
    const { orgId, userId, mailboxId } = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    orgIds.push(orgId);
    userIds.push(userId);
    await db.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", orgId).execute();
    const snapshot = async () => ({
      mailbox: await db.selectFrom("mailboxes").selectAll().where("id", "=", mailboxId).executeTakeFirstOrThrow(),
      folders: await db.selectFrom("mailbox_folders").selectAll().where("mailbox_id", "=", mailboxId).execute(),
      emails: await db.selectFrom("emails").select("id").where("org_id", "=", orgId).execute(),
    });
    const before = await snapshot();

    const proc = Bun.spawn(["bun", script, "--org-id", orgId, "--mailbox-id", mailboxId], {
      cwd: repoRoot,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(code).toBe(1);
    expect(stderr).toContain(orgId);
    expect(stderr).toContain("org_suspended");
    expect(await snapshot()).toEqual(before);
  });

  test("backfillRefusal: suspended is refused, active and unknown pass", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      expect(await backfillRefusal(trx, orgId)).toBeUndefined();

      await trx.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", orgId).execute();
      const refusal = await backfillRefusal(trx, orgId);
      expect(refusal).toContain(orgId);
      expect(refusal).toContain("org_suspended");

      expect(await backfillRefusal(trx, randomUUID())).toBeUndefined();
    });
  });
});
