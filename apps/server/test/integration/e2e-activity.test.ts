import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import type { ActionsScope } from "../../src/modules/actions";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { listActivity } from "../../src/modules/reports";
import { getLabelTarget, undoWithFeedback } from "../../src/modules/triage";
import { seedActivityRows, seedOtherOrgMail } from "../../src/scripts/e2e-activity-rows";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/e2e-activity.ts");

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-11T12:00:00Z");
const SYNTHETIC: ActionsScope = { kind: "synthetic", testMail: NO_TEST_SENDERS };

describe("e2e activity rows", () => {
  test("(1) 56 mails with the phrases of B12", async () => {
    await withRollback(db, async (trx) => {
      const s = await createOrgWithMailbox(trx);
      const ctx = { orgId: s.orgId };
      const result = await seedActivityRows(trx, ctx, s.mailboxId, NOW);
      expect(result.total).toBe(56);
      const page = await listActivity(trx, ctx, { notRated: false, limit: 100 }, NOW);
      expect(page.items).toHaveLength(56);
      const byId = (id: string) => page.items.find((item) => item.emailId === id);
      const moved = byId(result.emailIds.moved);
      expect(moved?.phrase).toBe("done: move to AI/Notifications, mark read");
      expect(moved?.undoable).toBe(true);
      expect(byId(result.emailIds.unsure)?.category).toBe("unsure");
      const delegated = byId(result.emailIds.delegated);
      expect(delegated?.delegation?.status).toBe("drafted");
      expect(delegated?.delegation?.delegateName).toBe("Ola");
      expect(delegated?.phrase).toContain("draft a delegation to Ola");
      expect(delegated?.phrase).toContain("waits for your approval");
    });
  });

  test("(2) the undo of M1 starts", async () => {
    await withRollback(db, async (trx) => {
      const s = await createOrgWithMailbox(trx);
      const ctx = { orgId: s.orgId };
      const result = await seedActivityRows(trx, ctx, s.mailboxId, NOW);
      const undone = await undoWithFeedback(trx, ctx, result.emailIds.moved, {
        now: new Date(NOW.getTime() + 60_000),
        userId: s.userId,
        scope: SYNTHETIC,
      });
      expect(undone.kind).toBe("started");
    });
  });

  test("(3) two mailboxes of one organization do not clash", async () => {
    await withRollback(db, async (trx) => {
      const s = await createOrgWithMailbox(trx);
      const ctx = { orgId: s.orgId };
      const second = randomUUID();
      await trx
        .insertInto("mailboxes")
        .values({
          id: second,
          org_id: s.orgId,
          address: `second-${second}@x.test`,
          imap_host: "imap.x.test",
          imap_port: 993,
          smtp_host: "smtp.x.test",
          smtp_port: 465,
        })
        .execute();
      await seedActivityRows(trx, ctx, s.mailboxId, NOW);
      await seedActivityRows(trx, ctx, second, NOW);
      const delegates = await trx.selectFrom("delegates").select("id").where("org_id", "=", s.orgId).execute();
      expect(delegates).toHaveLength(2);
    });
  });

  test("(4) the other organization mail belongs to its own context only", async () => {
    await withRollback(db, async (trx) => {
      const own = await createOrgWithMailbox(trx);
      const other = await createOrgWithMailbox(trx);
      const seeded = await seedOtherOrgMail(trx, { orgId: other.orgId }, NOW);
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("status")
        .where("id", "=", seeded.mailboxId)
        .executeTakeFirstOrThrow();
      expect(mailbox.status).toBe("paused");
      expect(await getLabelTarget(trx, { orgId: other.orgId }, seeded.emailId)).toMatchObject({
        category: "notification",
      });
      expect(await getLabelTarget(trx, { orgId: own.orgId }, seeded.emailId)).toBeUndefined();
    });
  });

  test("(5) the script refuses a database that is not an e2e database", async () => {
    const url = process.env.DATABASE_URL ?? "";
    const proc = Bun.spawn(["bun", script, "--mailbox-id", randomUUID()], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: url, MIGRATOR_DATABASE_URL: url },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain("refusing");
  });
});
