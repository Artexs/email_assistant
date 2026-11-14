import { randomBytes, randomUUID } from "node:crypto";

import type { OperatorFlagResult, OperatorPlanResult } from "@ea/core";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { orgPlanHooks } from "../../src/composition";
import { insertOutbox } from "../../src/modules/channels";
import { isOrgSuspended, setOrgPlan } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { apiRouters } from "../../src/web";

import { testDb } from "./helpers";
import { as, noBackupCodes, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// F099 stage 09: POST /api/operator/orgs/:orgId/plan and /flags. The operator is the assistant of A; the target is B.
const db = testDb();
const key = randomBytes(32).toString("base64");
const testConfig = loadConfig({
  DATABASE_URL: process.env.DATABASE_URL,
  CREDENTIALS_KEY: key,
  WEB_BASE_URL: TEST_ORIGIN,
  WEB_AUTH_SECRET: "x".repeat(32),
});
const extras = {
  secrets: createSecretBox(key, 1),
  actionsScope: { kind: "off" } as const,
  botUsername: null,
};
const NOW = new Date("2026-11-20T10:00:00Z");

let org: WebOrg;
const sessions = () => ({ owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId });
const routers = () =>
  apiRouters(
    testConfig,
    db,
    extras,
    () => NOW,
    async () => [],
    noBackupCodes
  );
const operatorApp = (suspendedA = false, twoFactorOff?: ReadonlySet<string>) =>
  webTestApp({
    db,
    sessions: sessions(),
    routers: routers(),
    operatorUserIds: new Set([org.assistantId]),
    ...(twoFactorOff ? { twoFactorOff } : {}),
    ...(suspendedA
      ? { isOrgSuspended: async (id: string) => id === org.orgId || isOrgSuspended(db, { orgId: id }) }
      : {}),
  });

const planUrl = (orgId: string) => `/api/operator/orgs/${orgId}/plan`;
const flagUrl = (orgId: string) => `/api/operator/orgs/${orgId}/flags`;
const post = (who: string, body: unknown) => as(who, { method: "POST", body });

// Log lines of one call, as the log module writes them (info → console.log, warn/error → console.error).
async function captured<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
  const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  try {
    const value = await run();
    const lines = [...errorSpy.mock.calls, ...logSpy.mock.calls].map((call) => call.join(" "));
    return { value, lines };
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
}

const resetB = async () => {
  await setOrgPlan(db, { orgId: org.otherOrgId }, { plan: "active", actor: "test", now: NOW });
};

const auditOfB = (event: string) =>
  db
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", org.otherOrgId)
    .where("event", "=", event)
    .where("actor", "=", org.assistantId)
    .execute();

const auditCountOfB = async () =>
  (await db.selectFrom("audit_log").select("id").where("org_id", "=", org.otherOrgId).execute()).length;

const flagRowsOfB = () => db.selectFrom("org_features").selectAll().where("org_id", "=", org.otherOrgId).execute();

beforeAll(async () => {
  org = await webOrg(db);
});

afterEach(async () => {
  await resetB();
  await db.deleteFrom("org_features").where("org_id", "=", org.otherOrgId).execute();
  await db.deleteFrom("outbox").where("org_id", "=", org.otherOrgId).execute();
});

afterAll(async () => {
  await org.cleanup();
  await db.destroy();
});

describe("operator writes (F099 stage 09, D20, D21)", () => {
  test("1. route matrix for both routes", async () => {
    const app = operatorApp();
    const cases = [
      { url: planUrl, ok: { plan: "active" }, bad: [{ plan: "gold" }, { plan: "active", extra: 1 }] },
      {
        url: flagUrl,
        ok: { flag: "stats_page", enabled: true },
        bad: [
          { flag: "", enabled: true },
          { flag: "stats_page", enabled: true, extra: 1 },
        ],
      },
    ];
    for (const { url, ok, bad } of cases) {
      const target = url(org.otherOrgId);
      const none = await app.request(target, {
        method: "POST",
        headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
        body: JSON.stringify(ok),
      });
      expect({ url: target, status: none.status }).toEqual({ url: target, status: 401 });
      for (const who of ["owner", "other"]) {
        const res = await app.request(target, post(who, ok));
        expect({ target, who, status: res.status, body: await res.json() }).toEqual({
          target,
          who,
          status: 404,
          body: { error: "not_found" },
        });
      }
      const noOrigin = await app.request(target, {
        method: "POST",
        headers: { cookie: "ea.session_token=assistant", "content-type": "application/json" },
        body: JSON.stringify(ok),
      });
      expect({ target, status: noOrigin.status, body: await noOrigin.json() }).toEqual({
        target,
        status: 403,
        body: { error: "bad_origin" },
      });
      for (const body of bad) {
        const res = await app.request(target, post("assistant", body));
        const json = (await res.json()) as { error: string };
        expect({ target, body, status: res.status, error: json.error }).toEqual({
          target,
          body,
          status: 400,
          error: "validation",
        });
      }
      const notUuid = await app.request(url("not-a-uuid"), post("assistant", ok));
      expect({ status: notUuid.status, body: await notUuid.json() }).toEqual({
        status: 404,
        body: { error: "not_found" },
      });
      const unknown = await app.request(url(randomUUID()), post("assistant", ok));
      expect({ status: unknown.status, body: await unknown.json() }).toEqual({
        status: 404,
        body: { error: "not_found" },
      });
    }
    expect(await flagRowsOfB()).toEqual([]);
    expect(await auditOfB("org.flag_changed")).toEqual([]);
    expect(await auditOfB("org.plan_changed")).toEqual([]);
  });

  test("2. a flag: changed, unchanged, unknown", async () => {
    const app = operatorApp();
    const res = await app.request(flagUrl(org.otherOrgId), post("assistant", { flag: "stats_page", enabled: true }));
    expect(res.status).toBe(200);
    expect((await res.json()) as OperatorFlagResult).toEqual({ result: "changed", flag: "stats_page", enabled: true });
    const rows = await flagRowsOfB();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ flag: "stats_page", enabled: true, set_by: org.assistantId });
    const audit = await auditOfB("org.flag_changed");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.data).toEqual({ flag: "stats_page", enabled: true });

    const again = await app.request(flagUrl(org.otherOrgId), post("assistant", { flag: "stats_page", enabled: true }));
    expect(again.status).toBe(200);
    expect((await again.json()) as OperatorFlagResult).toEqual({
      result: "unchanged",
      flag: "stats_page",
      enabled: true,
    });
    expect(await auditOfB("org.flag_changed")).toHaveLength(1);

    const unknown = await app.request(flagUrl(org.otherOrgId), post("assistant", { flag: "nope", enabled: true }));
    expect({ status: unknown.status, body: await unknown.json() }).toEqual({
      status: 400,
      body: { error: "unknown_flag" },
    });
    expect(await flagRowsOfB()).toHaveLength(1);
  });

  test("2b. an operator without TOTP is refused 403 two_factor_required and writes nothing (F105 D10)", async () => {
    const app = operatorApp(false, new Set([org.assistantId]));
    const auditBefore = await auditCountOfB();
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const res = await app.request(flagUrl(org.otherOrgId), post("assistant", { flag: "stats_page", enabled: true }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "two_factor_required" });
      const plan = await app.request(planUrl(org.otherOrgId), post("assistant", { plan: "suspended" }));
      expect(plan.status).toBe(403);
    } finally {
      errorSpy.mockRestore();
    }
    expect(await flagRowsOfB()).toHaveLength(0);
    expect(await auditCountOfB()).toBe(auditBefore);
  });

  test("3. suspend cancels the pending outbox and writes the audit row of the CLI", async () => {
    await insertOutbox(
      db,
      { orgId: org.otherOrgId },
      {
        userId: org.otherOwnerId,
        kind: "mailbox_removed",
        dedupKey: `test:${randomUUID()}`,
        view: {},
        locale: "en",
        createdAt: NOW,
        nextAttemptAt: NOW,
      }
    );
    const res = await operatorApp().request(planUrl(org.otherOrgId), post("assistant", { plan: "suspended" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as OperatorPlanResult;
    expect(body).toMatchObject({ result: "changed", plan: "suspended", cancelledMessages: 1 });
    expect(await isOrgSuspended(db, { orgId: org.otherOrgId })).toBe(true);
    const audit = await auditOfB("org.plan_changed");
    expect(audit).toHaveLength(1);
    expect(Object.keys(audit[0]?.data as object).sort()).toEqual(
      ["from", "max_from", "max_to", "to", "trial_ends_at"].sort()
    );
  });

  test("4. suspend, then resume: the resume hook runs", async () => {
    const app = operatorApp();
    const suspend = await app.request(planUrl(org.otherOrgId), post("assistant", { plan: "suspended" }));
    expect(suspend.status).toBe(200);
    const res = await app.request(planUrl(org.otherOrgId), post("assistant", { plan: "active" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as OperatorPlanResult;
    expect(body).toMatchObject({ result: "changed", plan: "active", resumedAt: NOW.toISOString() });
    expect(typeof body.expiredSends).toBe("number");
  });

  test("5. trial days: each step starts from an active B", async () => {
    const app = operatorApp();
    const send = (body: unknown) => app.request(planUrl(org.otherOrgId), post("assistant", body));

    const needed = await send({ plan: "trial" });
    expect({ status: needed.status, body: await needed.json() }).toEqual({
      status: 400,
      body: { error: "trial_days_needed" },
    });
    await resetB();

    const trial = await send({ plan: "trial", trialDays: 14 });
    expect(trial.status).toBe(200);
    expect(((await trial.json()) as OperatorPlanResult).trialEndsAt).toBe("2026-12-04T10:00:00.000Z");
    await resetB();

    const without = await send({ trialDays: 5 });
    expect({ status: without.status, body: await without.json() }).toEqual({
      status: 400,
      body: { error: "trial_days_without_trial" },
    });
    await resetB();

    const nothing = await send({});
    expect({ status: nothing.status, body: await nothing.json() }).toEqual({
      status: 400,
      body: { error: "nothing_to_change" },
    });
  });

  test("6. a suspended organization A does not stop its operator (D21)", async () => {
    const res = await operatorApp(true).request(
      flagUrl(org.otherOrgId),
      post("assistant", { flag: "stats_page", enabled: true })
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as OperatorFlagResult).result).toBe("changed");
    const plan = await operatorApp(true).request(planUrl(org.otherOrgId), post("assistant", { maxMailboxes: 3 }));
    expect(plan.status).toBe(200);
  });

  test("7. one operator_write line; no name or address in the logs", async () => {
    const { value: res, lines } = await captured(async () =>
      operatorApp().request(flagUrl(org.otherOrgId), post("assistant", { flag: "stats_page", enabled: true }))
    );
    expect(res.status).toBe(200);
    const writes = lines.filter((line) => line.includes("operator_write"));
    expect(writes).toHaveLength(1);
    const line = writes[0] ?? "";
    for (const part of [org.otherOrgId, org.assistantId, "flag", "changed"]) expect(line).toContain(part);
    expect(line).toContain("kind");
    for (const text of lines) {
      expect(text).not.toContain("@x.test");
      expect(text).not.toContain("Web org");
    }
  });

  test("hooks: orgPlanHooks is the hook set of the CLI", () => {
    const hooks = orgPlanHooks(db);
    expect(typeof hooks.onSuspended).toBe("function");
    expect(typeof hooks.onResumed).toBe("function");
  });
});
