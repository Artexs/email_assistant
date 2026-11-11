import { resolve } from "node:path";

import { ASSIST_DEFAULT_SWITCHES, barCategories, type Category } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { settingsDeps } from "../../src/composition";
import { getSettingsView, insertDefaultSettings, setMode, SettingsNotFoundError } from "../../src/modules/config";
import {
  goNoGoFor,
  insertFeedback,
  insertTriageResult,
  setCategoryAutoWithGate,
  type TriageResultInput,
} from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
const NOW = new Date("2026-11-11T12:00:00Z");
const repoRoot = resolve(import.meta.dir, "../../../..");
const settingsScript = resolve(import.meta.dir, "../../src/scripts/mailbox-settings.ts");

afterAll(async () => {
  await db.destroy();
});

interface Tenant {
  orgId: string;
  mailboxId: string;
}

// `n` rows that the model put in `category` at `confidence`; the first `wrong` have another true category.
async function addLabeled(
  trx: Transaction<DB>,
  tenant: Tenant,
  opts: { category: Category; n: number; wrong?: number; confidence?: number }
) {
  const ctx = { orgId: tenant.orgId };
  for (let i = 0; i < opts.n; i += 1) {
    const emailId = await insertTestEmail(trx, ctx, tenant.mailboxId, {
      message_id_header: `<${crypto.randomUUID()}@x.test>`,
    });
    const result: TriageResultInput = {
      emailId,
      category: opts.category,
      vip: false,
      confidence: opts.confidence ?? 0.9,
      reasonCode: "llm",
      reason: null,
      fields: {},
      model: "gemini-3.5-flash-lite",
      promptVersion: "classifier-v1",
      tokensIn: null,
      tokensOut: null,
      latencyMs: null,
    };
    await insertTriageResult(trx, ctx, result);
    const isWrong = i < (opts.wrong ?? 0);
    await insertFeedback(trx, ctx, {
      emailId,
      verdict: isWrong ? "wrong" : "right",
      trueCategory: isWrong ? "notification" : opts.category,
      source: "cli",
      userId: null,
    });
  }
}

async function setup(trx: Transaction<DB>) {
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  return { ...box, ctx, deps: settingsDeps(trx, () => NOW) };
}

async function policyRow(trx: Transaction<DB>, mailboxId: string) {
  return trx.selectFrom("mailbox_settings").selectAll().where("mailbox_id", "=", mailboxId).executeTakeFirstOrThrow();
}

async function policyAudit(trx: Transaction<DB>, orgId: string) {
  return trx
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", "mailbox.policy_changed")
    .execute();
}

describe("goNoGoFor", () => {
  test("no labelled mail: every category is no-go: too few", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const gates = await goNoGoFor(trx, s.ctx, s.mailboxId, NOW);
      for (const category of barCategories) {
        expect(gates[category]).toEqual({
          decision: "no-go: too few",
          precision: null,
          kept: 0,
          atConfidence: 0.5,
          threshold: null,
        });
      }
    });
  });

  test("40 right info rows: go at 0.5", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await addLabeled(trx, s, { category: "info", n: 40 });
      expect((await goNoGoFor(trx, s.ctx, s.mailboxId, NOW)).info).toEqual({
        decision: "go",
        precision: 1,
        kept: 40,
        atConfidence: 0.5,
        threshold: 0.5,
      });
    });
  });

  test("40 right rows at 0.9 and 5 wrong at 0.75: go at the 0.8 sweep point", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await addLabeled(trx, s, { category: "info", n: 40, confidence: 0.9 });
      await addLabeled(trx, s, { category: "info", n: 5, wrong: 5, confidence: 0.75 });
      expect((await goNoGoFor(trx, s.ctx, s.mailboxId, NOW)).info).toMatchObject({
        decision: "go",
        kept: 40,
        atConfidence: 0.8,
        threshold: 0.8,
      });
    });
  });

  test("40 info rows, 4 wrong: no-go, the point is kept in atConfidence", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await addLabeled(trx, s, { category: "info", n: 40, wrong: 4 });
      expect((await goNoGoFor(trx, s.ctx, s.mailboxId, NOW)).info).toEqual({
        decision: "no-go",
        precision: 0.9,
        kept: 40,
        atConfidence: 0.5,
        threshold: null,
      });
    });
  });

  test("12 spam rows: too few", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await addLabeled(trx, s, { category: "spam", n: 12 });
      expect((await goNoGoFor(trx, s.ctx, s.mailboxId, NOW)).spam).toMatchObject({
        decision: "no-go: too few",
        kept: 12,
        atConfidence: 0.5,
        threshold: null,
      });
    });
  });

  test("labelled rows of another organization do not count", async () => {
    await withRollback(db, async (trx) => {
      const a = await setup(trx);
      const b = await setup(trx);
      await addLabeled(trx, b, { category: "info", n: 40 });
      expect((await goNoGoFor(trx, a.ctx, a.mailboxId, NOW)).info.decision).toBe("no-go: too few");
      expect((await goNoGoFor(trx, b.ctx, b.mailboxId, NOW)).info.decision).toBe("go");
    });
  });
});

