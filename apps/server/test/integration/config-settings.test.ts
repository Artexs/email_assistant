import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { expireReady } from "../../src/modules/actions";
import {
  closedBy,
  getSettingsView,
  insertDefaultSettings,
  setCategoryAuto,
  setMode,
  setToolSwitch,
  type SettingsDeps,
} from "../../src/modules/config";
import type { DB, TenantContext } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";

import { createOrgWithMailbox, insertTriagedWithActions } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-07T12:00:00Z");
const GO = { decision: "go", precision: 0.99, kept: 40, forced: false } as const;

interface Setup {
  ctx: TenantContext;
  mailboxId: string;
  deps: SettingsDeps;
}

async function setup(trx: Transaction<DB>): Promise<Setup> {
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  return { ctx, mailboxId: box.mailboxId, deps: { db: trx, now: () => NOW, expireReady } };
}

async function auditRows(trx: Transaction<DB>, s: Setup, event: string) {
  return trx
    .selectFrom("audit_log")
    .select(["actor", "data", "reason_code"])
    .where("org_id", "=", s.ctx.orgId)
    .where("event", "=", event)
    .execute();
}

async function settingsRow(trx: Transaction<DB>, s: Setup) {
  return trx.selectFrom("mailbox_settings").selectAll().where("mailbox_id", "=", s.mailboxId).executeTakeFirstOrThrow();
}

type Type = "move" | "mark_read" | "flag" | "save_summary";

// A triaged mail with `ready` original actions.
async function readyMail(
  trx: Transaction<DB>,
  s: Setup,
  category: "info" | "spam" | "unsure",
  types: Type[],
  extra: { lockedAt?: Date } = {}
): Promise<{ emailId: string; actionIds: string[] }> {
  const mail = await insertTriagedWithActions(trx, s.ctx, s.mailboxId, {
    category,
    createdAt: new Date(NOW.getTime() - 3_600_000),
    actions: types.map((type) => ({ type, status: "ready" })),
  });
  if (extra.lockedAt) {
    await trx.updateTable("actions").set({ locked_at: extra.lockedAt }).where("id", "in", mail.actionIds).execute();
  }
  return mail;
}

async function statuses(trx: Transaction<DB>, emailId: string): Promise<Record<string, string>> {
  const rows = await trx.selectFrom("actions").select(["type", "status"]).where("email_id", "=", emailId).execute();
  return Object.fromEntries(rows.map((row) => [row.type, row.status]));
}

