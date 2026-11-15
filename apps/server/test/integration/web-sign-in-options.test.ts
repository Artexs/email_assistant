import { randomUUID } from "node:crypto";

import { signInOptionsSchema } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { anySsoUsable, configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";
import { setLogLevel } from "../../src/platform/log";

import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// F119 stage 11 (step 11.1, D14, Q6): GET /api/sign-in-options is public and answers one bit for every caller.
const db = testDb();
const NOW = new Date("2026-11-20T10:00:00Z");

let org: WebOrg;
const warns: string[] = [];

function app(read: () => Promise<boolean> = () => anySsoUsable(db)) {
  return webTestApp({ db, sessions: { owner: org.ownerId }, routers: () => undefined, anySsoUsable: read });
}

async function addProvider(orgId: string, proved: boolean, domain = "x.test") {
  await db
    .insertInto("sso_providers")
    .values({
      provider_id: orgId,
      org_id: orgId,
      issuer: "https://idp.x.test",
      domain,
      domain_verified: proved,
      domain_proof: proved ? "dns" : null,
      oidc_config: "{}",
    })
    .execute();
}

const flag = (orgId: string, enabled: boolean) =>
  upsertOrgFeature(db, { orgId }, { flag: "sso_sign_in", enabled, setBy: "test", setAt: NOW });

beforeEach(async () => {
  org = await webOrg(db);
  warns.length = 0;
});

afterEach(async () => {
  setLogLevel("info");
  configureFeatures({ off: [] });
  await org.cleanup();
});

afterAll(async () => {
  await db.destroy();
});

async function ask(read?: () => Promise<boolean>, init?: RequestInit, path = "/api/sign-in-options") {
  const res = await app(read).request(path, init);
  return { res, text: await res.clone().text() };
}

describe("GET /api/sign-in-options", () => {
  test("1. no provider, no cookie → 200 { sso: false } with Cache-Control: no-store", async () => {
    const { res } = await ask();
    expect(res.status).toBe(200);
    expect(signInOptionsSchema.parse(await res.json())).toEqual({ sso: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("2. a provider that is not proved: false; proved with the flag off or default: false; proved with the flag on: true", async () => {
    await addProvider(org.orgId, false);
    await flag(org.orgId, true);
    expect(signInOptionsSchema.parse(await (await ask()).res.json())).toEqual({ sso: false });

    await db.deleteFrom("sso_providers").where("org_id", "=", org.orgId).execute();
    await addProvider(org.orgId, true);
    await flag(org.orgId, false);
    expect((await (await ask()).res.json()) as unknown).toEqual({ sso: false });

    // No row at all: the registry default (off).
    await db.deleteFrom("org_features").where("org_id", "=", org.orgId).execute();
    expect((await (await ask()).res.json()) as unknown).toEqual({ sso: false });

    await flag(org.orgId, true);
    expect((await (await ask()).res.json()) as unknown).toEqual({ sso: true });
  });

  test("2b. the flag of another organization does not count: a proved provider needs its own flag", async () => {
    await addProvider(org.orgId, true);
    await flag(org.otherOrgId, true);
    expect((await (await ask()).res.json()) as unknown).toEqual({ sso: false });
    // One usable provider among others is enough.
    await addProvider(org.otherOrgId, true, "y.test");
    expect((await (await ask()).res.json()) as unknown).toEqual({ sso: true });
  });

  test("2c. FEATURES_OFF=sso_sign_in: false, also with a proved provider and the flag row on", async () => {
    await addProvider(org.orgId, true);
    await flag(org.orgId, true);
    configureFeatures({ off: ["sso_sign_in"] });
    expect((await (await ask()).res.json()) as unknown).toEqual({ sso: false });
  });

  test("3. every method but GET fails: POST, PUT and DELETE answer 404 with a session and never read the provider table", async () => {
    let reads = 0;
    const read = async () => {
      reads += 1;
      return true;
    };
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await app(read).request("/api/sign-in-options", as("owner", { method }));
      expect({ method, status: res.status, body: await res.json() }).toEqual({
        method,
        status: 404,
        body: { error: "not_found" },
      });
    }
    // No session: the same guard as for any unknown path under /api.
    expect((await app(read).request("/api/sign-in-options", { method: "POST" })).status).toBe(401);
    expect(reads).toBe(0);
  });

  test("4. the read throws: { sso: false }, 200 and one warn line without the error text", async () => {
    setLogLevel("warn");
    const spy = spyOn(console, "error").mockImplementation((...args: unknown[]): void => {
      warns.push(args.map(String).join(" "));
    });
    try {
      const { res } = await ask(async () => {
        throw new Error("secret-detail-of-the-failure");
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ sso: false });
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      spy.mockRestore();
    }
    const lines = warns.filter((line) => line.includes("sign_in_options_failed"));
    expect(lines).toHaveLength(1);
    // The error carries a type name only: no message text reaches the log line (D15).
    expect(warns.join("\n")).not.toContain("secret-detail-of-the-failure");
  });

  test("5. the answer is the same for every caller: a query, an address and a session change nothing", async () => {
    await addProvider(org.orgId, true);
    await flag(org.orgId, true);
    const known = await ask(undefined, undefined, `/api/sign-in-options?email=web-owner-${randomUUID()}@x.test`);
    const unknown = await ask(undefined, undefined, `/api/sign-in-options?email=nobody-${randomUUID()}@x.test`);
    const withSession = await ask(undefined, as("owner"));
    // Host, forwarding and Origin headers never change the answer (an attacker controls them).
    const headerSets: Record<string, string>[] = [
      { host: "other.test" },
      { "x-forwarded-host": "other.test" },
      { "x-forwarded-for": "203.0.113.9" },
      { origin: "https://evil.test" },
    ];
    const withHeaders = await Promise.all(headerSets.map((headers) => ask(undefined, { headers })));
    for (const answer of [known, unknown, withSession, ...withHeaders]) {
      expect(answer.res.status).toBe(200);
      expect(answer.text).toBe(JSON.stringify({ sso: true }));
      expect(answer.res.headers.get("cache-control")).toBe("no-store");
    }
    // No organization id, domain or count in the body.
    expect(known.text).not.toContain(org.orgId);
    expect(known.text).not.toContain("x.test");
  });
});
