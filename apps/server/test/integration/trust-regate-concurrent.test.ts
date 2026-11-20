import { type BarCategory } from "@ea/core";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { lockMailboxSettings } from "../../src/modules/config";
import { configureFeatures } from "../../src/modules/tenancy";
import { regateAll } from "../../src/modules/trust";

import { insertTestEmail } from "./fixtures";
import { testDb } from "./helpers";
import {
  NOW,
  KEY_A,
  KEY_B,
  gateFile,
  gateOf,
  depsOf,
  Entry,
  on,
  setup,
  Box,
  policyOf,
  tripsOf,
  noticesOf,
  checksOf,
  policyAudit,
  llmOf,
  triageOf,
  moveOf,
} from "./trust-regate-helpers";

// The re-gate of `auto` (ADR 0028). Most tests run in a rolled-back transaction: `regateAll` takes a transaction as
// its database and runs its mailbox steps inside it. Tests 5 and 6 need two connections and commit their rows.
const db = testDb();

beforeEach(() => {
  configureFeatures({ off: [] });
});

afterAll(async () => {
  await db.destroy();
});

// Polls until a session of this database waits for a lock (the run of `regateAll` that waits for the settings row).
async function waitForLockWait(): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`.execute(db);
    if ((rows[0]?.n ?? 0) > 0) return;
    if (Date.now() >= deadline) throw new Error("no session waits for a lock");
    await Bun.sleep(10);
  }
}

// Tests 5 and 6: two connections and committed rows. Each test removes its organization and its user.
describe("regateAll with two connections", () => {
  const other = testDb();
  afterAll(async () => {
    await other.destroy();
  });

  async function withCommittedBox(
    policy: Partial<Record<BarCategory, Entry>>,
    run: (box: Box & { emailId: string }) => Promise<void>
  ) {
    const created = await db.transaction().execute(async (trx) => {
      const box = await setup(trx, policy, { committed: true });
      const emailId = await insertTestEmail(trx, box.ctx, box.mailboxId, {
        received_at: new Date(NOW.getTime() - 600_000),
      });
      return { ...box, emailId };
    });
    try {
      await run(created);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "in", [created.userId, created.owner2]).execute();
    }
  }

  test("5: two runs at once give one trip and one notice per owner", async () => {
    await withCommittedBox({ notification: on(KEY_A) }, async (box) => {
      const gate = gateOf(KEY_B);
      const results = await Promise.all([
        regateAll(depsOf(db, gate), NOW),
        regateAll(depsOf(other, gate), NOW),
        regateAll(depsOf(db, gate), NOW),
      ]);
      // Other committed data of this database could add to a count; the mailbox of this test is paused once.
      expect(results.reduce((sum, one) => sum + one.paused, 0)).toBeGreaterThanOrEqual(1);
      expect(await tripsOf(db, box.mailboxId)).toHaveLength(1);
      expect(await noticesOf(db, box.orgId)).toHaveLength(2);
      expect((await policyOf(db, box.mailboxId)).notification?.auto).toBe(false);
    });
  });

  test("5b: three runs at once over a stamp, a re-grant and a pause: each happens once, with one audit row", async () => {
    await withCommittedBox({ info: on(null), notification: on(KEY_A), spam: on(KEY_A, "forced") }, async (box) => {
      const gate = gateOf(KEY_B, gateFile(KEY_B));
      const results = await Promise.all([
        regateAll(depsOf(db, gate), NOW),
        regateAll(depsOf(other, gate), NOW),
        regateAll(depsOf(db, gate), NOW),
      ]);
      const sum = (field: "stamped" | "regranted" | "paused") => results.reduce((n, one) => n + one[field], 0);
      expect([sum("stamped"), sum("regranted"), sum("paused")]).toEqual([1, 1, 1]);
      expect(await tripsOf(db, box.mailboxId)).toHaveLength(1);
      expect(await noticesOf(db, box.orgId)).toHaveLength(2);
      const fields = (await policyAudit(db, box.orgId)).map((row) => (row.data as { field: string }).field);
      expect(fields.filter((field) => field === "grant")).toHaveLength(2);
      expect(fields.filter((field) => field === "auto.spam")).toHaveLength(1);
      expect(await checksOf(db, box.mailboxId)).toHaveLength(1);
    });
  });

  test("a run waits for the settings lock and judges the policy it finds after it: no trip and no notice for auto that the user just turned off", async () => {
    await withCommittedBox({ notification: on(KEY_A) }, async (box) => {
      const holder = testDb();
      try {
        let run: Promise<unknown> | undefined;
        await holder.transaction().execute(async (trx) => {
          await lockMailboxSettings(trx, box.ctx, box.mailboxId);
          run = regateAll(depsOf(db, gateOf(KEY_B)), NOW);
          await waitForLockWait();
          // The user turns `auto` off while the run waits for the lock.
          await trx
            .updateTable("mailbox_settings")
            .set({ category_policy: JSON.stringify({ notification: { auto: false, threshold: 0.7 } }) })
            .where("mailbox_id", "=", box.mailboxId)
            .execute();
        });
        await run;
      } finally {
        await holder.destroy();
      }
      expect(await tripsOf(db, box.mailboxId)).toHaveLength(0);
      expect(await noticesOf(db, box.orgId)).toHaveLength(0);
    });
  });

  test("6: a triage batch that read the settings before the pause saves nothing; the next batch logs the move", async () => {
    await withCommittedBox({ notification: on(KEY_A) }, async (box) => {
      // The index now has a final no-go file for key A: the grant of the running key is withdrawn while the batch waits for the model.
      const gate = gateOf(KEY_A, gateFile(KEY_A, { noGo: true }));
      let paused = false;
      const llm = llmOf(async () => {
        if (paused) return;
        paused = true;
        expect(await regateAll(depsOf(other, gate), NOW)).toMatchObject({ paused: 1 });
      });
      await triageOf(db, KEY_A, llm).run();
      expect(await moveOf(db, box, box.emailId)).toBeUndefined();
      const pending = await db
        .selectFrom("emails")
        .select("status")
        .where("id", "=", box.emailId)
        .executeTakeFirstOrThrow();
      expect(pending.status).not.toBe("triaged");
      await triageOf(db, KEY_A, llmOf()).run();
      expect((await moveOf(db, box, box.emailId))?.status).toBe("logged");
    });
  });
});