describe("setCategoryAutoWithGate", () => {
  const input = { category: "info", auto: true, force: false, actor: "test" } as const;

  test("no-go without force: refused, nothing written", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await addLabeled(trx, s, { category: "info", n: 40, wrong: 4 });
      const before = await policyRow(trx, s.mailboxId);
      const result = await setCategoryAutoWithGate(s.deps, s.ctx, s.mailboxId, input);
      expect(result.kind).toBe("refused");
      if (result.kind === "refused") expect(result.gate.decision).toBe("no-go");
      expect(await policyRow(trx, s.mailboxId)).toEqual(before);
      expect(await policyAudit(trx, s.orgId)).toEqual([]);
    });
  });

  test("no-go with force: changed, old threshold, forced true", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await addLabeled(trx, s, { category: "info", n: 40, wrong: 4 });
      const result = await setCategoryAutoWithGate(s.deps, s.ctx, s.mailboxId, { ...input, force: true });
      expect(result.kind).toBe("changed");
      const row = await policyRow(trx, s.mailboxId);
      expect(row.category_policy).toMatchObject({ info: { auto: true, threshold: 0.7 } });
      const audit = await policyAudit(trx, s.orgId);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.data).toMatchObject({ forced: true, from: false, to: true });
    });
  });

  test("go with force: forced false, threshold from the gate", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await addLabeled(trx, s, { category: "info", n: 40 });
      const result = await setCategoryAutoWithGate(s.deps, s.ctx, s.mailboxId, { ...input, force: true });
      expect(result.kind).toBe("changed");
      expect((await policyRow(trx, s.mailboxId)).category_policy).toMatchObject({
        info: { auto: true, threshold: 0.5 },
      });
      expect((await policyAudit(trx, s.orgId))[0]?.data).toMatchObject({ forced: false });
    });
  });

  test("go above 0.5: auto on writes the gate threshold, not the 0.7 default", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await addLabeled(trx, s, { category: "info", n: 40, confidence: 0.9 });
      await addLabeled(trx, s, { category: "info", n: 5, wrong: 5, confidence: 0.75 });
      const result = await setCategoryAutoWithGate(s.deps, s.ctx, s.mailboxId, input);
      expect(result.kind).toBe("changed");
      expect((await policyRow(trx, s.mailboxId)).category_policy).toMatchObject({
        info: { auto: true, threshold: 0.8 },
      });
    });
  });

  test("go with an explicit threshold: the explicit value wins", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await addLabeled(trx, s, { category: "info", n: 40 });
      await setCategoryAutoWithGate(s.deps, s.ctx, s.mailboxId, { ...input, threshold: 0.9 });
      expect((await policyRow(trx, s.mailboxId)).category_policy).toMatchObject({
        info: { auto: true, threshold: 0.9 },
      });
    });
  });

  test("auto off: changed, gate null", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await trx
        .updateTable("mailbox_settings")
        .set({ category_policy: JSON.stringify({ spam: { auto: true, threshold: 0.7 } }) })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      const result = await setCategoryAutoWithGate(s.deps, s.ctx, s.mailboxId, {
        category: "spam",
        auto: false,
        force: false,
        actor: "test",
      });
      expect(result).toMatchObject({ kind: "changed", gate: null });
      expect((await policyRow(trx, s.mailboxId)).category_policy).toMatchObject({ spam: { auto: false } });
    });
  });

  test("no settings row: SettingsNotFoundError, also from getSettingsView", async () => {
    await withRollback(db, async (trx) => {
      const box = await createOrgWithMailbox(trx);
      const ctx = { orgId: box.orgId };
      const deps = settingsDeps(trx, () => NOW);
      const off = setCategoryAutoWithGate(deps, ctx, box.mailboxId, {
        category: "info",
        auto: false,
        force: false,
        actor: "test",
      });
      await expect(off).rejects.toBeInstanceOf(SettingsNotFoundError);
      await expect(off).rejects.toThrow("no mailbox_settings row");
      await expect(getSettingsView(deps, ctx, box.mailboxId)).rejects.toBeInstanceOf(SettingsNotFoundError);
    });
  });
});

