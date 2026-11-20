import { randomUUID } from "node:crypto";

import { DAY_MS } from "@ea/core";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { insertDefaultSettings } from "../../src/modules/config";
import { configureFeatures } from "../../src/modules/tenancy";
import { regateAll } from "../../src/modules/trust";
import { captureLogs, eventLines, logProblems } from "../log-capture";

import { createOrgWithMailbox, insertTestEmail, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertCheckRow, insertTripRow } from "./trust-fixtures";
import {
  NOW,
  GRANT_AT,
  KEY_A,
  KEY_B,
  KEY_A_EU,
  gateFile,
  gateOf,
  depsOf,
  on,
  setup,
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

describe("regateAll", () => {
  test("1: legacy auto with no grant gets a legacy grant on the running key and still moves", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(null), info: on(null) });
      const emailId = await insertTestEmail(trx, box.ctx, box.mailboxId, {
        received_at: new Date(NOW.getTime() - 600_000),
      });
      const result = await regateAll(depsOf(trx, gateOf(KEY_A)), NOW);
      expect(result).toMatchObject({ stamped: 2, regranted: 0, paused: 0 });
      const policy = await policyOf(trx, box.mailboxId);
      for (const category of ["notification", "info"] as const) {
        expect(policy[category]?.auto).toBe(true);
        expect(policy[category]?.grant).toEqual({ key: KEY_A, by: "legacy", at: NOW.toISOString() });
      }
      // One audit row for the mailbox, not one per category.
      const audit = await policyAudit(trx, box.orgId);
      const stamps = audit.filter((row) => (row.data as { field?: string }).field === "grant");
      expect(stamps).toHaveLength(1);
      expect(stamps[0]?.data).toMatchObject({ grant_by: "legacy", grant_model: KEY_A.model });
      expect(await tripsOf(trx, box.mailboxId)).toHaveLength(0);
      expect(await noticesOf(trx, box.orgId)).toHaveLength(0);
      // The next triage batch moves the mail as before.
      await triageOf(trx, KEY_A, llmOf()).run();
      expect((await moveOf(trx, box, emailId))?.status).toBe("ready");
    });
  });

  test("2: a grant on key A, the same model on the EU endpoint with no EU gate file: auto is off, one trip, one notice per owner, one history check", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A) });
      const result = await regateAll(depsOf(trx, gateOf(KEY_A_EU, gateFile(KEY_A))), NOW);
      expect(result).toMatchObject({ stamped: 0, regranted: 0, paused: 1 });
      const policy = await policyOf(trx, box.mailboxId);
      expect(policy.notification?.auto).toBe(false);
      expect(policy.notification?.grant).toBeUndefined();
      const trips = await tripsOf(trx, box.mailboxId);
      expect(trips).toHaveLength(1);
      expect(trips[0]).toMatchObject({ category: "notification", reason: "model_switch", cleared_at: null });
      expect(trips[0]?.granted_at.toISOString()).toBe(GRANT_AT);
      const notices = await noticesOf(trx, box.orgId);
      expect(notices).toHaveLength(2);
      expect(notices.every((row) => row.dedup_key === `autonomy_paused:${trips[0]?.id}`)).toBe(true);
      expect(notices[0]?.view).toMatchObject({
        mailboxId: box.mailboxId,
        category: "notification",
        reason: "model_switch",
        settingsUrl: "https://app.example.test/settings",
      });
      const checks = await checksOf(trx, box.mailboxId);
      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({ reason: "model_switch", status: "queued" });
      const audit = (await policyAudit(trx, box.orgId)).map((row) => row.data as Record<string, unknown>);
      expect(audit.find((data) => data.field === "auto.notification")).toMatchObject({
        from: true,
        to: false,
        reason: "model_switch",
      });
    });
  });

  test("2b: the flag off, the same switch: paused and noticed, but no history check", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A) }, { flag: false });
      const result = await regateAll(depsOf(trx, gateOf(KEY_A_EU)), NOW);
      expect(result.paused).toBe(1);
      expect(await tripsOf(trx, box.mailboxId)).toHaveLength(1);
      expect(await noticesOf(trx, box.orgId)).toHaveLength(2);
      expect(await checksOf(trx, box.mailboxId)).toHaveLength(0);
    });
  });

  test("3: a grant on key A, running key B with a final go file for B: a regate grant, auto stays on, no notice", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A) });
      const result = await regateAll(depsOf(trx, gateOf(KEY_B, gateFile(KEY_B))), NOW);
      expect(result).toMatchObject({ stamped: 0, regranted: 1, paused: 0 });
      const policy = await policyOf(trx, box.mailboxId);
      expect(policy.notification?.auto).toBe(true);
      expect(policy.notification?.grant).toEqual({ key: KEY_B, by: "regate", at: NOW.toISOString() });
      expect(await tripsOf(trx, box.mailboxId)).toHaveLength(0);
      expect(await noticesOf(trx, box.orgId)).toHaveLength(0);
      const audit = (await policyAudit(trx, box.orgId)).map((row) => row.data as Record<string, unknown>);
      expect(audit.find((data) => data.field === "grant")).toMatchObject({
        categories: "notification",
        grant_by: "regate",
        grant_model: KEY_B.model,
        from_model: KEY_A.model,
      });
      // The history result belongs to the old key: a check for the new key is queued.
      expect((await checksOf(trx, box.mailboxId)).map((row) => row.reason)).toEqual(["model_switch"]);
    });
  });

  test("3b: a provisional go file for B is no evidence: paused", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A) });
      const result = await regateAll(depsOf(trx, gateOf(KEY_B, gateFile(KEY_B, { provisional: true }))), NOW);
      expect(result).toMatchObject({ regranted: 0, paused: 1 });
      expect((await policyOf(trx, box.mailboxId)).notification?.auto).toBe(false);
    });
  });

  test("3c: a failed history check blocks the re-grant under the new key", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A) });
      await insertCheckRow(trx, box.ctx, box.mailboxId, {
        status: "done",
        finished_at: new Date(NOW.getTime() - DAY_MS),
        result: JSON.stringify({
          notification: { outcome: "fail", acted: 60, moved: 6, upper: 0.2, total: 100, wouldMove: 30 },
        }),
      });
      const result = await regateAll(depsOf(trx, gateOf(KEY_B, gateFile(KEY_B))), NOW);
      expect(result).toMatchObject({ regranted: 0, paused: 1 });
      expect((await tripsOf(trx, box.mailboxId))[0]?.reason).toBe("model_switch");
    });
  });

  test("4: a forced grant on key A, running key B with a go file: paused (a forced grant is never re-granted)", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A, "forced") });
      const result = await regateAll(depsOf(trx, gateOf(KEY_B, gateFile(KEY_B))), NOW);
      expect(result).toMatchObject({ regranted: 0, paused: 1 });
      expect((await policyOf(trx, box.mailboxId)).notification?.auto).toBe(false);
      expect((await tripsOf(trx, box.mailboxId))[0]?.reason).toBe("model_switch");
    });
  });

  test("a mailbox with three categories on: each is judged alone (stamp, re-grant, pause) and counts add up", async () => {
    await withRollback(db, async (trx) => {
      // info: no grant (stamp). notification: key A, B has a go file for it (re-grant). spam: forced on A (pause).
      const box = await setup(trx, { info: on(null), notification: on(KEY_A), spam: on(KEY_A, "forced") });
      const result = await regateAll(
        depsOf(trx, gateOf(KEY_B, gateFile(KEY_B, { go: ["info", "notification", "spam"] }))),
        NOW
      );
      expect(result).toMatchObject({ stamped: 1, regranted: 1, paused: 1 });
      const policy = await policyOf(trx, box.mailboxId);
      expect(policy.info?.grant?.by).toBe("legacy");
      expect(policy.notification?.grant?.by).toBe("regate");
      expect(policy.spam?.auto).toBe(false);
      // The history check is queued once, however many categories changed.
      expect(await checksOf(trx, box.mailboxId)).toHaveLength(1);
    });
  });

  test("a second run changes nothing (idempotent)", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A), info: on(null) });
      const deps = depsOf(trx, gateOf(KEY_B));
      expect(await regateAll(deps, NOW)).toMatchObject({ stamped: 1, paused: 1 });
      expect(await regateAll(deps, NOW)).toEqual({ stamped: 0, regranted: 0, paused: 0 });
      expect(await tripsOf(trx, box.mailboxId)).toHaveLength(1);
      expect(await noticesOf(trx, box.orgId)).toHaveLength(2);
    });
  });

  test("a trip for this grant exists already (another process or the tripwire): the pause adds no second trip and no notice", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A) });
      await insertTripRow(trx, box.ctx, box.mailboxId, {
        category: "notification",
        granted_at: new Date(GRANT_AT),
        reason: "corrections",
      });
      const result = await regateAll(depsOf(trx, gateOf(KEY_B)), NOW);
      expect(result.paused).toBe(1);
      expect((await policyOf(trx, box.mailboxId)).notification?.auto).toBe(false);
      expect(await tripsOf(trx, box.mailboxId)).toHaveLength(1);
      expect(await noticesOf(trx, box.orgId)).toHaveLength(0);
    });
  });

  test("the run logs one trust_regate_done line with the counts and the run, and no line holds the mailbox address", async () => {
    const capture = captureLogs();
    try {
      await withRollback(db, async (trx) => {
        await pauseOtherMailboxes(trx);
        const address = `box-${randomUUID()}@x.test`;
        const created = await createOrgWithMailbox(trx, { address });
        const ctx = { orgId: created.orgId };
        await insertDefaultSettings(trx, ctx, created.mailboxId);
        await trx
          .updateTable("mailbox_settings")
          .set({
            category_policy: JSON.stringify({ info: on(null), notification: on(KEY_A), spam: on(KEY_A, "forced") }),
          })
          .where("mailbox_id", "=", created.mailboxId)
          .execute();
        await regateAll(depsOf(trx, gateOf(KEY_B, gateFile(KEY_B)), { run: "start" }), NOW);
        expect(logProblems(capture.lines, [address])).toEqual([]);
      });
    } finally {
      capture.stop();
    }
    const done = eventLines(capture.lines, "trust_regate_done");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ level: "info", stamped: 1, regranted: 1, paused: 1, run: "start" });
  });

  test("a category that is not a moving one (urgent) is paused with a trip and no notice", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { urgent: on(KEY_A) });
      expect(await regateAll(depsOf(trx, gateOf(KEY_B)), NOW)).toMatchObject({ paused: 1 });
      expect((await policyOf(trx, box.mailboxId)).urgent?.auto).toBe(false);
      expect((await tripsOf(trx, box.mailboxId)).map((trip) => trip.category)).toEqual(["urgent"]);
      expect(await noticesOf(trx, box.orgId)).toHaveLength(0);
    });
  });
});
