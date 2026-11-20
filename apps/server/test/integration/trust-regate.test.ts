import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  barCategories,
  type BarCategory,
  type EvidenceKey,
  type GateEvidenceDeps,
  type GateIndexFile,
  type GlobalEvidence,
} from "@ea/core";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { settingsDeps } from "../../src/composition";
import { listActionsForEmail } from "../../src/modules/actions";
import { insertDefaultSettings, lockMailboxSettings, setCategoryGrants, setMode } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { configureFeatures, setOrgFeature } from "../../src/modules/tenancy";
import { createLlmPause, createTriageJob } from "../../src/modules/triage";
import { regateAll, type RegateDeps } from "../../src/modules/trust";
import type { DB, Db } from "../../src/platform/db";
import type { LlmClient } from "../../src/platform/llm";
import { captureLogs, eventLines, logProblems } from "../log-capture";

import {
  addMember,
  createOrgWithMailbox,
  insertTestEmail,
  linkChat,
  pauseOtherMailboxes,
  randomChatId,
  suspendOrg,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertCheckRow, insertTripRow } from "./trust-fixtures";

// The re-gate of `auto` (ADR 0028). Most tests run in a rolled-back transaction: `regateAll` takes a transaction as
// its database and runs its mailbox steps inside it. Tests 5 and 6 need two connections and commit their rows.
const db = testDb();
const NOW = new Date("2026-11-16T12:00:00.000Z");
const GRANT_AT = "2026-11-01T10:00:00.000Z";

const KEY_A: EvidenceKey = {
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  reasoningEffort: null,
  promptVersion: "classifier-v2",
  promptParts: null,
  endpoint: "standard",
  host: null,
};
const KEY_B: EvidenceKey = { ...KEY_A, model: "gemini-4" };
const KEY_A_EU: EvidenceKey = { ...KEY_A, endpoint: "eu" };

beforeEach(() => {
  configureFeatures({ off: [] });
});

afterAll(async () => {
  await db.destroy();
});

const NO_EVIDENCE: GlobalEvidence = {
  decision: "none",
  provisional: false,
  precision: null,
  wilsonLower: null,
  threshold: null,
  cases: 0,
  file: null,
};

// A gate file for `key`: `go` for the listed categories, `no-go` for the rest. `decision: "no-go"` makes every category `no-go`.
function gateFile(
  key: EvidenceKey,
  opts: { go?: BarCategory[]; provisional?: boolean; date?: string; file?: string; noGo?: boolean } = {}
): GateIndexFile {
  const provisional = opts.provisional ?? false;
  const file = opts.file ?? "classifier-fixture.json";
  const go = opts.go ?? ["info", "notification", "spam"];
  const categories = {} as Record<BarCategory, GlobalEvidence>;
  for (const category of barCategories) {
    categories[category] =
      go.includes(category) && opts.noGo !== true
        ? { decision: "go", provisional, precision: 0.99, wilsonLower: 0.97, threshold: 0.8, cases: 200, file }
        : { ...NO_EVIDENCE, decision: "no-go", provisional, file };
  }
  return { key, file, date: opts.date ?? "2026-11-01", provisional, categories };
}

const gateOf = (runningKey: EvidenceKey, ...files: GateIndexFile[]): GateEvidenceDeps => ({
  index: { files },
  runningKey,
});

function depsOf(conn: Db | Transaction<DB>, gate: GateEvidenceDeps, over: Partial<RegateDeps> = {}): RegateDeps {
  return {
    db: conn,
    gate,
    testMail: NO_TEST_SENDERS,
    settingsOf: (trx) => settingsDeps(trx, () => NOW, gate),
    webBaseUrl: "https://app.example.test",
    run: "job",
    ...over,
  };
}

interface Entry {
  auto: boolean;
  threshold: number;
  grant?: { key: EvidenceKey; by: string; at: string };
}
const on = (key: EvidenceKey | null, by = "evidence"): Entry => ({
  auto: true,
  threshold: 0.7,
  ...(key === null ? {} : { grant: { key, by, at: GRANT_AT } }),
});

// An org with two linked owners and a mailbox in `assist` whose policy is `policy`; `flag` is `trust_ladder`.
async function setup(
  trx: Transaction<DB>,
  policy: Partial<Record<BarCategory, Entry>>,
  opts: { flag?: boolean; committed?: boolean } = {}
) {
  // A committed box must not pause the mailboxes of other rows of the database.
  if (opts.committed !== true) await pauseOtherMailboxes(trx);
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  await setMode(
    settingsDeps(trx, () => NOW),
    ctx,
    box.mailboxId,
    { mode: "assist", keepSwitches: false, actor: "test" }
  );
  await trx
    .updateTable("mailbox_settings")
    .set({ category_policy: JSON.stringify(policy) })
    .where("mailbox_id", "=", box.mailboxId)
    .execute();
  const owner2 = await addMember(trx, box.orgId, "owner");
  for (const userId of [box.userId, owner2]) await linkChat(trx, ctx, userId, randomChatId(), NOW);
  if (opts.flag !== false) {
    await setOrgFeature(trx, ctx, { flag: "trust_ladder", enabled: true, actor: box.userId, now: NOW });
  }
  return { ...box, ctx, owner2 };
}