describe("settings setters", () => {
  test("setMode assist sets the P3 switches and audits", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const result = await setMode(s.deps, s.ctx, s.mailboxId, { mode: "assist", keepSwitches: false, actor: "cli" });
      expect(result.changed).toBe(true);
      expect(result.after.mode).toBe("assist");
      expect(result.after.toolSwitches).toMatchObject({ move: true, mark_read: true, flag: true, move_unsure: false });
      const row = await settingsRow(trx, s);
      expect(row.mode).toBe("assist");
      expect(row.tool_switches).toMatchObject({ move: true, mark_read: true, flag: true, move_unsure: false });
      const audit = await auditRows(trx, s, "mailbox.mode_changed");
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actor).toBe("cli");
      expect(audit[0]?.data).toMatchObject({ field: "mode", from: "shadow", to: "assist", switches_set: true });

      const again = await setMode(s.deps, s.ctx, s.mailboxId, { mode: "assist", keepSwitches: false, actor: "cli" });
      expect(again.changed).toBe(false);
      expect(await auditRows(trx, s, "mailbox.mode_changed")).toHaveLength(1);
    });
  });

  test("setMode assist with keepSwitches keeps the switches", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await setToolSwitch(s.deps, s.ctx, s.mailboxId, { name: "flag", value: true, actor: "cli" });
      const result = await setMode(s.deps, s.ctx, s.mailboxId, { mode: "assist", keepSwitches: true, actor: "cli" });
      expect(result.after.toolSwitches.move).toBe(false);
      expect(result.after.toolSwitches.flag).toBe(true);
      const audit = await auditRows(trx, s, "mailbox.mode_changed");
      expect(audit[0]?.data).not.toHaveProperty("switches_set");
    });
  });

  test("setMode shadow leaves the switches", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await setMode(s.deps, s.ctx, s.mailboxId, { mode: "assist", keepSwitches: false, actor: "cli" });
      const result = await setMode(s.deps, s.ctx, s.mailboxId, { mode: "shadow", keepSwitches: false, actor: "cli" });
      expect(result.after.mode).toBe("shadow");
      expect(result.after.toolSwitches).toMatchObject({ move: true, mark_read: true, flag: true });
    });
  });

  test("setCategoryAuto needs the gate", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const base = { category: "info", auto: true, threshold: 0.9, actor: "cli" } as const;
      await setCategoryAuto(s.deps, s.ctx, s.mailboxId, { ...base, gate: GO });
      expect((await settingsRow(trx, s)).category_policy).toMatchObject({ info: { auto: true, threshold: 0.9 } });
      const audit = await auditRows(trx, s, "mailbox.policy_changed");
      expect(audit[0]?.data).toMatchObject({ field: "auto.info", forced: false, to: true });

      const noGo = { decision: "no-go", precision: 0.9, kept: 40, forced: false } as const;
      await expect(
        setCategoryAuto(s.deps, s.ctx, s.mailboxId, { ...base, category: "spam", gate: noGo })
      ).rejects.toThrow("category did not pass go/no-go");
      await setCategoryAuto(s.deps, s.ctx, s.mailboxId, {
        ...base,
        category: "spam",
        gate: { ...noGo, forced: true },
      });
      const forced = await auditRows(trx, s, "mailbox.policy_changed");
      expect(forced.some((row) => (row.data as { forced?: boolean }).forced === true)).toBe(true);

      const off = await setCategoryAuto(s.deps, s.ctx, s.mailboxId, { ...base, auto: false, gate: noGo });
      expect(off.after.categoryPolicy.info?.auto).toBe(false);
    });
  });

  test("setToolSwitch flag off audits", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await setToolSwitch(s.deps, s.ctx, s.mailboxId, { name: "flag", value: true, actor: "cli" });
      const result = await setToolSwitch(s.deps, s.ctx, s.mailboxId, { name: "flag", value: false, actor: "cli" });
      expect(result.after.toolSwitches.flag).toBe(false);
      const audit = await auditRows(trx, s, "mailbox.switch_changed");
      expect(audit).toHaveLength(2);
      expect(audit[1]?.data).toMatchObject({ field: "switch.flag", from: true, to: false });
      const draft = await setToolSwitch(s.deps, s.ctx, s.mailboxId, {
        name: "create_draft",
        value: true,
        actor: "cli",
      });
      expect(draft.warnings).toHaveLength(1);
    });
  });

  test("another organization cannot change the row", async () => {
    await withRollback(db, async (trx) => {
      const a = await setup(trx);
      const b = await setup(trx);
      const foreign: SettingsDeps = b.deps;
      await expect(
        setMode(foreign, b.ctx, a.mailboxId, { mode: "assist", keepSwitches: false, actor: "cli" })
      ).rejects.toBeInstanceOf(HardError);
      await expect(getSettingsView(foreign, b.ctx, a.mailboxId)).rejects.toBeInstanceOf(HardError);
      expect((await settingsRow(trx, a)).mode).toBe("shadow");
    });
  });

  test("movesSupported false: warning on assist", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await trx
        .updateTable("mailboxes")
        .set({ capabilities: JSON.stringify({ move: false, uidplus: false }) })
        .where("id", "=", s.mailboxId)
        .execute();
      expect((await getSettingsView(s.deps, s.ctx, s.mailboxId)).movesSupported).toBe(false);
      const result = await setMode(s.deps, s.ctx, s.mailboxId, { mode: "assist", keepSwitches: false, actor: "cli" });
      expect(result.warnings).toEqual(["moves not supported: moves stay log only"]);
    });
  });
});

