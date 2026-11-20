import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { MINUTE_MS } from "@ea/core";
import type { FeatureKey } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  configureFeatures,
  featureSettings,
  featureStates,
  getOrgFeature,
  isFeatureOn,
  listOrgFeatureRows,
  upsertOrgFeature,
} from "../../src/modules/tenancy";
import type { DB, Db } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
const AT = new Date("2026-11-20T10:00:00Z");
const repoRoot = resolve(import.meta.dir, "../../../..");
const featuresPath = resolve(repoRoot, "apps/server/src/modules/tenancy/features.ts");

// A db that fails on any use: proves that a call made no query.
const noDb = new Proxy(
  {},
  {
    get() {
      throw new Error("no query expected");
    },
  }
) as unknown as Db;

afterEach(() => {
  configureFeatures({ off: [] });
});

afterAll(async () => {
  await db.destroy();
});

// A statement that must fail aborts the transaction: run it in a savepoint and roll back to it.
async function expectViolation(trx: Transaction<DB>, code: string, run: () => Promise<unknown>) {
  await sql`savepoint violation_probe`.execute(trx);
  await expect(run()).rejects.toMatchObject({ code });
  await sql`rollback to savepoint violation_probe`.execute(trx);
}

async function rowCount(trx: Transaction<DB>, orgId: string): Promise<number> {
  const rows = await trx.selectFrom("org_features").select("flag").where("org_id", "=", orgId).execute();
  return rows.length;
}

function runFeaturesScript(featuresOff: string) {
  const script = `import { featureSettings } from ${JSON.stringify(featuresPath)}; console.log([...featureSettings().off].join(","));`;
  return Bun.spawnSync(["bun", "--eval", script], {
    cwd: repoRoot,
    env: { ...process.env, FEATURES_OFF: featuresOff },
  });
}

