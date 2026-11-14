import { randomUUID } from "node:crypto";

import { securityLogSchema } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { configureFeatures, isOrgSuspended, tenancyRoutes, upsertOrgFeature } from "../../src/modules/tenancy";
import { countMailboxes, onboardingDeps } from "../../src/web";

import { testDb } from "./helpers";
import { as, noBackupCodes, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const off = { kind: "off", reason: "env_off" } as const;
const NOW = new Date("2026-11-20T10:00:00Z");
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let org: WebOrg;
let nobodyUserId: string;

const flag = (orgId: string, enabled: boolean) =>
  upsertOrgFeature(db, { orgId }, { flag: "security_log", enabled, setBy: "test", setAt: NOW });

function app() {
  return webTestApp({
    db,
    sessions: {
      owner: org.ownerId,
      assistant: org.assistantId,
      "other-owner": org.otherOwnerId,
    },
    isOrgSuspended: (orgId) => isOrgSuspended(db, { orgId }),
    routers: (api) =>
      api.route(
        "/",
        tenancyRoutes({
          db,
          now: () => NOW,
          scopes: { triage: off, actions: off, send: off },
          countMailboxes: countMailboxes(db),
          operatorContact: null,
          sessions: async () => [],
          backupCodesLeft: noBackupCodes,
          ...onboardingDeps(db, async () => "fake_ea_bot"),
        })
      ),
  });
}

const audit = (orgId: string, event: string, actor: string, at: Date, data?: Record<string, string>) =>
  recordAudit(db, { orgId }, { actor, event, at, ...(data ? { data } : {}) });

beforeEach(async () => {
  org = await webOrg(db);
  nobodyUserId = randomUUID();
  await flag(org.orgId, true);
});

// audit_log is append-only for the app role: org.cleanup() deletes the organizations and the rows go with them.
afterEach(async () => {
  configureFeatures({ off: [] });
  await org.cleanup();
});

afterAll(async () => {
  await db.destroy();
});

async function seedFixtureRows() {
  await audit(org.orgId, auditEvents.webLogin, org.ownerId, ago(HOUR), { via: "web" });
  await audit(org.orgId, auditEvents.webLoginLocked, org.assistantId, ago(2 * HOUR), {
    via: "web",
    locked_until: "2026-11-20T08:15:00.000Z",
  });
  await audit(org.orgId, auditEvents.webPasswordChanged, nobodyUserId, ago(3 * HOUR), { via: "web" });
  await audit(org.orgId, auditEvents.webOtherSessionsRevoked, "cli", ago(4 * HOUR), { via: "web" });
  await audit(org.orgId, auditEvents.webTermsAccepted, org.ownerId, ago(HOUR / 2), { via: "web" });
  await audit(org.orgId, auditEvents.webLogin, org.ownerId, ago(91 * 24 * HOUR), { via: "web" });
  await audit(org.otherOrgId, auditEvents.webLogin, org.otherOwnerId, ago(HOUR), { via: "web" });
}

describe("GET /api/security-log", () => {
  test("4. no session → 401; an assistant → 403 owner_only, flag on and off", async () => {
    expect((await app().request("/api/security-log")).status).toBe(401);
    for (const on of [true, false]) {
      await flag(org.orgId, on);
      const res = await app().request("/api/security-log", as("assistant"));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "owner_only" });
    }
  });

  test("5. an owner with the flag off → 404 not_found", async () => {
    await flag(org.orgId, false);
    const res = await app().request("/api/security-log", as("owner"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("6. an owner with the flag on: registry rows of the organization, newest first", async () => {
    await seedFixtureRows();
    const res = await app().request("/api/security-log", as("owner"));
    expect(res.status).toBe(200);
    const log = securityLogSchema.parse(await res.json());
    expect(log.entries).toEqual([
      {
        at: ago(HOUR).toISOString(),
        kind: "sign_in",
        actor: { kind: "member", name: "Owner" },
        lockedUntil: null,
      },
      {
        at: ago(2 * HOUR).toISOString(),
        kind: "locked",
        actor: { kind: "member", name: "Assistant" },
        lockedUntil: "2026-11-20T08:15:00.000Z",
      },
      {
        at: ago(3 * HOUR).toISOString(),
        kind: "password_changed",
        actor: { kind: "former_member" },
        lockedUntil: null,
      },
      {
        at: ago(4 * HOUR).toISOString(),
        kind: "other_sessions_ended",
        actor: { kind: "operator" },
        lockedUntil: null,
      },
    ]);
  });

  test("6b. the export, refused delete and two data request events show with their kinds; a cli actor is the operator", async () => {
    await audit(org.orgId, auditEvents.orgExported, "cli", ago(HOUR), { tables: "3", rows: "10" });
    await audit(org.orgId, auditEvents.orgDeleteRefused, org.ownerId, ago(2 * HOUR), { reason: "wrong_password" });
    await audit(org.orgId, auditEvents.dsrFind, "cli", ago(3 * HOUR), { mails: "1" });
    await audit(org.orgId, auditEvents.dsrErase, "cli", ago(4 * HOUR), { mails: "1" });
    const res = await app().request("/api/security-log", as("owner"));
    const { entries } = securityLogSchema.parse(await res.json());
    expect(entries.map((entry) => [entry.kind, entry.actor])).toEqual([
      ["data_exported", { kind: "operator" }],
      ["delete_refused", { kind: "member", name: "Owner" }],
      ["dsr_find", { kind: "operator" }],
      ["dsr_erase", { kind: "operator" }],
    ]);
  });

  test("7. 55 sign-ins in the last day → 50 entries, newest first", async () => {
    for (let i = 0; i < 55; i++) await audit(org.orgId, auditEvents.webLogin, org.ownerId, ago((i + 1) * 60_000));
    const res = await app().request("/api/security-log", as("owner"));
    const { entries } = securityLogSchema.parse(await res.json());
    expect(entries).toHaveLength(50);
    expect(entries[0]?.at).toBe(ago(60_000).toISOString());
    expect(entries[49]?.at).toBe(ago(50 * 60_000).toISOString());
    const times = entries.map((entry) => entry.at);
    expect(times).toEqual([...times].sort().reverse());
  });

  test("8. FEATURES_OFF holds security_log → 404 for the owner", async () => {
    configureFeatures({ off: ["security_log"] });
    const res = await app().request("/api/security-log", as("owner"));
    expect(res.status).toBe(404);
  });

  test("9. the body holds no address, no user id and no organization name", async () => {
    await seedFixtureRows();
    const text = await (await app().request("/api/security-log", as("owner"))).text();
    expect(text).not.toContain("@x.test");
    for (const id of [org.ownerId, org.assistantId, org.otherOwnerId, nobodyUserId]) expect(text).not.toContain(id);
    expect(text).not.toContain("Web org");
    expect(text).not.toContain("Web other org");
  });

  test("10. the owner of B: flag off → 404; flag on → only B's row", async () => {
    await seedFixtureRows();
    expect((await app().request("/api/security-log", as("other-owner"))).status).toBe(404);
    await flag(org.otherOrgId, true);
    const res = await app().request("/api/security-log", as("other-owner"));
    expect(res.status).toBe(200);
    const { entries } = securityLogSchema.parse(await res.json());
    expect(entries).toEqual([
      {
        at: ago(HOUR).toISOString(),
        kind: "sign_in",
        actor: { kind: "member", name: "Other owner" },
        lockedUntil: null,
      },
    ]);
  });

  test("11. second-factor and break-glass rows: kinds, actors, no user id", async () => {
    await audit(org.orgId, auditEvents.webTwoFactorLocked, org.ownerId, ago(HOUR), {
      via: "web",
      locked_until: "2026-11-20T08:15:00.000Z",
    });
    await audit(org.orgId, auditEvents.orgBreakGlassSet, "cli", ago(2 * HOUR), { user_id: org.ownerId });
    await audit(org.orgId, auditEvents.webTwoFactorReset, "cli", ago(3 * HOUR), { via: "cli" });
    const res = await app().request("/api/security-log", as("owner"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(securityLogSchema.parse(JSON.parse(text)).entries).toEqual([
      {
        at: ago(HOUR).toISOString(),
        kind: "two_factor_locked",
        actor: { kind: "member", name: "Owner" },
        lockedUntil: "2026-11-20T08:15:00.000Z",
      },
      { at: ago(2 * HOUR).toISOString(), kind: "break_glass_set", actor: { kind: "operator" }, lockedUntil: null },
      { at: ago(3 * HOUR).toISOString(), kind: "two_factor_reset", actor: { kind: "operator" }, lockedUntil: null },
    ]);
    expect(text).not.toContain(org.ownerId);
  });
});