describe("gate close (B3)", () => {
  test("mode shadow expires the three originals only", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await setMode(s.deps, s.ctx, s.mailboxId, { mode: "assist", keepSwitches: false, actor: "cli" });
      const mail = await readyMail(trx, s, "info", ["move", "mark_read", "flag", "save_summary"]);
      const reverse = await insertTriagedWithActions(trx, s.ctx, s.mailboxId, {
        category: "info",
        createdAt: NOW,
        actions: [{ type: "move", status: "applied" }],
      });
      await trx
        .insertInto("actions")
        .values({
          org_id: s.ctx.orgId,
          email_id: reverse.emailId,
          type: "move",
          status: "ready",
          payload: "{}",
          idempotency_key: "rev-1",
          reverses_action_id: reverse.actionIds[0] ?? null,
        })
        .execute();
      const result = await setMode(s.deps, s.ctx, s.mailboxId, { mode: "shadow", keepSwitches: false, actor: "cli" });
      expect(result.expired).toBe(3);
      expect(await statuses(trx, mail.emailId)).toMatchObject({
        move: "expired",
        mark_read: "expired",
        flag: "expired",
        save_summary: "ready",
      });
      const reverseRow = await trx
        .selectFrom("actions")
        .select("status")
        .where("idempotency_key", "=", "rev-1")
        .executeTakeFirstOrThrow();
      expect(reverseRow.status).toBe("ready");
      const rows = await auditRows(trx, s, "action.expired");
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.actor === "cli" && row.reason_code === "policy_changed")).toBe(true);
    });
  });

  test("auto off expires move and mark_read of that category", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await setCategoryAuto(s.deps, s.ctx, s.mailboxId, {
        category: "info",
        auto: true,
        threshold: 0.8,
        gate: GO,
        actor: "cli",
      });
      const info = await readyMail(trx, s, "info", ["move", "mark_read", "flag"]);
      const spam = await readyMail(trx, s, "spam", ["move"]);
      const result = await setCategoryAuto(s.deps, s.ctx, s.mailboxId, {
        category: "info",
        auto: false,
        gate: GO,
        actor: "cli",
      });
      expect(result.expired).toBe(2);
      expect(await statuses(trx, info.emailId)).toMatchObject({ move: "expired", mark_read: "expired", flag: "ready" });
      expect(await statuses(trx, spam.emailId)).toMatchObject({ move: "ready" });
    });
  });

  test("switches expire their own rows", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await setMode(s.deps, s.ctx, s.mailboxId, { mode: "assist", keepSwitches: false, actor: "cli" });
      await setToolSwitch(s.deps, s.ctx, s.mailboxId, { name: "move_unsure", value: true, actor: "cli" });
      const info = await readyMail(trx, s, "info", ["move", "flag"]);
      const unsure = await readyMail(trx, s, "unsure", ["move"]);

      await setToolSwitch(s.deps, s.ctx, s.mailboxId, { name: "move", value: false, actor: "cli" });
      expect(await statuses(trx, info.emailId)).toMatchObject({ move: "expired", flag: "ready" });
      expect(await statuses(trx, unsure.emailId)).toMatchObject({ move: "ready" });

      await setToolSwitch(s.deps, s.ctx, s.mailboxId, { name: "move_unsure", value: false, actor: "cli" });
      expect(await statuses(trx, unsure.emailId)).toMatchObject({ move: "expired" });

      const flagged = await readyMail(trx, s, "info", ["move", "flag"]);
      const flagOff = await setToolSwitch(s.deps, s.ctx, s.mailboxId, { name: "flag", value: false, actor: "cli" });
      expect(flagOff.expired).toBe(2);
      expect(await statuses(trx, flagged.emailId)).toMatchObject({ move: "ready", flag: "expired" });
    });
  });

  test("an unchanged value or assist expires nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await readyMail(trx, s, "info", ["move", "mark_read", "flag"]);
      const same = await setToolSwitch(s.deps, s.ctx, s.mailboxId, { name: "move", value: false, actor: "cli" });
      expect(same).toMatchObject({ changed: false, expired: 0 });
      const assist = await setMode(s.deps, s.ctx, s.mailboxId, { mode: "assist", keepSwitches: false, actor: "cli" });
      expect(assist.expired).toBe(0);
      expect(await statuses(trx, mail.emailId)).toMatchObject({ move: "ready", mark_read: "ready", flag: "ready" });
    });
  });

  test("mode assist without keepSwitches expires the rows of a switch that it turns off", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await setMode(s.deps, s.ctx, s.mailboxId, { mode: "assist", keepSwitches: false, actor: "cli" });
      await setToolSwitch(s.deps, s.ctx, s.mailboxId, { name: "move_unsure", value: true, actor: "cli" });
      const unsure = await readyMail(trx, s, "unsure", ["move"]);
      const result = await setMode(s.deps, s.ctx, s.mailboxId, { mode: "assist", keepSwitches: false, actor: "cli" });
      expect(result).toMatchObject({ changed: true, expired: 1 });
      expect(result.after.toolSwitches.move_unsure).toBe(false);
      expect(await statuses(trx, unsure.emailId)).toMatchObject({ move: "expired" });
      const rows = await auditRows(trx, s, "action.expired");
      expect(rows.some((row) => row.reason_code === "policy_changed")).toBe(true);
    });
  });

  test("a row that a committer run holds stays ready", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await setMode(s.deps, s.ctx, s.mailboxId, { mode: "assist", keepSwitches: false, actor: "cli" });
      const mail = await readyMail(trx, s, "info", ["move"], { lockedAt: NOW });
      const result = await setMode(s.deps, s.ctx, s.mailboxId, { mode: "shadow", keepSwitches: false, actor: "cli" });
      expect(result.expired).toBe(0);
      expect(await statuses(trx, mail.emailId)).toMatchObject({ move: "ready" });
    });
  });

  test("a higher threshold expires, a lower one does not", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await setCategoryAuto(s.deps, s.ctx, s.mailboxId, {
        category: "info",
        auto: true,
        threshold: 0.7,
        gate: GO,
        actor: "cli",
      });
      const mail = await readyMail(trx, s, "info", ["move", "mark_read", "flag"]);
      const forced = { ...GO, decision: "no-go", forced: true } as const;
      const lower = await setCategoryAuto(s.deps, s.ctx, s.mailboxId, {
        category: "info",
        auto: true,
        threshold: 0.5,
        gate: forced,
        actor: "cli",
      });
      expect(lower).toMatchObject({ changed: true, expired: 0 });
      const higher = await setCategoryAuto(s.deps, s.ctx, s.mailboxId, {
        category: "info",
        auto: true,
        threshold: 0.95,
        gate: forced,
        actor: "cli",
      });
      expect(higher.expired).toBe(2);
      expect(await statuses(trx, mail.emailId)).toMatchObject({ move: "expired", mark_read: "expired", flag: "ready" });
    });
  });
});