type Box = Awaited<ReturnType<typeof setup>>;

async function policyOf(conn: Db | Transaction<DB>, mailboxId: string) {
  const row = await conn
    .selectFrom("mailbox_settings")
    .select("category_policy")
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return row.category_policy as Record<string, Entry | undefined>;
}

const tripsOf = (conn: Db | Transaction<DB>, mailboxId: string) =>
  conn.selectFrom("autonomy_trips").selectAll().where("mailbox_id", "=", mailboxId).orderBy("category").execute();

const noticesOf = (conn: Db | Transaction<DB>, orgId: string) =>
  conn
    .selectFrom("outbox")
    .select(["user_id", "kind", "dedup_key", "view"])
    .where("org_id", "=", orgId)
    .where("kind", "=", "autonomy_paused")
    .orderBy("user_id")
    .execute();

const checksOf = (conn: Db | Transaction<DB>, mailboxId: string) =>
  conn.selectFrom("history_checks").selectAll().where("mailbox_id", "=", mailboxId).execute();

const policyAudit = (conn: Db | Transaction<DB>, orgId: string) =>
  conn
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", "mailbox.policy_changed")
    .orderBy("id")
    .execute();

const notificationAnswer = {
  category: "notification",
  confidence: 0.95,
  reason_code: "automated_system",
  reason: "a notice",
  summary: null,
  fields: { due_date: null, language: "pl", delegate_id: null, task: null, clarification: null },
};

// A model client with a fixed answer; `beforeAnswer` runs when a call starts (the settings were read before it).
function llmOf(beforeAnswer?: () => Promise<void>): LlmClient {
  return {
    modelOf: () => "fake-model",
    endpointOf: () => "standard",
    providerOf: () => "openai",
    async generate(req) {
      await beforeAnswer?.();
      return {
        data: req.schema.parse(notificationAnswer),
        usage: {
          role: req.role,
          promptVersion: req.promptVersion,
          model: "fake-model",
          tokensIn: 100,
          tokensOut: 20,
          latencyMs: 300,
          endpoint: "standard",
          provider: "openai" as const,
        },
      };
    },
  } as LlmClient;
}

function triageOf(conn: Db | Transaction<DB>, runningKey: EvidenceKey, llm: LlmClient) {
  return createTriageJob({
    runningKey,
    db: conn as Db,
    llm,
    pause: createLlmPause(),
    scope: { kind: "all" },
    batchSize: 5,
    testMail: NO_TEST_SENDERS,
    dailyCap: 1000,
    now: () => NOW,
  });
}

async function moveOf(conn: Db | Transaction<DB>, box: { orgId: string }, emailId: string) {
  const actions = await listActionsForEmail(conn, { orgId: box.orgId }, emailId);
  return actions.find((action) => action.type === "move");
}

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
        finished_at: new Date(NOW.getTime() - 86_400_000),
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

describe("the start run", () => {
  const main = readFileSync(path.resolve(import.meta.dir, "../../src/main.ts"), "utf8");
  const call = 'regateAll({ ...regateDeps, run: "start" }';

  test("main.ts awaits the re-gate before the triage worker and the committer exist", () => {
    const start = main.indexOf(call);
    expect(start).toBeGreaterThan(0);
    // The call is awaited: a start run that is not awaited races the committer.
    expect(main.slice(start - "await ".length, start)).toBe("await ");
    expect(start).toBeLessThan(main.indexOf("createTriageJob("));
    expect(start).toBeLessThan(main.indexOf("createCommitterJob("));
    expect(start).toBeLessThan(main.indexOf('scheduler.add("triage.worker"'));
    expect(start).toBeLessThan(main.indexOf('scheduler.add("actions.committer"'));
    expect(main).toContain('scheduler.add("trust.regate", "20 */5 * * * *"');
    // The tripwire job is registered with the other jobs, and shutdown waits for both trust jobs.
    expect(main).toContain('scheduler.add("trust.tripwire"');
    expect(main).toContain('runs.track("trust.regate"');
    expect(main).toContain('runs.track("trust.tripwire"');
  });

  test("a failure of the whole start run stops the server before the workers start", () => {
    const start = main.indexOf(call);
    const rest = main.slice(start);
    const handler = rest.slice(rest.indexOf("} catch (error) {"), rest.indexOf("} catch (error) {") + 220);
    expect(handler).toContain('log.error("trust_regate_failed"');
    expect(handler).toContain("process.exit(1);");
    expect(handler.indexOf("process.exit(1);")).toBeGreaterThan(handler.indexOf("db.destroy()"));
  });
});
