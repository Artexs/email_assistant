import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { type Transaction } from "kysely";

import { settingsDeps } from "../../src/composition";
import { setCategoryGrants } from "../../src/modules/config";
import { configureFeatures } from "../../src/modules/tenancy";
import { regateAll, type RegateDeps } from "../../src/modules/trust";
import type { DB } from "../../src/platform/db";
import { captureLogs, eventLines } from "../log-capture";

import { insertTestEmail, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  NOW,
  KEY_A,
  KEY_B,
  gateFile,
  gateOf,
  depsOf,
  on,
  setup,
  policyOf,
  tripsOf,
  noticesOf,
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
  test("7: a suspended organization is untouched", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A), info: on(null) });
      await suspendOrg(trx, box.orgId);
      const before = await policyOf(trx, box.mailboxId);
      const result = await regateAll(depsOf(trx, gateOf(KEY_B)), NOW);
      expect(result).toEqual({ stamped: 0, regranted: 0, paused: 0 });
      expect(await policyOf(trx, box.mailboxId)).toEqual(before);
      expect(await tripsOf(trx, box.mailboxId)).toHaveLength(0);
      expect(await noticesOf(trx, box.orgId)).toHaveLength(0);
    });
  });

  test("8: an evidence grant on key A, a newer final no-go file for A: paused with evidence_changed", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A, "recommended"), info: on(KEY_A, "regate") });
      const gate = gateOf(
        KEY_A,
        gateFile(KEY_A, { date: "2026-11-01", file: "classifier-old.json" }),
        gateFile(KEY_A, { date: "2026-11-10", file: "classifier-new.json", noGo: true })
      );
      const result = await regateAll(depsOf(trx, gate), NOW);
      expect(result).toMatchObject({ stamped: 0, regranted: 0, paused: 2 });
      const trips = await tripsOf(trx, box.mailboxId);
      expect(trips.map((trip) => [trip.category, trip.reason])).toEqual([
        ["info", "evidence_changed"],
        ["notification", "evidence_changed"],
      ]);
      expect((await noticesOf(trx, box.orgId)).length).toBe(4);
    });
  });

  test("8a: flag off, a real_labels grant on the running key, a provisional file only: no pause, no trip", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(
        trx,
        {
          notification: on(KEY_A, "real_labels"),
          info: on(KEY_A, "legacy"),
          spam: on(KEY_A, "evidence"),
          urgent: on(KEY_A, "forced"),
        },
        { flag: false }
      );
      const before = await policyOf(trx, box.mailboxId);
      const result = await regateAll(depsOf(trx, gateOf(KEY_A, gateFile(KEY_A, { provisional: true }))), NOW);
      expect(result).toEqual({ stamped: 0, regranted: 0, paused: 0 });
      expect(await policyOf(trx, box.mailboxId)).toEqual(before);
      expect(await tripsOf(trx, box.mailboxId)).toHaveLength(0);
    });
  });

  test("8c: a provisional no-go file for the key does not withdraw an evidence grant", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A, "evidence") });
      const gate = gateOf(KEY_A, gateFile(KEY_A, { provisional: true, noGo: true }));
      expect(await regateAll(depsOf(trx, gate), NOW)).toEqual({ stamped: 0, regranted: 0, paused: 0 });
      expect((await policyOf(trx, box.mailboxId)).notification?.auto).toBe(true);
      expect(await tripsOf(trx, box.mailboxId)).toHaveLength(0);
    });
  });

  test("the grant setter writes once: a second call for the same categories changes nothing and adds no audit row", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { info: on(null), notification: on(KEY_A) });
      const settings = settingsDeps(trx, () => NOW, gateOf(KEY_B));
      const legacy = { categories: ["info" as const], by: "legacy" as const, actor: "system" };
      const regate = { categories: ["notification" as const], by: "regate" as const, from: KEY_A, actor: "system" };
      expect((await setCategoryGrants(settings, box.ctx, box.mailboxId, legacy)).changed).toBe(true);
      expect((await setCategoryGrants(settings, box.ctx, box.mailboxId, legacy)).changed).toBe(false);
      expect((await setCategoryGrants(settings, box.ctx, box.mailboxId, regate)).changed).toBe(true);
      expect((await setCategoryGrants(settings, box.ctx, box.mailboxId, regate)).changed).toBe(false);
      // A category that is not on is skipped.
      const off = { categories: ["spam" as const], by: "legacy" as const, actor: "system" };
      expect((await setCategoryGrants(settings, box.ctx, box.mailboxId, off)).changed).toBe(false);
      const audit = (await policyAudit(trx, box.orgId)).filter(
        (row) => (row.data as { field: string }).field === "grant"
      );
      expect(audit).toHaveLength(2);
    });
  });

  test("8b: a final no-go file for the key does not withdraw a real_labels, legacy or forced grant", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, {
        notification: on(KEY_A, "real_labels"),
        info: on(KEY_A, "legacy"),
        spam: on(KEY_A, "forced"),
      });
      const result = await regateAll(depsOf(trx, gateOf(KEY_A, gateFile(KEY_A, { noGo: true }))), NOW);
      expect(result).toEqual({ stamped: 0, regranted: 0, paused: 0 });
      expect((await tripsOf(trx, box.mailboxId)).length).toBe(0);
    });
  });

  test("9: a ready move planned under key A, a start on key B with no B file: the move expires before any committer run", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A) });
      const emailId = await insertTestEmail(trx, box.ctx, box.mailboxId, {
        received_at: new Date(NOW.getTime() - 600_000),
      });
      await triageOf(trx, KEY_A, llmOf()).run();
      expect((await moveOf(trx, box, emailId))?.status).toBe("ready");
      await regateAll(depsOf(trx, gateOf(KEY_B), { run: "start" }), NOW);
      const move = await moveOf(trx, box, emailId);
      expect(move?.status).toBe("expired");
      const row = await trx
        .selectFrom("actions")
        .select(["status", "status_reason"])
        .where("email_id", "=", emailId)
        .where("type", "=", "move")
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ status: "expired", status_reason: "policy_changed" });
    });
  });

  test("a ready move stays ready when the re-gate moves the grant to a key with evidence", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A) });
      const emailId = await insertTestEmail(trx, box.ctx, box.mailboxId, {
        received_at: new Date(NOW.getTime() - 600_000),
      });
      await triageOf(trx, KEY_A, llmOf()).run();
      await regateAll(depsOf(trx, gateOf(KEY_B, gateFile(KEY_B))), NOW);
      expect((await moveOf(trx, box, emailId))?.status).toBe("ready");
    });
  });

  test("a final too-few file for the running key withdraws an evidence grant with evidence_changed", async () => {
    await withRollback(db, async (trx) => {
      const box = await setup(trx, { notification: on(KEY_A, "evidence") });
      const file = gateFile(KEY_A);
      file.categories.notification = { ...file.categories.notification, decision: "too-few" };
      expect(await regateAll(depsOf(trx, gateOf(KEY_A, file)), NOW)).toMatchObject({ paused: 1 });
      expect((await tripsOf(trx, box.mailboxId))[0]?.reason).toBe("evidence_changed");
      expect((await policyOf(trx, box.mailboxId)).notification?.auto).toBe(false);
    });
  });

  test("two organizations: each mailbox runs under its own org; trips, notices and audit rows stay in their org", async () => {
    await withRollback(db, async (trx) => {
      // X has no evidence under key B (paused); Y has a go file for `info` (re-granted) and a forced grant (paused).
      const x = await setup(trx, { notification: on(KEY_A) });
      const y = await setup(trx, { notification: on(KEY_A, "forced"), info: on(KEY_A) });
      const result = await regateAll(depsOf(trx, gateOf(KEY_B, gateFile(KEY_B, { go: ["info"] }))), NOW);
      expect(result).toMatchObject({ stamped: 0, regranted: 1, paused: 2 });
      const forX = await noticesOf(trx, x.orgId);
      const forY = await noticesOf(trx, y.orgId);
      expect(forX.map((row) => row.user_id).sort()).toEqual([x.userId, x.owner2].sort());
      expect(forY.map((row) => row.user_id).sort()).toEqual([y.userId, y.owner2].sort());
      for (const row of forX) expect((row.view as { mailboxId: string }).mailboxId).toBe(x.mailboxId);
      for (const row of forY) expect((row.view as { mailboxId: string }).mailboxId).toBe(y.mailboxId);
      expect((await tripsOf(trx, x.mailboxId)).every((trip) => trip.org_id === x.orgId)).toBe(true);
      expect((await tripsOf(trx, y.mailboxId)).every((trip) => trip.org_id === y.orgId)).toBe(true);
      expect((await policyOf(trx, y.mailboxId)).info?.grant?.by).toBe("regate");
      expect(await policyAudit(trx, x.orgId)).toHaveLength(1);
      expect(await policyAudit(trx, y.orgId)).toHaveLength(2);
    });
  });

  describe("a mailbox that fails alone", () => {
    // The seam throws after the settings lock for one mailbox; the other mailbox must still be re-gated.
    async function failingRun(trx: Transaction<DB>, run: "start" | "job", over: Partial<RegateDeps> = {}) {
      const bad = await setup(trx, { notification: on(KEY_A) });
      // The second box must not pause the first one (it keeps its mailbox active for the triage run).
      const good = await setup(trx, { notification: on(KEY_A) }, { committed: true });
      const emailId = await insertTestEmail(trx, bad.ctx, bad.mailboxId, {
        received_at: new Date(NOW.getTime() - 600_000),
      });
      await triageOf(trx, KEY_A, llmOf()).run();
      expect((await moveOf(trx, bad, emailId))?.status).toBe("ready");
      const gate = gateOf(KEY_B);
      const result = await regateAll(
        depsOf(trx, gate, {
          run,
          hooks: {
            afterLock: (_ctx, mailboxId) => {
              if (mailboxId === bad.mailboxId) throw new Error("one mailbox fails");
            },
          },
          ...over,
        }),
        NOW
      );
      return { bad, good, emailId, result };
    }

    test("the others still run, the failure is logged and counted, and the failed mailbox is left as it was", async () => {
      const capture = captureLogs();
      let outcome: Awaited<ReturnType<typeof failingRun>> | undefined;
      let badGrantKey: unknown;
      let goodAuto: boolean | undefined;
      try {
        await withRollback(db, async (trx) => {
          outcome = await failingRun(trx, "job");
          badGrantKey = (await policyOf(trx, outcome.bad.mailboxId)).notification?.grant?.key;
          goodAuto = (await policyOf(trx, outcome.good.mailboxId)).notification?.auto;
        });
      } finally {
        capture.stop();
      }
      expect(outcome?.result).toMatchObject({ paused: 1 });
      expect(goodAuto).toBe(false);
      expect(badGrantKey).toEqual(KEY_A);
      const failures = eventLines(capture.lines, "trust_regate_mailbox_failed");
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ level: "error", mailbox_id: outcome?.bad.mailboxId });
      expect(eventLines(capture.lines, "trust_regate_done")[0]).toMatchObject({ failed: 1, paused: 1 });
    });

    test("the job run leaves the ready move of the failed mailbox for the next run", async () => {
      await withRollback(db, async (trx) => {
        const { bad, emailId } = await failingRun(trx, "job");
        expect((await moveOf(trx, bad, emailId))?.status).toBe("ready");
      });
    });

    test("the start run expires the ready move and mark-read rows of the failed mailbox, and the others still run", async () => {
      const capture = captureLogs();
      let state: { status: string | undefined; reason: string | null; goodAuto: boolean | undefined } | undefined;
      let grantKey: unknown;
      try {
        await withRollback(db, async (trx) => {
          const { bad, good, emailId, result } = await failingRun(trx, "start");
          expect(result).toMatchObject({ paused: 1 });
          const row = await trx
            .selectFrom("actions")
            .select(["status", "status_reason"])
            .where("email_id", "=", emailId)
            .where("type", "in", ["move", "mark_read"])
            .execute();
          // The notification plan holds a move and a mark-read: both are ready before the run and expired after it.
          state = {
            status: [...new Set(row.map((r) => r.status))].join(","),
            reason: [...new Set(row.map((r) => r.status_reason))].join(","),
            goodAuto: (await policyOf(trx, good.mailboxId)).notification?.auto,
          };
          // The failed mailbox keeps its old grant: only the ready rows are closed.
          grantKey = (await policyOf(trx, bad.mailboxId)).notification?.grant?.key;
        });
      } finally {
        capture.stop();
      }
      expect(state).toEqual({ status: "expired", reason: "policy_changed", goodAuto: false });
      expect(grantKey).toEqual(KEY_A);
      expect(eventLines(capture.lines, "trust_regate_start_expired")[0]).toMatchObject({ count: 2 });
      expect(eventLines(capture.lines, "trust_regate_done")[0]).toMatchObject({ run: "start", failed: 1 });
    });

    test("the start run: when the expiry fails too, it is logged and the others still run", async () => {
      const capture = captureLogs();
      let current = "";
      let goodAuto: boolean | undefined;
      let result: { paused: number } | undefined;
      try {
        await withRollback(db, async (trx) => {
          const bad = await setup(trx, { notification: on(KEY_A) });
          const good = await setup(trx, { notification: on(KEY_A) });
          const gate = gateOf(KEY_B);
          result = await regateAll(
            depsOf(trx, gate, {
              run: "start",
              hooks: {
                afterLock: (_ctx, mailboxId) => {
                  current = mailboxId;
                  if (mailboxId === bad.mailboxId) throw new Error("one mailbox fails");
                },
              },
              // The expiry of the failed mailbox cannot build its setters either.
              settingsOf: (inner) => {
                if (current === bad.mailboxId) throw new Error("the expiry fails too");
                return settingsDeps(inner, () => NOW, gate);
              },
            }),
            NOW
          );
          goodAuto = (await policyOf(trx, good.mailboxId)).notification?.auto;
        });
      } finally {
        capture.stop();
      }
      expect(result).toMatchObject({ paused: 1 });
      expect(goodAuto).toBe(false);
      expect(eventLines(capture.lines, "trust_regate_start_expire_failed")).toHaveLength(1);
      expect(eventLines(capture.lines, "trust_regate_done")[0]).toMatchObject({ failed: 1 });
    });
  });
});