describe("closedBy", () => {
  test("follows decidePolicy", () => {
    expect(closedBy({ field: "mode", to: "shadow" })).toEqual({ types: ["move", "mark_read", "flag"] });
    expect(closedBy({ field: "mode", to: "assist" })).toBeNull();
    const info = { types: ["move", "mark_read"], category: { is: "info" } };
    expect(closedBy({ field: "auto", category: "info", to: false, thresholdRaised: false })).toEqual(
      info as ReturnType<typeof closedBy>
    );
    expect(closedBy({ field: "auto", category: "info", to: true, thresholdRaised: true })).toEqual(
      info as ReturnType<typeof closedBy>
    );
    expect(closedBy({ field: "auto", category: "info", to: true, thresholdRaised: false })).toBeNull();
    expect(closedBy({ field: "switch", name: "move", to: false })).toEqual({
      types: ["move"],
      category: { not: "unsure" },
    });
    expect(closedBy({ field: "switch", name: "move_unsure", to: false })).toEqual({
      types: ["move"],
      category: { is: "unsure" },
    });
    expect(closedBy({ field: "switch", name: "mark_read", to: false })).toEqual({ types: ["mark_read"] });
    expect(closedBy({ field: "switch", name: "flag", to: false })).toEqual({ types: ["flag"] });
    expect(closedBy({ field: "switch", name: "create_draft", to: false })).toBeNull();
    expect(closedBy({ field: "switch", name: "flag", to: true })).toBeNull();
  });
});