async function cleanup(created: { orgId: string; userId: string }): Promise<void> {
  await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
  await db.deleteFrom("users").where("id", "=", created.userId).execute();
}

describe("committed rows", () => {
  test("two setters at once: both changes are in the final row", async () => {
    const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    const ctx = { orgId: created.orgId };
    try {
      await insertDefaultSettings(db, ctx, created.mailboxId);
      await db
        .updateTable("mailbox_settings")
        .set({ category_policy: JSON.stringify({ spam: { auto: true, threshold: 0.7 } }) })
        .where("mailbox_id", "=", created.mailboxId)
        .execute();
      const deps = settingsDeps(db, () => NOW);
      await Promise.all([
        setCategoryAutoWithGate(deps, ctx, created.mailboxId, {
          category: "spam",
          auto: false,
          force: false,
          actor: "test",
        }),
        setMode(deps, ctx, created.mailboxId, { mode: "assist", keepSwitches: false, actor: "test" }),
      ]);
      const row = await db
        .selectFrom("mailbox_settings")
        .selectAll()
        .where("mailbox_id", "=", created.mailboxId)
        .executeTakeFirstOrThrow();
      expect(row.mode).toBe("assist");
      expect(row.tool_switches).toMatchObject(ASSIST_DEFAULT_SWITCHES);
      expect(row.category_policy).toMatchObject({ spam: { auto: false } });
      const audits = await db
        .selectFrom("audit_log")
        .select("event")
        .where("org_id", "=", created.orgId)
        .where("event", "in", ["mailbox.mode_changed", "mailbox.policy_changed"])
        .execute();
      expect(audits.map((a) => a.event).sort()).toEqual(["mailbox.mode_changed", "mailbox.policy_changed"]);
    } finally {
      await cleanup(created);
    }
  });

  test("CLI: auto on an empty mailbox exits 2; with --force it exits 0 and audits forced", async () => {
    const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    const ctx = { orgId: created.orgId };
    const run = async (extra: string[]) => {
      const proc = Bun.spawn(
        [
          "bun",
          settingsScript,
          "auto",
          "--org-id",
          created.orgId,
          "--mailbox-id",
          created.mailboxId,
          "--category",
          "info",
          "--value",
          "on",
          ...extra,
        ],
        { cwd: repoRoot, env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" }
      );
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      return { code, out: `${stdout}${stderr}` };
    };
    try {
      await insertDefaultSettings(db, ctx, created.mailboxId);
      const refused = await run([]);
      expect(refused.code).toBe(2);
      expect(refused.out).toContain("refused: info did not pass go/no-go");
      expect(refused.out).toContain("go/no-go info: no-go: too few");
      expect(refused.out).not.toContain("FORCED");
      const forced = await run(["--force"]);
      expect(forced.code).toBe(0);
      expect(forced.out).toContain("go/no-go info: no-go: too few");
      expect(forced.out).toContain("FORCED");
      const row = await db
        .selectFrom("mailbox_settings")
        .select("category_policy")
        .where("mailbox_id", "=", created.mailboxId)
        .executeTakeFirstOrThrow();
      expect(row.category_policy).toMatchObject({ info: { auto: true } });
      const audit = await db
        .selectFrom("audit_log")
        .select(["actor", "data"])
        .where("org_id", "=", created.orgId)
        .where("event", "=", "mailbox.policy_changed")
        .execute();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor: "cli", data: { forced: true } });
    } finally {
      await cleanup(created);
    }
  });
});