describe("org_features", () => {
  test("1 schema: key format, set_by and the primary key are enforced", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const base = { org_id: a.orgId, enabled: true, set_by: "cli", set_at: AT };
      await expectViolation(trx, "23514", () =>
        trx
          .insertInto("org_features")
          .values({ ...base, flag: "Bad-Key" })
          .execute()
      );
      await expectViolation(trx, "23514", () =>
        trx
          .insertInto("org_features")
          .values({ ...base, flag: "stats_page", set_by: "" })
          .execute()
      );
      await trx
        .insertInto("org_features")
        .values({ ...base, flag: "stats_page" })
        .execute();
      await expectViolation(trx, "23505", () =>
        trx
          .insertInto("org_features")
          .values({ ...base, flag: "stats_page" })
          .execute()
      );
    });
  });

  test("2 cascade: rows go with their organization", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      await upsertOrgFeature(trx, { orgId: a.orgId }, { flag: "stats_page", enabled: true, setBy: "cli", setAt: AT });
      await upsertOrgFeature(trx, { orgId: a.orgId }, { flag: "sent_sync", enabled: false, setBy: "cli", setAt: AT });
      expect(await rowCount(trx, a.orgId)).toBe(2);
      await trx.deleteFrom("organizations").where("id", "=", a.orgId).execute();
      expect(await rowCount(trx, a.orgId)).toBe(0);
    });
  });

  test("3 tenant filter: another organization sees and changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctxA = { orgId: a.orgId };
      const ctxB = { orgId: b.orgId };
      await upsertOrgFeature(trx, ctxA, { flag: "stats_page", enabled: true, setBy: "cli", setAt: AT });
      expect(await getOrgFeature(trx, ctxB, "stats_page")).toBeUndefined();
      expect(await listOrgFeatureRows(trx, ctxB)).toEqual([]);
      await upsertOrgFeature(trx, ctxB, { flag: "stats_page", enabled: false, setBy: "cli", setAt: AT });
      expect(await getOrgFeature(trx, ctxA, "stats_page")).toBe(true);
      expect(await listOrgFeatureRows(trx, ctxA)).toHaveLength(1);
    });
  });

  test("4 order without a kill list: default, then the row", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      expect(await isFeatureOn(trx, ctx, "stats_page")).toBe(false);
      await upsertOrgFeature(trx, ctx, { flag: "stats_page", enabled: true, setBy: "cli", setAt: AT });
      expect(await isFeatureOn(trx, ctx, "stats_page")).toBe(true);
      await upsertOrgFeature(trx, ctx, { flag: "stats_page", enabled: false, setBy: "cli", setAt: AT });
      expect(await isFeatureOn(trx, ctx, "stats_page")).toBe(false);
    });
  });

  test("5 kill list wins and makes no query; other keys stay open", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      configureFeatures({ off: ["stats_page"] });
      expect(await isFeatureOn(noDb, ctx, "stats_page")).toBe(false);
      await upsertOrgFeature(trx, ctx, { flag: "approvals_page", enabled: true, setBy: "cli", setAt: AT });
      expect(await isFeatureOn(trx, ctx, "approvals_page")).toBe(true);
    });
  });

  test("6 without configureFeatures the first read parses FEATURES_OFF from the env", () => {
    const ok = runFeaturesScript("sent_sync");
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.toString().trim()).toBe("sent_sync");
    const bad = runFeaturesScript("nope");
    expect(bad.exitCode).not.toBe(0);
    expect(bad.stderr.toString()).toContain("FEATURES_OFF");
  });

  test("7 configureFeatures sets the kill list", () => {
    configureFeatures({ off: ["sent_sync"] });
    expect([...featureSettings().off]).toEqual(["sent_sync"]);
  });

  test("8 featureStates lists the registry with sources and skips unknown rows", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      configureFeatures({ off: ["sent_sync"] });
      await upsertOrgFeature(trx, ctx, { flag: "stats_page", enabled: true, setBy: "cli", setAt: AT });
      await trx
        .insertInto("org_features")
        .values({ org_id: a.orgId, flag: "old_flag", enabled: true, set_by: "cli", set_at: AT })
        .execute();
      expect(await featureStates(trx, ctx)).toEqual([
        { flag: "stats_page", enabled: true, source: "row" },
        { flag: "approvals_page", enabled: false, source: "default" },
        { flag: "delegation_pages", enabled: false, source: "default" },
        { flag: "sent_sync", enabled: false, source: "env" },
        { flag: "security_log", enabled: false, source: "default" },
        { flag: "review_command", enabled: false, source: "default" },
        { flag: "mistake_capture", enabled: false, source: "default" },
        { flag: "llm_pause_line", enabled: false, source: "default" },
        { flag: "weekly_report", enabled: false, source: "default" },
        { flag: "handled_share", enabled: false, source: "default" },
        { flag: "answered_check", enabled: false, source: "default" },
        { flag: "org_delete", enabled: false, source: "default" },
        { flag: "sso_sign_in", enabled: false, source: "default" },
        { flag: "suspicious_mail", enabled: false, source: "default" },
        { flag: "attachment_line", enabled: false, source: "default" },
        { flag: "degraded_notice", enabled: false, source: "default" },
        { flag: "mail_oauth_microsoft", enabled: false, source: "default" },
        { flag: "mail_oauth_google", enabled: false, source: "default" },
        { flag: "open_loops", enabled: false, source: "default" },
        { flag: "delegate_button", enabled: false, source: "default" },
        { flag: "trust_ladder", enabled: false, source: "default" },
        { flag: "panel_review", enabled: false, source: "default" },
        { flag: "why_lines", enabled: false, source: "default" },
        { flag: "docs_links", enabled: false, source: "default" },
        { flag: "user_quiet_hours", enabled: false, source: "default" },
        { flag: "report_mail", enabled: false, source: "default" },
        { flag: "urgency_editor", enabled: false, source: "default" },
        { flag: "spam_review_line", enabled: false, source: "default" },
        { flag: "bulk_unsubscribe", enabled: false, source: "default" },
        { flag: "reply_drafts", enabled: false, source: "default" },
        { flag: "draft_copy_check", enabled: false, source: "default" },
        { flag: "style_from_sent", enabled: false, source: "default" },
        { flag: "sender_context", enabled: false, source: "default" },
        { flag: "contact_wait", enabled: false, source: "default" },
        { flag: "sender_suggestions", enabled: false, source: "default" },
        { flag: "web_push", enabled: false, source: "default" },
        { flag: "telegram_minimal", enabled: false, source: "default" },
      ]);
    });
  });

  test("9 upsert refuses an unknown key before any query", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      await expect(
        upsertOrgFeature(
          trx,
          { orgId: a.orgId },
          { flag: "nope" as FeatureKey, enabled: true, setBy: "cli", setAt: AT }
        )
      ).rejects.toThrow("unknown feature flag: nope");
      expect(await rowCount(trx, a.orgId)).toBe(0);
    });
  });

  test("10 a second upsert changes the value, the actor and the time", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctx = { orgId: a.orgId };
      const later = new Date(AT.getTime() + MINUTE_MS);
      await upsertOrgFeature(trx, ctx, { flag: "stats_page", enabled: true, setBy: "cli", setAt: AT });
      await upsertOrgFeature(trx, ctx, {
        flag: "stats_page",
        enabled: false,
        setBy: `user-${randomUUID()}`,
        setAt: later,
      });
      const rows = await listOrgFeatureRows(trx, ctx);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.enabled).toBe(false);
      expect(rows[0]?.set_by.startsWith("user-")).toBe(true);
      expect(rows[0]?.set_at.getTime()).toBe(later.getTime());
    });
  });
});
