import { twoFactorStatusSchema, type TwoFactorStatus } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { setBreakGlassOwner, tenancyRoutes } from "../../src/modules/tenancy";
import { countMailboxes, onboardingDeps } from "../../src/web";

import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const off = { kind: "off", reason: "env_off" } as const;
const NOW = new Date("2026-11-20T10:00:00Z");
const PATH = "/api/me/two-factor";

let org: WebOrg;
let calls: string[];
let answer: number | null;

beforeEach(async () => {
  org = await webOrg(db);
  calls = [];
  answer = 7;
});

afterEach(async () => {
  await org.cleanup();
});

afterAll(async () => {
  await db.destroy();
});

function app(opts: { twoFactorOff?: ReadonlySet<string>; operators?: ReadonlySet<string>; suspended?: boolean } = {}) {
  return webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, "other-owner": org.otherOwnerId },
    ...(opts.twoFactorOff ? { twoFactorOff: opts.twoFactorOff } : {}),
    ...(opts.operators ? { operatorUserIds: opts.operators } : {}),
    ...(opts.suspended ? { isOrgSuspended: async () => true } : {}),
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
          backupCodesLeft: async (userId) => {
            calls.push(userId);
            return answer;
          },
          ...onboardingDeps(db, async () => "fake_ea_bot"),
        })
      ),
  });
}

// Reads the answer as text, checks that no user id or e-mail address is in it, and parses the schema.
async function read(application: ReturnType<typeof app>, cookie: string): Promise<TwoFactorStatus> {
  const res = await application.request(PATH, as(cookie));
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).not.toContain("@x.test");
  for (const id of [org.ownerId, org.assistantId, org.otherOwnerId, org.orgId, org.otherOrgId]) {
    expect(text).not.toContain(id);
  }
  return twoFactorStatusSchema.parse(JSON.parse(text));
}

async function markBreakGlassOwner(): Promise<void> {
  await sql`UPDATE users SET two_factor_enabled = true WHERE id = ${org.ownerId}`.execute(db);
  const result = await setBreakGlassOwner(db, { orgId: org.orgId }, { userId: org.ownerId, actor: "test", now: NOW });
  expect(result.kind).toBe("set");
}

describe("GET /api/me/two-factor", () => {
  test("3: no session gives 401", async () => {
    const res = await app().request(PATH);
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  test("4: TOTP off gives enabled false, no count and no read of the codes", async () => {
    const body = await read(app({ twoFactorOff: new Set([org.ownerId]) }), "owner");
    expect(body).toEqual({ enabled: false, backupCodesLeft: null, requiredBy: [] });
    expect(calls).toEqual([]);
  });

  test("5: TOTP on gives the count; an unreadable count is null", async () => {
    expect(await read(app(), "owner")).toEqual({ enabled: true, backupCodesLeft: 7, requiredBy: [] });
    expect(calls).toEqual([org.ownerId]);
    answer = null;
    expect(await read(app(), "owner")).toEqual({ enabled: true, backupCodesLeft: null, requiredBy: [] });
  });

  test("6: an operator is listed as operator", async () => {
    const body = await read(
      app({ twoFactorOff: new Set([org.assistantId]), operators: new Set([org.assistantId]) }),
      "assistant"
    );
    expect(body).toEqual({ enabled: false, backupCodesLeft: null, requiredBy: ["operator"] });
  });

  test("7: a break-glass owner who is an operator gets both, operator first", async () => {
    await markBreakGlassOwner();
    const body = await read(app({ operators: new Set([org.ownerId]) }), "owner");
    expect(body.requiredBy).toEqual(["operator", "break_glass"]);
    expect(body.enabled).toBe(true);
  });

  test("7a: a break-glass owner who is no operator gets break_glass only", async () => {
    await markBreakGlassOwner();
    expect((await read(app(), "owner")).requiredBy).toEqual(["break_glass"]);
  });

  test("8: the owner of another organization is not marked while this owner is", async () => {
    await markBreakGlassOwner();
    expect((await read(app(), "other-owner")).requiredBy).toEqual([]);
    expect((await read(app(), "assistant")).requiredBy).toEqual([]);
  });

  test("9: a suspended organization still reads (a read)", async () => {
    expect(await read(app({ suspended: true }), "owner")).toEqual({
      enabled: true,
      backupCodesLeft: 7,
      requiredBy: [],
    });
  });

  test("10: the answer holds only the three keys, never a code or the secret", async () => {
    const res = await app().request(PATH, as("owner"));
    const json = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(["backupCodesLeft", "enabled", "requiredBy"]);
    expect(twoFactorStatusSchema.safeParse(json).success).toBe(true);
  });
});
